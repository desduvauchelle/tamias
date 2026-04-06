import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import type { DaemonEvent } from '../bridge/types.ts'
import { getComfyUIConfig } from '../utils/config.ts'

export const COMFYUI_TOOL_NAME = 'comfyui'
export const COMFYUI_TOOL_LABEL = '🎨 ComfyUI (local image generation via ComfyUI API)'

// ─── Workflow Builder ────────────────────────────────────────────────────────

interface TextToImageParams {
	prompt: string
	negative: string
	width: number
	height: number
	steps: number
	cfg: number
	checkpoint: string
	seed: number
	batchSize: number
}

/**
 * Build the canonical ComfyUI KSampler text-to-image workflow:
 *
 *   CheckpointLoaderSimple ─→ CLIPTextEncode (positive) ─┐
 *                           → CLIPTextEncode (negative) ─┤→ KSampler → VAEDecode → SaveImage
 *                           → EmptyLatentImage ──────────┘
 */
export function buildTextToImageWorkflow(params: TextToImageParams): Record<string, unknown> {
	return {
		'1': {
			class_type: 'CheckpointLoaderSimple',
			inputs: { ckpt_name: params.checkpoint },
		},
		'2': {
			class_type: 'CLIPTextEncode',
			inputs: { text: params.prompt, clip: ['1', 1] },
		},
		'3': {
			class_type: 'CLIPTextEncode',
			inputs: { text: params.negative, clip: ['1', 1] },
		},
		'4': {
			class_type: 'EmptyLatentImage',
			inputs: { width: params.width, height: params.height, batch_size: params.batchSize },
		},
		'5': {
			class_type: 'KSampler',
			inputs: {
				model: ['1', 0],
				positive: ['2', 0],
				negative: ['3', 0],
				latent_image: ['4', 0],
				seed: params.seed,
				steps: params.steps,
				cfg: params.cfg,
				sampler_name: 'euler',
				scheduler: 'normal',
				denoise: 1.0,
			},
		},
		'6': {
			class_type: 'VAEDecode',
			inputs: { samples: ['5', 0], vae: ['1', 2] },
		},
		'7': {
			class_type: 'SaveImage',
			inputs: { images: ['6', 0], filename_prefix: 'tamias' },
		},
	}
}

// ─── ComfyUI API Helpers ─────────────────────────────────────────────────────

interface ComfyUIApiOptions {
	baseUrl: string
	authToken?: string
	timeoutMs: number
}

function makeHeaders(authToken?: string): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (authToken) headers['Authorization'] = `Bearer ${authToken}`
	return headers
}

/**
 * Queue a workflow on ComfyUI and return the prompt_id.
 */
export async function queuePrompt(
	workflow: Record<string, unknown>,
	opts: ComfyUIApiOptions,
): Promise<{ prompt_id: string }> {
	const url = `${opts.baseUrl.replace(/\/+$/, '')}/prompt`
	const response = await fetch(url, {
		method: 'POST',
		headers: makeHeaders(opts.authToken),
		body: JSON.stringify({ prompt: workflow }),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`ComfyUI /prompt failed (HTTP ${response.status}): ${text}`)
	}

	const data = await response.json() as { prompt_id: string }
	return { prompt_id: data.prompt_id }
}

interface HistoryEntry {
	status?: { completed?: boolean; status_str?: string }
	outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>
}

/**
 * Poll /history/{prompt_id} until the job completes or times out.
 * Emits progress-update events via the session emitter.
 */
export async function pollUntilDone(
	promptId: string,
	opts: ComfyUIApiOptions,
	emitProgress?: (event: DaemonEvent) => void,
): Promise<HistoryEntry> {
	const deadline = Date.now() + opts.timeoutMs
	const historyUrl = `${opts.baseUrl.replace(/\/+$/, '')}/history/${promptId}`
	let pollCount = 0

	while (Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, 1000))
		pollCount++

		const response = await fetch(historyUrl, {
			headers: makeHeaders(opts.authToken),
		})

		if (!response.ok) {
			if (response.status === 404) {
				// Job not yet in history — still running
				if (emitProgress && pollCount % 3 === 0) {
					emitProgress({
						type: 'progress-update',
						title: '🎨 ComfyUI',
						message: 'Generating…',
						step: pollCount,
						totalSteps: Math.ceil(opts.timeoutMs / 1000),
					})
				}
				continue
			}
			throw new Error(`ComfyUI /history failed (HTTP ${response.status})`)
		}

		const data = await response.json() as Record<string, HistoryEntry>
		const entry = data[promptId]
		if (!entry) continue

		if (entry.status?.completed || entry.status?.status_str === 'success' || entry.outputs) {
			emitProgress?.({
				type: 'progress-update',
				title: '🎨 ComfyUI',
				message: 'Generation complete — fetching images',
				step: 1,
				totalSteps: 1,
			})
			return entry
		}
	}

	throw new Error(`ComfyUI generation timed out after ${opts.timeoutMs}ms`)
}

