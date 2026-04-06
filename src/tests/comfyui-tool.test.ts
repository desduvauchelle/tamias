import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { EventEmitter } from 'events'
import { loadConfig, saveConfig, invalidateConfigCache, getComfyUIConfig, type ComfyUIConfig } from '../utils/config.ts'
import {
	createComfyUITools,
	COMFYUI_TOOL_NAME,
	COMFYUI_TOOL_LABEL,
	buildTextToImageWorkflow,
	queuePrompt,
	pollUntilDone,
	fetchImage,
	fetchModelList,
} from '../tools/comfyui.ts'
import { INTERNAL_TOOL_NAMES } from '../tools/internalToolNames.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ToolResult = {
	success: boolean
	error?: string
	prompt_id?: string
	images?: Array<{ fileName: string }>
	modelUsed?: string
	steps?: number
	cfg?: number
	seed?: number
	width?: number
	height?: number
	checkpoints?: string[]
	loras?: string[]
	vaes?: string[]
}

async function resolveToolResult<T>(value: T | AsyncIterable<T>): Promise<T> {
	if (value && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function') {
		for await (const chunk of value as AsyncIterable<T>) return chunk
		throw new Error('Tool returned an empty async iterable result')
	}
	return value as T
}

function makeMockAIService(emitter?: EventEmitter) {
	return {
		getSession: () => emitter ? { emitter, workspacePath: '/tmp' } : null,
	} as never
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ComfyUI config', () => {
	beforeEach(() => {
		invalidateConfigCache()
	})

	test('getComfyUIConfig returns defaults when comfyui is missing', () => {
		const config = loadConfig()
		delete config.comfyui
		saveConfig(config)
		invalidateConfigCache()

		const comfyui = getComfyUIConfig()
		expect(comfyui.enabled).toBe(false)
		expect(comfyui.baseUrl).toBe('http://localhost:8188')
		expect(comfyui.timeoutMs).toBe(300_000)
		expect(comfyui.defaultSteps).toBe(20)
		expect(comfyui.defaultCfg).toBe(7.0)
	})

	test('getComfyUIConfig returns stored values when configured', () => {
		const config = loadConfig()
		config.comfyui = {
			enabled: true,
			baseUrl: 'http://myserver:9000',
			timeoutMs: 60_000,
			defaultCheckpoint: 'sd_xl_base_1.0.safetensors',
			defaultSteps: 30,
			defaultCfg: 8.5,
		}
		saveConfig(config)
		invalidateConfigCache()

		const comfyui = getComfyUIConfig()
		expect(comfyui.enabled).toBe(true)
		expect(comfyui.baseUrl).toBe('http://myserver:9000')
		expect(comfyui.defaultCheckpoint).toBe('sd_xl_base_1.0.safetensors')
		expect(comfyui.defaultSteps).toBe(30)
		expect(comfyui.defaultCfg).toBe(8.5)
	})
})

describe('ComfyUI registration', () => {
	test('COMFYUI_TOOL_NAME is comfyui', () => {
		expect(COMFYUI_TOOL_NAME).toBe('comfyui')
	})

	test('COMFYUI_TOOL_LABEL contains ComfyUI', () => {
		expect(COMFYUI_TOOL_LABEL).toContain('ComfyUI')
	})

	test('comfyui is in INTERNAL_TOOL_NAMES', () => {
		expect(INTERNAL_TOOL_NAMES).toContain('comfyui')
	})
})

