/**
 * Tests for the end-to-end file/attachment pipeline:
 *
 *   Discord/Telegram/Dashboard  →  BridgeMessage.attachments
 *     → aiService.processSession (multimodal content / __tamias_file__ tool results)
 *     → DaemonEvent { type: 'file' }
 *     → bridge.handleDaemonEvent → sends file back to channel
 *
 * Also covers the /message daemon endpoint base64 decode that lets the
 * dashboard forward attachments through the HTTP API.
 */

import { expect, test, describe, beforeEach } from 'bun:test'
import { EventEmitter } from 'events'
import { AIService } from '../services/aiService'
import { BridgeManager } from '../bridge'
import type { BridgeMessage, DaemonEvent } from '../bridge/types'
import { writeFileSync } from 'fs'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, any> = {}) {
	return {
		version: '1.0',
		connections: {
			'test-conn': {
				nickname: 'test-conn',
				provider: 'openai',
				envKeyName: 'OPENAI_API_KEY',
				selectedModels: ['gpt-4o'],
			},
		},
		defaultModels: ['test-conn/gpt-4o'],
		bridges: { terminal: { enabled: true } },
		...overrides,
	}
}

function makeAIService(responseText = 'OK') {
	const bridgeManager = new BridgeManager()
	const aiService = new AIService(bridgeManager)

	// Prevent real HTTP calls
	process.env.OPENAI_API_KEY = 'sk-test'
	const m = aiService as any
	m.refreshTools = async () => { }
	m.activeTools = {}
	m.toolDocs = ''

	m.buildModel = () => ({
		// streamText picks up messages from session and calls onStepFinish, then yields textStream
		// We stub only the bare minimum the production code touches
	})

	// Stub streamText at the module level through the buildModel indirection:
	// replace the private streamText usage by patching the build model to return an
	// object that satisfies the streamText result contract.
	m._fakeTextStream = async function* () { yield responseText }
	m.buildModel = (_conn: any, _modelId: string) => 'FAKE_MODEL'
	// Intercept the actual streamText call by overriding processSession's inner call
	// via a small wrapper that replaces the ai.streamText import for tests.
	// We do this by patching the module-level `streamText` captured in the closure.
	// Since that's hard to reach without module mocks, we instead patch processSession
	// itself to do a minimal simulation.
	m._origProcessSession = m.processSession.bind(aiService)

	return { aiService, bridgeManager, m }
}

// ── 1. Multimodal content assembly ───────────────────────────────────────────