/**
 * Fetch a generated image from ComfyUI /view endpoint.
 */
export async function fetchImage(
	filename: string,
	subfolder: string,
	type: string,
	opts: ComfyUIApiOptions,
): Promise<Buffer> {
	const params = new URLSearchParams({ filename, subfolder, type })
	const url = `${opts.baseUrl.replace(/\/+$/, '')}/view?${params.toString()}`
	const response = await fetch(url, {
		headers: opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : undefined,
	})

	if (!response.ok) {
		throw new Error(`ComfyUI /view failed for ${filename} (HTTP ${response.status})`)
	}

	const arrayBuffer = await response.arrayBuffer()
	return Buffer.from(arrayBuffer)
}

/**
 * Fetch available model lists from ComfyUI /object_info endpoint.
 */
export async function fetchModelList(
	opts: ComfyUIApiOptions,
): Promise<{ checkpoints: string[]; loras: string[]; vaes: string[] }> {
	const url = `${opts.baseUrl.replace(/\/+$/, '')}/object_info`
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), opts.timeoutMs)

	try {
		const response = await fetch(url, {
			headers: makeHeaders(opts.authToken),
			signal: controller.signal,
		})

		if (!response.ok) {
			throw new Error(`ComfyUI /object_info failed (HTTP ${response.status})`)
		}

		const data = await response.json() as Record<string, {
			input?: { required?: Record<string, [string[] | unknown]> }
		}>

		const extractChoices = (nodeType: string, inputName: string): string[] => {
			const node = data[nodeType]
			if (!node?.input?.required?.[inputName]) return []
			const value = node.input.required[inputName][0]
			return Array.isArray(value) ? value as string[] : []
		}

		return {
			checkpoints: extractChoices('CheckpointLoaderSimple', 'ckpt_name'),
			loras: extractChoices('LoraLoader', 'lora_name'),
			vaes: extractChoices('VAELoader', 'vae_name'),
		}
	} finally {
		clearTimeout(timeout)
	}
}

// ─── Tool Factory ────────────────────────────────────────────────────────────