describe('buildTextToImageWorkflow', () => {
	test('produces a valid 7-node workflow', () => {
		const workflow = buildTextToImageWorkflow({
			prompt: 'a cat',
			negative: 'ugly',
			width: 768,
			height: 1024,
			steps: 25,
			cfg: 7.5,
			checkpoint: 'dreamshaper_8.safetensors',
			seed: 42,
			batchSize: 1,
		})

		expect(Object.keys(workflow)).toHaveLength(7)
		expect((workflow['1'] as { class_type: string }).class_type).toBe('CheckpointLoaderSimple')
		expect((workflow['1'] as { inputs: { ckpt_name: string } }).inputs.ckpt_name).toBe('dreamshaper_8.safetensors')
		expect((workflow['2'] as { inputs: { text: string } }).inputs.text).toBe('a cat')
		expect((workflow['3'] as { inputs: { text: string } }).inputs.text).toBe('ugly')
		expect((workflow['4'] as { inputs: { width: number; height: number } }).inputs.width).toBe(768)
		expect((workflow['4'] as { inputs: { width: number; height: number } }).inputs.height).toBe(1024)
		expect((workflow['5'] as { inputs: { seed: number; steps: number; cfg: number } }).inputs.seed).toBe(42)
		expect((workflow['5'] as { inputs: { seed: number; steps: number; cfg: number } }).inputs.steps).toBe(25)
		expect((workflow['5'] as { inputs: { seed: number; steps: number; cfg: number } }).inputs.cfg).toBe(7.5)
		expect((workflow['7'] as { class_type: string }).class_type).toBe('SaveImage')
	})

	test('handles batch_size > 1', () => {
		const workflow = buildTextToImageWorkflow({
			prompt: 'test',
			negative: '',
			width: 512,
			height: 512,
			steps: 10,
			cfg: 5,
			checkpoint: 'model.safetensors',
			seed: 1,
			batchSize: 4,
		})

		expect((workflow['4'] as { inputs: { batch_size: number } }).inputs.batch_size).toBe(4)
	})

	test('handles empty negative prompt', () => {
		const workflow = buildTextToImageWorkflow({
			prompt: 'hello',
			negative: '',
			width: 512,
			height: 512,
			steps: 20,
			cfg: 7,
			checkpoint: 'model.safetensors',
			seed: 1,
			batchSize: 1,
		})

		expect((workflow['3'] as { inputs: { text: string } }).inputs.text).toBe('')
	})
})

describe('ComfyUI API helpers', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('queuePrompt sends POST to /prompt and returns prompt_id', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (input: string | URL | Request, init?: RequestInit) => {
				expect(String(input)).toBe('http://localhost:8188/prompt')
				expect(init?.method).toBe('POST')
				const body = JSON.parse(init?.body as string)
				expect(body.prompt).toBeDefined()
				return {
					ok: true,
					status: 200,
					json: async () => ({ prompt_id: 'abc-123' }),
				} as Response
			}),
		})

		const result = await queuePrompt(
			{ '1': { class_type: 'Test' } },
			{ baseUrl: 'http://localhost:8188', timeoutMs: 5000 },
		)
		expect(result.prompt_id).toBe('abc-123')
	})

	test('queuePrompt throws on HTTP error', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: false,
				status: 400,
				text: async () => 'Invalid prompt',
			} as Response)),
		})

		await expect(
			queuePrompt({ '1': {} }, { baseUrl: 'http://localhost:8188', timeoutMs: 5000 }),
		).rejects.toThrow('HTTP 400')
	})

	test('queuePrompt includes auth header when token provided', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (_input: string | URL | Request, init?: RequestInit) => {
				const headers = init?.headers as Record<string, string>
				expect(headers?.['Authorization']).toBe('Bearer mytoken')
				return {
					ok: true,
					status: 200,
					json: async () => ({ prompt_id: 'x' }),
				} as Response
			}),
		})

		await queuePrompt(
			{ '1': {} },
			{ baseUrl: 'http://localhost:8188', authToken: 'mytoken', timeoutMs: 5000 },
		)
	})

	test('fetchImage returns buffer from /view endpoint', async () => {
		const fakeImageData = new Uint8Array([137, 80, 78, 71]) // PNG magic bytes
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (input: string | URL | Request) => {
				const url = String(input)
				expect(url).toContain('/view?')
				expect(url).toContain('filename=output.png')
				expect(url).toContain('subfolder=')
				expect(url).toContain('type=output')
				return {
					ok: true,
					arrayBuffer: async () => fakeImageData.buffer,
				} as Response
			}),
		})

		const buffer = await fetchImage('output.png', '', 'output', {
			baseUrl: 'http://localhost:8188',
			timeoutMs: 5000,
		})
		expect(buffer).toBeInstanceOf(Buffer)
		expect(buffer[0]).toBe(137) // PNG magic byte
	})

	test('fetchImage throws on HTTP error', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: false,
				status: 404,
			} as Response)),
		})

		await expect(
			fetchImage('missing.png', '', 'output', {
				baseUrl: 'http://localhost:8188',
				timeoutMs: 5000,
			}),
		).rejects.toThrow('HTTP 404')
	})

	test('fetchModelList parses object_info response', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (input: string | URL | Request) => {
				expect(String(input)).toBe('http://localhost:8188/object_info')
				return {
					ok: true,
					json: async () => ({
						CheckpointLoaderSimple: {
							input: { required: { ckpt_name: [['model_a.safetensors', 'model_b.safetensors']] } },
						},
						LoraLoader: {
							input: { required: { lora_name: [['lora1.safetensors']] } },
						},
						VAELoader: {
							input: { required: { vae_name: [['vae_ft_mse.safetensors']] } },
						},
					}),
				} as Response
			}),
		})

		const models = await fetchModelList({
			baseUrl: 'http://localhost:8188',
			timeoutMs: 5000,
		})
		expect(models.checkpoints).toEqual(['model_a.safetensors', 'model_b.safetensors'])
		expect(models.loras).toEqual(['lora1.safetensors'])
		expect(models.vaes).toEqual(['vae_ft_mse.safetensors'])
	})

	test('fetchModelList returns empty arrays when node types are missing', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: true,
				json: async () => ({}),
			} as Response)),
		})

		const models = await fetchModelList({
			baseUrl: 'http://localhost:8188',
			timeoutMs: 5000,
		})
		expect(models.checkpoints).toEqual([])
		expect(models.loras).toEqual([])
		expect(models.vaes).toEqual([])
	})

	test('fetchModelList throws on HTTP error', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: false,
				status: 500,
			} as Response)),
		})

		await expect(
			fetchModelList({ baseUrl: 'http://localhost:8188', timeoutMs: 5000 }),
		).rejects.toThrow('HTTP 500')
	})
})