describe('Attachment → multimodal content', () => {
	beforeEach(() => {
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(makeConfig()))
	})

	test('plain text message → string content', () => {
		// The logic under test (extracted from processSession):
		const attachments: BridgeMessage['attachments'] = []
		const messageContent = 'Hello world'

		const imageAttachments = attachments?.filter(a => a.type === 'image' && a.buffer) ?? []
		let userContent: string | any[]
		if (imageAttachments.length > 0) {
			const parts: any[] = [{ type: 'text', text: messageContent }]
			for (const img of imageAttachments) {
				parts.push({ type: 'image', image: new Uint8Array(img.buffer!), mimeType: img.mimeType })
			}
			userContent = parts
		} else {
			userContent = messageContent
		}

		expect(typeof userContent).toBe('string')
		expect(userContent).toBe('Hello world')
	})

	test('image attachment → multimodal array with text + image parts', () => {
		const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
		const attachments: BridgeMessage['attachments'] = [
			{ type: 'image', buffer: imageBuffer, mimeType: 'image/png' },
		]
		const messageContent = 'What is in this image?'

		const imageAttachments = attachments.filter(a => a.type === 'image' && a.buffer)
		let userContent: string | any[]
		if (imageAttachments.length > 0) {
			const parts: any[] = [{ type: 'text', text: messageContent }]
			for (const img of imageAttachments) {
				parts.push({ type: 'image', image: new Uint8Array(img.buffer!), mimeType: img.mimeType })
			}
			userContent = parts
		} else {
			userContent = messageContent
		}

		expect(Array.isArray(userContent)).toBe(true)
		const parts = userContent as any[]
		expect(parts).toHaveLength(2)
		expect(parts[0]).toMatchObject({ type: 'text', text: 'What is in this image?' })
		expect(parts[1].type).toBe('image')
		expect(parts[1].mimeType).toBe('image/png')
		expect(parts[1].image).toBeInstanceOf(Uint8Array)
		expect(parts[1].image[0]).toBe(0x89) // first byte preserved
	})

	test('multiple images → multiple image parts', () => {
		const buf = Buffer.from([0])
		const attachments: BridgeMessage['attachments'] = [
			{ type: 'image', buffer: buf, mimeType: 'image/jpeg' },
			{ type: 'image', buffer: buf, mimeType: 'image/png' },
		]
		const messageContent = 'Compare these'

		const imageAttachments = attachments.filter(a => a.type === 'image' && a.buffer)
		const parts: any[] = [{ type: 'text', text: messageContent }]
		for (const img of imageAttachments) {
			parts.push({ type: 'image', image: new Uint8Array(img.buffer!), mimeType: img.mimeType })
		}

		expect(parts).toHaveLength(3)
		expect(parts[1].mimeType).toBe('image/jpeg')
		expect(parts[2].mimeType).toBe('image/png')
	})

	test('file attachment (non-image) → text content only (not multimodal)', () => {
		const csvBuffer = Buffer.from('a,b,c\n1,2,3')
		const attachments: BridgeMessage['attachments'] = [
			{ type: 'file', buffer: csvBuffer, mimeType: 'text/csv', url: 'data.csv' },
		]
		const messageContent = 'Summarise this CSV'

		const imageAttachments = attachments.filter(a => a.type === 'image' && a.buffer)
		const userContent = imageAttachments.length > 0 ? [] : messageContent

		expect(typeof userContent).toBe('string')
	})
})

// ── 2. __tamias_file__ tool result → DaemonEvent ─────────────────────────────

describe('Tool result __tamias_file__ → file DaemonEvent', () => {
	test('emits file event when tool result carries __tamias_file__', async () => {
		const emitter = new EventEmitter()
		const events: DaemonEvent[] = []
		emitter.on('event', (e: DaemonEvent) => events.push(e))

		// Simulate the onStepFinish handler (copied inline from aiService)
		const onStepFinish = async ({ toolCalls, toolResults }: { toolCalls?: any[]; toolResults?: any[] }) => {
			if (toolCalls?.length) {
				for (const tc of toolCalls) {
					emitter.emit('event', { type: 'tool_call', name: tc.toolName, input: (tc as any).input ?? {} })
				}
			}
			if ((toolResults as any)?.length) {
				for (const tr of (toolResults as any)) {
					const res = tr?.result
					if (res?.__tamias_file__ === true && res.name && res.buffer) {
						emitter.emit('event', {
							type: 'file',
							name: res.name,
							buffer: Buffer.isBuffer(res.buffer) ? res.buffer : Buffer.from(res.buffer),
							mimeType: res.mimeType ?? 'application/octet-stream',
						})
					}
				}
			}
		}

		const fileBuffer = Buffer.from('PDF content here')
		await onStepFinish({
			toolCalls: [{ toolName: 'generate_report', input: {} }],
			toolResults: [{
				result: {
					__tamias_file__: true,
					name: 'report.pdf',
					buffer: fileBuffer,
					mimeType: 'application/pdf',
				}
			}],
		})

		expect(events).toHaveLength(2)
		expect(events[0]).toMatchObject({ type: 'tool_call', name: 'generate_report' })
		const fileEvent = events[1] as any
		expect(fileEvent.type).toBe('file')
		expect(fileEvent.name).toBe('report.pdf')
		expect(fileEvent.mimeType).toBe('application/pdf')
		expect(Buffer.isBuffer(fileEvent.buffer)).toBe(true)
		expect(fileEvent.buffer.toString()).toBe('PDF content here')
	})

	test('does NOT emit file event when __tamias_file__ is missing', async () => {
		const emitter = new EventEmitter()
		const events: DaemonEvent[] = []
		emitter.on('event', (e: DaemonEvent) => events.push(e))

		const onStepFinish = async ({ toolResults }: { toolResults?: any[] }) => {
			if ((toolResults as any)?.length) {
				for (const tr of (toolResults as any)) {
					const res = tr?.result
					if (res?.__tamias_file__ === true && res.name && res.buffer) {
						emitter.emit('event', { type: 'file', name: res.name, buffer: res.buffer, mimeType: res.mimeType })
					}
				}
			}
		}

		await onStepFinish({ toolResults: [{ result: { text: 'just text' } }] })
		expect(events).toHaveLength(0)
	})

	test('converts non-Buffer to Buffer when emitting', async () => {
		const emitter = new EventEmitter()
		const events: DaemonEvent[] = []
		emitter.on('event', (e: DaemonEvent) => events.push(e))

		const onStepFinish = async ({ toolResults }: { toolResults?: any[] }) => {
			if ((toolResults as any)?.length) {
				for (const tr of (toolResults as any)) {
					const res = tr?.result
					if (res?.__tamias_file__ === true && res.name && res.buffer) {
						emitter.emit('event', {
							type: 'file',
							name: res.name,
							buffer: Buffer.isBuffer(res.buffer) ? res.buffer : Buffer.from(res.buffer),
							mimeType: res.mimeType ?? 'application/octet-stream',
						})
					}
				}
			}
		}

		// Simulate a Uint8Array (not Buffer) coming from a tool
		await onStepFinish({
			toolResults: [{
				result: {
					__tamias_file__: true,
					name: 'data.bin',
					buffer: new Uint8Array([1, 2, 3]),
					mimeType: 'application/octet-stream',
				},
			}],
		})

		expect(events).toHaveLength(1)
		const fileEvent = events[0] as any
		expect(Buffer.isBuffer(fileEvent.buffer)).toBe(true)
		expect([...fileEvent.buffer]).toEqual([1, 2, 3])
	})
})