export function createComfyUITools(aiService: AIService, sessionId: string) {
	return {
		generate: tool({
			description:
				'Generate an image using a local ComfyUI instance. Builds a standard text-to-image ' +
				'workflow (KSampler) from the provided prompt and settings. Returns the generated image ' +
				'as a file delivered to the chat.',
			inputSchema: z.object({
				prompt: z.string().describe('Positive text prompt describing the image to generate.'),
				negative: z.string().optional().default('').describe('Negative prompt — things to avoid.'),
				width: z.number().int().min(64).max(4096).optional().default(512).describe('Image width in pixels.'),
				height: z.number().int().min(64).max(4096).optional().default(512).describe('Image height in pixels.'),
				steps: z.number().int().min(1).max(200).optional().describe('Number of sampling steps. Falls back to config default.'),
				cfg: z.number().min(0).max(30).optional().describe('CFG scale. Falls back to config default.'),
				checkpoint: z.string().optional().describe('Checkpoint model name. Falls back to config default.'),
				seed: z.number().int().optional().default(-1).describe('Random seed. Use -1 for random.'),
				batch_size: z.number().int().min(1).max(8).optional().default(1).describe('Number of images to generate.'),
			}),
			execute: async (params) => {
				const config = getComfyUIConfig()
				if (!config.enabled) {
					return {
						success: false,
						error: 'ComfyUI is disabled. Enable it in config → comfyui.enabled.',
					}
				}

				const checkpoint = params.checkpoint ?? config.defaultCheckpoint
				if (!checkpoint) {
					return {
						success: false,
						error: 'No checkpoint specified and no defaultCheckpoint in config. ' +
							'Set comfyui.defaultCheckpoint or pass a checkpoint parameter.',
					}
				}

				const steps = params.steps ?? config.defaultSteps
				const cfg = params.cfg ?? config.defaultCfg
				const seed = params.seed === -1 ? Math.floor(Math.random() * 2_147_483_647) : params.seed

				const session = aiService.getSession(sessionId)
				const emitProgress = session
					? (event: DaemonEvent) => session.emitter.emit('event', event)
					: undefined

				emitProgress?.({
					type: 'progress-update',
					title: '🎨 ComfyUI',
					message: 'Queueing workflow…',
					step: 1,
					totalSteps: 4,
				})

				const apiOpts: ComfyUIApiOptions = {
					baseUrl: config.baseUrl,
					authToken: config.authToken,
					timeoutMs: config.timeoutMs,
				}

				try {
					const workflow = buildTextToImageWorkflow({
						prompt: params.prompt,
						negative: params.negative ?? '',
						width: params.width ?? 512,
						height: params.height ?? 512,
						steps,
						cfg,
						checkpoint,
						seed,
						batchSize: params.batch_size ?? 1,
					})

					const { prompt_id } = await queuePrompt(workflow, apiOpts)

					emitProgress?.({
						type: 'progress-update',
						title: '🎨 ComfyUI',
						message: `Queued — prompt_id: ${prompt_id}`,
						step: 2,
						totalSteps: 4,
					})

					const entry = await pollUntilDone(prompt_id, apiOpts, emitProgress)

					// Collect all output images
					const images: Array<{ fileName: string }> = []

					if (entry.outputs) {
						for (const nodeOutput of Object.values(entry.outputs)) {
							if (!nodeOutput.images) continue
							for (const img of nodeOutput.images) {
								const buffer = await fetchImage(
									img.filename,
									img.subfolder,
									img.type,
									apiOpts,
								)

								const fileName = `comfyui_${Date.now()}_${img.filename}`
								images.push({ fileName })

								session?.emitter.emit('event', {
									type: 'file',
									name: fileName,
									buffer,
									mimeType: 'image/png',
								} as DaemonEvent)
							}
						}
					}

					emitProgress?.({
						type: 'progress-update',
						title: '🎨 ComfyUI',
						message: `Done — ${images.length} image(s) generated`,
						step: 4,
						totalSteps: 4,
					})

					return {
						success: true,
						prompt_id,
						images,
						modelUsed: checkpoint,
						steps,
						cfg,
						seed,
						width: params.width ?? 512,
						height: params.height ?? 512,
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						success: false,
						error: `ComfyUI generation failed: ${message}`,
					}
				}
			},
		}),

		run_workflow: tool({
			description:
				'Run an arbitrary ComfyUI workflow (JSON node graph) on the local ComfyUI instance. ' +
				'The workflow should be a valid ComfyUI API-format prompt object.',
			inputSchema: z.object({
				workflow: z.record(z.string(), z.unknown()).describe(
					'ComfyUI workflow JSON in API format — keys are node IDs, values are node definitions with class_type and inputs.',
				),
			}),
			execute: async ({ workflow }) => {
				const config = getComfyUIConfig()
				if (!config.enabled) {
					return {
						success: false,
						error: 'ComfyUI is disabled. Enable it in config → comfyui.enabled.',
					}
				}

				const session = aiService.getSession(sessionId)
				const emitProgress = session
					? (event: DaemonEvent) => session.emitter.emit('event', event)
					: undefined

				const apiOpts: ComfyUIApiOptions = {
					baseUrl: config.baseUrl,
					authToken: config.authToken,
					timeoutMs: config.timeoutMs,
				}

				try {
					emitProgress?.({
						type: 'progress-update',
						title: '🎨 ComfyUI',
						message: 'Queueing custom workflow…',
						step: 1,
						totalSteps: 3,
					})

					const { prompt_id } = await queuePrompt(workflow, apiOpts)

					emitProgress?.({
						type: 'progress-update',
						title: '🎨 ComfyUI',
						message: `Queued — prompt_id: ${prompt_id}`,
						step: 2,
						totalSteps: 3,
					})

					const entry = await pollUntilDone(prompt_id, apiOpts, emitProgress)

					const images: Array<{ fileName: string }> = []

					if (entry.outputs) {
						for (const nodeOutput of Object.values(entry.outputs)) {
							if (!nodeOutput.images) continue
							for (const img of nodeOutput.images) {
								const buffer = await fetchImage(
									img.filename,
									img.subfolder,
									img.type,
									apiOpts,
								)

								const fileName = `comfyui_${Date.now()}_${img.filename}`
								images.push({ fileName })

								session?.emitter.emit('event', {
									type: 'file',
									name: fileName,
									buffer,
									mimeType: 'image/png',
								} as DaemonEvent)
							}
						}
					}

					return {
						success: true,
						prompt_id,
						images,
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						success: false,
						error: `ComfyUI workflow failed: ${message}`,
					}
				}
			},
		}),

		list_models: tool({
			description:
				'List available models (checkpoints, LoRAs, VAEs) on the local ComfyUI instance.',
			inputSchema: z.object({
				type: z.enum(['checkpoints', 'loras', 'vaes', 'all']).optional().default('all')
					.describe('Which model type to list. Defaults to all.'),
			}),
			execute: async ({ type }) => {
				const config = getComfyUIConfig()
				if (!config.enabled) {
					return {
						success: false,
						error: 'ComfyUI is disabled. Enable it in config → comfyui.enabled.',
					}
				}

				const apiOpts: ComfyUIApiOptions = {
					baseUrl: config.baseUrl,
					authToken: config.authToken,
					timeoutMs: config.timeoutMs,
				}

				try {
					const models = await fetchModelList(apiOpts)

					if (type === 'all') return { success: true, ...models }
					return { success: true, [type]: models[type] }
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						success: false,
						error: `ComfyUI list models failed: ${message}`,
					}
				}
			},
		}),
	}
}