describe('ComfyUI tool factory — disabled', () => {
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		invalidateConfigCache()
		const config = loadConfig()
		config.comfyui = {
			enabled: false,
			baseUrl: 'http://localhost:8188',
			timeoutMs: 300_000,
			defaultSteps: 20,
			defaultCfg: 7.0,
		}
		saveConfig(config)
		invalidateConfigCache()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('generate returns disabled error', async () => {
		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.generate.execute
		expect(execute).toBeDefined()
		if (!execute) throw new Error('Missing generate execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ prompt: 'a cat', negative: '', width: 512, height: 512, seed: -1, batch_size: 1 },
				{ toolCallId: 'test', messages: [] },
			),
		)
		expect(result.success).toBe(false)
		expect(result.error).toContain('disabled')
	})

	test('run_workflow returns disabled error', async () => {
		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.run_workflow.execute
		expect(execute).toBeDefined()
		if (!execute) throw new Error('Missing run_workflow execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ workflow: { '1': {} } },
				{ toolCallId: 'test', messages: [] },
			),
		)
		expect(result.success).toBe(false)
		expect(result.error).toContain('disabled')
	})

	test('list_models returns disabled error', async () => {
		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.list_models.execute
		expect(execute).toBeDefined()
		if (!execute) throw new Error('Missing list_models execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ type: 'all' },
				{ toolCallId: 'test', messages: [] },
			),
		)
		expect(result.success).toBe(false)
		expect(result.error).toContain('disabled')
	})
})