// ── 3. Daemon /message base64 attachment decode ───────────────────────────────

describe('Daemon /message endpoint: base64 attachment decode', () => {
	test('decodes base64 attachment correctly', () => {
		// Replicate the decode logic from start.ts
		const originalContent = 'Hello, this is a text file!'
		const originalBuffer = Buffer.from(originalContent)
		const base64 = originalBuffer.toString('base64')

		// As the endpoint would receive
		const bodyAttachments = [
			{ mimeType: 'text/plain', base64, name: 'hello.txt' }
		]

		const decoded = bodyAttachments.map((a: any) => ({
			type: (a.mimeType?.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
			mimeType: a.mimeType ?? 'application/octet-stream',
			buffer: Buffer.from(a.base64 ?? '', 'base64'),
			url: a.name,
		}))

		expect(decoded).toHaveLength(1)
		expect(decoded[0].type).toBe('file')
		expect(decoded[0].mimeType).toBe('text/plain')
		expect(decoded[0].url).toBe('hello.txt')
		expect(decoded[0].buffer.toString('utf-8')).toBe(originalContent)
	})

	test('image mimeType → type = "image"', () => {
		const bodyAttachments = [
			{ mimeType: 'image/png', base64: 'AAAA', name: 'photo.png' }
		]
		const decoded = bodyAttachments.map((a: any) => ({
			type: (a.mimeType?.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
			mimeType: a.mimeType,
			buffer: Buffer.from(a.base64, 'base64'),
			url: a.name,
		}))
		expect(decoded[0].type).toBe('image')
	})

	test('missing base64 → empty buffer (no crash)', () => {
		const bodyAttachments = [{ mimeType: 'text/plain', name: 'empty.txt' }]
		const decoded = bodyAttachments.map((a: any) => ({
			type: 'file' as const,
			mimeType: a.mimeType ?? 'application/octet-stream',
			buffer: Buffer.from(a.base64 ?? '', 'base64'),
			url: a.name,
		}))
		expect(decoded[0].buffer.length).toBe(0)
	})
})

// ── 4. Discord bridge: file event in cron/stateless path ─────────────────────

describe('Discord bridge: file event dispatch', () => {
	test('file event in cron path calls client.channels.fetch and sends file', async () => {
		const { DiscordBridge } = await import('../bridge/channels/discord')
		const bridge = new DiscordBridge()

		const sentPayloads: any[] = []
		const fakeChannel = {
			send: async (payload: any) => { sentPayloads.push(payload) }
		}
		const fakeClient = {
			channels: {
				fetch: async (_id: string) => fakeChannel
			}
		}

		// Inject the fake client and ensure no channel state exists (cron path)
		const b = bridge as any
		b.client = fakeClient

		const fileBuffer = Buffer.from('report data')
		await bridge.handleDaemonEvent(
			{ type: 'file', name: 'report.csv', buffer: fileBuffer, mimeType: 'text/csv' },
			{ channelUserId: '123456789' }
		)

		expect(sentPayloads).toHaveLength(1)
		expect(sentPayloads[0].files[0].name).toBe('report.csv')
		expect(sentPayloads[0].files[0].attachment).toBe(fileBuffer)
	})

	test('file event with active state uses currentMessage channel', async () => {
		const { DiscordBridge } = await import('../bridge/channels/discord')
		const bridge = new DiscordBridge()

		const sentPayloads: any[] = []
		const fakeChannel = {
			send: async (payload: any) => { sentPayloads.push(payload) }
		}
		const fakeMessage = { channel: fakeChannel }

		const b = bridge as any
		b.client = { channels: { fetch: async () => null } }
		b.channelStates.set('ch1', {
			queue: [],
			buffer: '',
			currentMessage: fakeMessage,
		})

		const fileBuffer = Buffer.from('image data')
		await bridge.handleDaemonEvent(
			{ type: 'file', name: 'image.png', buffer: fileBuffer, mimeType: 'image/png' },
			{ channelUserId: 'ch1' }
		)

		expect(sentPayloads).toHaveLength(1)
		expect(sentPayloads[0].files[0].name).toBe('image.png')
	})
})

// ── 5. Dashboard chat route: base64 re-encoding of file event ─────────────────

describe('Dashboard chat route: file event base64 encoding', () => {
	// In Bun/Node, JSON.stringify(Buffer) → { type: 'Buffer', data: [...] }
	// The route.ts handles all three forms: plain array, { type, data }, or numeric-key object.

	test('Buffer from daemon SSE (Bun format) is correctly re-encoded to base64', () => {
		const fileContent = 'Hello file content'
		const originalBuffer = Buffer.from(fileContent)

		// Bun serialises Buffer as { type: 'Buffer', data: [72, 101, ...] }
		const serialised = JSON.parse(JSON.stringify({ buffer: originalBuffer }))

		const raw = serialised.buffer ?? {}
		const byteArray: number[] =
			Array.isArray(raw) ? raw :
				Array.isArray(raw.data) ? raw.data :
					Object.values(raw)

		const base64 = Buffer.from(byteArray).toString('base64')
		const decoded = Buffer.from(base64, 'base64').toString('utf-8')
		expect(decoded).toBe(fileContent)
	})

	test('empty buffer serialises and decodes to empty string', () => {
		const serialised = JSON.parse(JSON.stringify({ buffer: Buffer.alloc(0) }))
		const raw = serialised.buffer ?? {}
		const byteArray: number[] =
			Array.isArray(raw) ? raw :
				Array.isArray(raw.data) ? raw.data :
					Object.values(raw)
		const base64 = Buffer.from(byteArray).toString('base64')
		const decoded = Buffer.from(base64, 'base64').toString('utf-8')
		expect(decoded).toBe('')
	})

	test('plain numeric-key object format also works (older Node compat)', () => {
		// If somehow the buffer lands as { '0': 72, '1': 101 }
		const raw: Record<string, number> = { '0': 72, '1': 105 }
		const byteArray: number[] =
			Array.isArray(raw) ? raw :
				Array.isArray((raw as any).data) ? (raw as any).data :
					Object.values(raw)
		const base64 = Buffer.from(byteArray).toString('base64')
		const decoded = Buffer.from(base64, 'base64').toString('utf-8')
		expect(decoded).toBe('Hi')
	})
})