describe('ComfyUI tool factory — enabled', () => {
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		invalidateConfigCache()
		const config = loadConfig()
		config.comfyui = {
			enabled: true,
			baseUrl: 'http://localhost:8188',
			timeoutMs: 5000,
			defaultCheckpoint: 'dreamshaper_8.safetensors',
			defaultSteps: 20,
			defaultCfg: 7.0,
		}
		saveConfig(config)
		invalidateConfigCache()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('generate returns error when no checkpoint specified and no default', async () => {
		const config = loadConfig()
		config.comfyui = {
			enabled: true,
			baseUrl: 'http://localhost:8188',
			timeoutMs: 5000,
			defaultSteps: 20,
			defaultCfg: 7.0,
		}
		saveConfig(config)
		invalidateConfigCache()

		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.generate.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ prompt: 'a cat', negative: '', width: 512, height: 512, seed: -1, batch_size: 1 },
				{ toolCallId: 'test', messages: [] },
			),
		)
		expect(result.success).toBe(false)
		expect(result.error).toContain('checkpoint')
	})

	test('generate queues workflow and returns images on success', async () => {
		let fetchCallCount = 0
		const fakeImageData = new Uint8Array([137, 80, 78, 71])

		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (input: string | URL | Request) => {
				const url = String(input)
				fetchCallCount++

				// 1st call: POST /prompt
				if (url.endsWith('/prompt')) {
					return {
						ok: true,
						json: async () => ({ prompt_id: 'prompt-abc' }),
					} as Response
				}

				// 2nd+ calls: GET /history/prompt-abc
				if (url.includes('/history/prompt-abc')) {
					return {
						ok: true,
						json: async () => ({
							'prompt-abc': {
								status: { completed: true },
								outputs: {
									'7': {
										images: [{ filename: 'tamias_00001_.png', subfolder: '', type: 'output' }],
									},
								},
							},
						}),
					} as Response
				}

				// /view call
				if (url.includes('/view')) {
					return {
						ok: true,
						arrayBuffer: async () => fakeImageData.buffer,
					} as Response
				}

				return { ok: false, status: 404, text: async () => 'not found' } as Response
			}),
		})

		const emitter = new EventEmitter()
		const emittedEvents: Array<{ type: string }> = []
		emitter.on('event', (evt: { type: string }) => emittedEvents.push(evt))

		const tools = createComfyUITools(makeMockAIService(emitter), 'test-session')
		const execute = tools.generate.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ prompt: 'a beautiful cat', negative: 'ugly', width: 768, height: 768, seed: 42, batch_size: 1 },
				{ toolCallId: 'test', messages: [] },
			),
		)

		expect(result.success).toBe(true)
		expect(result.prompt_id).toBe('prompt-abc')
		expect(result.images).toHaveLength(1)
		expect(result.modelUsed).toBe('dreamshaper_8.safetensors')
		expect(result.steps).toBe(20)
		expect(result.seed).toBe(42)
		expect(result.width).toBe(768)
		expect(result.height).toBe(768)

		// Should have emitted progress-update and file events
		const fileEvents = emittedEvents.filter(e => e.type === 'file')
		expect(fileEvents.length).toBe(1)
		const progressEvents = emittedEvents.filter(e => e.type === 'progress-update')
		expect(progressEvents.length).toBeGreaterThanOrEqual(2)
	})

	test('generate handles network failure gracefully', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => {
				throw new Error('Connection refused')
			}),
		})

		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.generate.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ prompt: 'test', negative: '', width: 512, height: 512, seed: 1, batch_size: 1 },
				{ toolCallId: 'test', messages: [] },
			),
		)
		expect(result.success).toBe(false)
		expect(result.error).toContain('Connection refused')
	})

	test('generate works without session (no progress events)', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (input: string | URL | Request) => {
				const url = String(input)
				if (url.endsWith('/prompt')) {
					return { ok: true, json: async () => ({ prompt_id: 'p1' }) } as Response
				}
				if (url.includes('/history/')) {
					return {
						ok: true,
						json: async () => ({
							'p1': {
								status: { completed: true },
								outputs: { '7': { images: [{ filename: 'img.png', subfolder: '', type: 'output' }] } },
							},
						}),
					} as Response
				}
				if (url.includes('/view')) {
					return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response
				}
				return { ok: false, status: 404, text: async () => '' } as Response
			}),
		})

		// null session — should not crash
		const aiService = { getSession: () => null } as never
		const tools = createComfyUITools(aiService, 'test')
		const execute = tools.generate.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ prompt: 'test', negative: '', width: 512, height: 512, seed: 1, batch_size: 1 },
				{ toolCallId: 'test', messages: [] },
			),
		)
		expect(result.success).toBe(true)
	})

	test('run_workflow queues and retrieves output', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (input: string | URL | Request) => {
				const url = String(input)
				if (url.endsWith('/prompt')) {
					return { ok: true, json: async () => ({ prompt_id: 'wf-1' }) } as Response
				}
				if (url.includes('/history/')) {
					return {
						ok: true,
						json: async () => ({
							'wf-1': {
								status: { completed: true },
								outputs: {
									'10': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] },
								},
							},
						}),
					} as Response
				}
				if (url.includes('/view')) {
					return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as Response
				}
				return { ok: false, status: 404, text: async () => '' } as Response
			}),
		})

		const emitter = new EventEmitter()
		const tools = createComfyUITools(makeMockAIService(emitter), 'test-session')
		const execute = tools.run_workflow.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute(
				{ workflow: { '1': { class_type: 'Test', inputs: {} } } },
				{ toolCallId: 'test', messages: [] },
			),
		)
		expect(result.success).toBe(true)
		expect(result.prompt_id).toBe('wf-1')
		expect(result.images).toHaveLength(1)
	})

	test('list_models returns all model types', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: true,
				json: async () => ({
					CheckpointLoaderSimple: {
						input: { required: { ckpt_name: [['sd_xl.safetensors']] } },
					},
					LoraLoader: {
						input: { required: { lora_name: [['detail_lora.safetensors']] } },
					},
					VAELoader: {
						input: { required: { vae_name: [['sdxl_vae.safetensors']] } },
					},
				}),
			} as Response)),
		})

		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.list_models.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute({ type: 'all' }, { toolCallId: 'test', messages: [] }),
		)
		expect(result.success).toBe(true)
		expect(result.checkpoints).toEqual(['sd_xl.safetensors'])
		expect(result.loras).toEqual(['detail_lora.safetensors'])
		expect(result.vaes).toEqual(['sdxl_vae.safetensors'])
	})

	test('list_models filters by type', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: true,
				json: async () => ({
					CheckpointLoaderSimple: {
						input: { required: { ckpt_name: [['model_a.safetensors']] } },
					},
					LoraLoader: {
						input: { required: { lora_name: [['lora_a.safetensors']] } },
					},
					VAELoader: {
						input: { required: { vae_name: [] } },
					},
				}),
			} as Response)),
		})

		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.list_models.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute({ type: 'checkpoints' }, { toolCallId: 'test', messages: [] }),
		)
		expect(result.success).toBe(true)
		expect(result.checkpoints).toEqual(['model_a.safetensors'])
		expect(result.loras).toBeUndefined()
	})

	test('list_models handles fetch error gracefully', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => {
				throw new Error('ECONNREFUSED')
			}),
		})

		const tools = createComfyUITools(makeMockAIService(), 'test-session')
		const execute = tools.list_models.execute
		if (!execute) throw new Error('Missing execute')

		const result = await resolveToolResult<ToolResult>(
			await execute({ type: 'all' }, { toolCallId: 'test', messages: [] }),
		)
		expect(result.success).toBe(false)
		expect(result.error).toContain('ECONNREFUSED')
	})
})

describe('pollUntilDone', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('times out when job never completes', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: true,
				json: async () => ({}),
			} as Response)),
		})

		await expect(
			pollUntilDone('never-done', { baseUrl: 'http://localhost:8188', timeoutMs: 1500 }),
		).rejects.toThrow('timed out')
	})

	test('returns entry when status is completed', async () => {
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: true,
				json: async () => ({
					'my-id': {
						status: { completed: true },
						outputs: { '7': { images: [] } },
					},
				}),
			} as Response)),
		})

		const result = await pollUntilDone('my-id', {
			baseUrl: 'http://localhost:8188',
			timeoutMs: 10000,
		})
		expect(result.status?.completed).toBe(true)
	})

	test('emits progress events during polling', async () => {
		let callCount = 0
		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => {
				callCount++
				if (callCount >= 4) {
					return {
						ok: true,
						json: async () => ({
							'p': { status: { completed: true }, outputs: {} },
						}),
					} as Response
				}
				// Return 404 to simulate job still queued
				return { ok: false, status: 404 } as Response
			}),
		})

		const events: Array<{ type: string; title?: string }> = []
		const result = await pollUntilDone(
			'p',
			{ baseUrl: 'http://localhost:8188', timeoutMs: 30000 },
			(event) => events.push(event as { type: string; title?: string }),
		)
		expect(result.status?.completed).toBe(true)
		// Should have emitted at least one progress event during polling + one completion event
		expect(events.some(e => e.type === 'progress-update')).toBe(true)
	})
})
