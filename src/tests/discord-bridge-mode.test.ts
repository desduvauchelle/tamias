import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { join } from 'path'

const SRC_ROOT = join(import.meta.dir, '..')
const CONFIG_PATH = join(SRC_ROOT, 'utils', 'config.ts')

const mockGetBotTokenForInstance = mock(() => 'fake-discord-token')

class FakeClient {
	public user = { id: 'bot-123', tag: 'bot#0001' }
	public channels = { fetch: mock(async () => null) }
	private handlers = new Map<string, (...args: any[]) => any>()

	constructor(_opts?: unknown) { }

	on(event: string, handler: (...args: any[]) => any) {
		this.handlers.set(event, handler)
		return this
	}

	once(event: string, handler: (...args: any[]) => any) {
		this.handlers.set(event, handler)
		return this
	}

	async login(_token: string) {
		const ready = this.handlers.get('ready')
		if (ready) ready(this)
		return 'ok'
	}

	destroy() { }

	emit(event: string, ...args: any[]) {
		return this.handlers.get(event)?.(...args)
	}
}

const createdClients: FakeClient[] = []

mock.module(CONFIG_PATH, () => ({
	getBotTokenForInstance: mockGetBotTokenForInstance,
}))

mock.module('discord.js', () => ({
	Client: class extends FakeClient {
		constructor(opts?: unknown) {
			super(opts)
			createdClients.push(this)
		}
	},
	GatewayIntentBits: {
		Guilds: 1,
		GuildMessages: 2,
		MessageContent: 4,
	},
	Events: {
		MessageCreate: 'messageCreate',
		ClientReady: 'ready',
	},
}))

import { DiscordBridge } from '../bridge/channels/discord.ts'

function makeMessage({ mentioned }: { mentioned: boolean }) {
	const react = mock(async (_emoji: string) => ({}))
	return {
		id: `m-${Math.random().toString(36).slice(2)}`,
		author: { bot: false, id: 'u-1', username: 'alice' },
		channelId: '11111111111111111',
		content: 'hello world',
		guild: { name: 'Guild' },
		channel: { name: 'general' },
		attachments: new Map(),
		mentions: { users: { has: (_id: string) => mentioned } },
		react,
		reactions: { cache: new Map() },
	}
}

function makeVoiceMessage({ contentType = 'audio/ogg', filename = 'voice-message.ogg', withQueryString = false } = {}) {
	const react = mock(async (_emoji: string) => ({}))
	const url = withQueryString
		? `https://cdn.discordapp.com/attachments/123/456/${filename}?ex=AABBCC&is=DDEEFF&hm=AABBCCDD`
		: `https://cdn.discordapp.com/attachments/123/456/${filename}`
	const attachmentEntry = {
		id: 'att-1',
		url,
		name: filename,
		contentType,
		size: 1024,
	}
	const attachments = new Map([['att-1', attachmentEntry]])
	return {
		id: `m-${Math.random().toString(36).slice(2)}`,
		author: { bot: false, id: 'u-1', username: 'alice' },
		channelId: '11111111111111111',
		content: '',
		guild: { name: 'Guild' },
		channel: { name: 'general' },
		attachments,
		mentions: { users: { has: (_id: string) => false } },
		react,
		reactions: { cache: new Map() },
	}
}

describe('DiscordBridge mode gating', () => {
	beforeEach(() => {
		createdClients.length = 0
		mockGetBotTokenForInstance.mockClear()
		mockGetBotTokenForInstance.mockImplementation(() => 'fake-discord-token')
	})

	test('defaults to full mode and handles non-mentioned messages', async () => {
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: {
				discords: {
					default: {
						enabled: true,
						allowedChannels: [],
					},
				},
			},
		} as any, onMessage)

		expect(createdClients.length).toBe(1)
		const client = createdClients[0]
		const msg = makeMessage({ mentioned: false })

		await client.emit('messageCreate', msg)

		expect(onMessage).toHaveBeenCalledTimes(1)
		expect(msg.react).toHaveBeenCalledWith('👀')
	})

	test('mention-only mode ignores non-mentions and handles mentions', async () => {
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: {
				discords: {
					default: {
						enabled: true,
						mode: 'mention-only',
					},
				},
			},
		} as any, onMessage)

		expect(createdClients.length).toBe(1)
		const client = createdClients[0]

		const nonMentionMsg = makeMessage({ mentioned: false })
		await client.emit('messageCreate', nonMentionMsg)
		expect(onMessage).toHaveBeenCalledTimes(0)

		const mentionMsg = makeMessage({ mentioned: true })
		await client.emit('messageCreate', mentionMsg)
		expect(onMessage).toHaveBeenCalledTimes(1)
		expect(mentionMsg.react).toHaveBeenCalledWith('👀')
	})

	test('listen-only mode ignores all messages', async () => {
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: {
				discords: {
					default: {
						enabled: true,
						mode: 'listen-only',
					},
				},
			},
		} as any, onMessage)

		expect(createdClients.length).toBe(1)
		const client = createdClients[0]

		const msg = makeMessage({ mentioned: true })
		await client.emit('messageCreate', msg)

		expect(onMessage).toHaveBeenCalledTimes(0)
		expect(msg.react).toHaveBeenCalledTimes(0)
	})

	test('queues subsequent messages with hourglass reaction', async () => {
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: {
				discords: {
					default: {
						enabled: true,
						allowedChannels: [],
					},
				},
			},
		} as any, onMessage)

		expect(createdClients.length).toBe(1)
		const client = createdClients[0]

		const first = makeMessage({ mentioned: false })
		const second = makeMessage({ mentioned: false })

		await client.emit('messageCreate', first)
		await client.emit('messageCreate', second)

		expect(first.react).toHaveBeenCalledWith('👀')
		expect(second.react).toHaveBeenCalledWith('⏳')
	})
})

// ── Audio attachment classification ──────────────────────────────────────────

describe('DiscordBridge audio attachment handling', () => {
	let originalFetch: typeof globalThis.fetch

	beforeEach(() => {
		createdClients.length = 0
		mockGetBotTokenForInstance.mockClear()
		mockGetBotTokenForInstance.mockImplementation(() => 'fake-discord-token')
		originalFetch = globalThis.fetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	function mockFetchWithAudio(content = 'fake ogg bytes') {
		const audioBuffer = Buffer.from(content)
		globalThis.fetch = mock(async (_url: string) => ({
			ok: true,
			statusText: 'OK',
			arrayBuffer: async () => audioBuffer.buffer,
		})) as any
	}

	test('OGG voice message is classified as type "audio"', async () => {
		mockFetchWithAudio()
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: { discords: { default: { enabled: true, allowedChannels: [] } } },
		} as any, onMessage)

		const client = createdClients[0]
		const msg = makeVoiceMessage({ contentType: 'audio/ogg', filename: 'voice-message.ogg' })

		await client.emit('messageCreate', msg)

		expect(onMessage).toHaveBeenCalledTimes(1)
		const bridgeMsg = (onMessage.mock.calls[0] as any)[0]
		expect(bridgeMsg.attachments).toHaveLength(1)
		expect(bridgeMsg.attachments[0].type).toBe('audio')
		expect(bridgeMsg.attachments[0].mimeType).toBe('audio/ogg')
		expect(bridgeMsg.attachments[0].buffer).toBeInstanceOf(Buffer)
	})

	test('OGG URL with CDN query string still carries correct mimeType', async () => {
		mockFetchWithAudio()
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: { discords: { default: { enabled: true, allowedChannels: [] } } },
		} as any, onMessage)

		const client = createdClients[0]
		const msg = makeVoiceMessage({ contentType: 'audio/ogg', withQueryString: true })

		await client.emit('messageCreate', msg)

		const bridgeMsg = (onMessage.mock.calls[0] as any)[0]
		expect(bridgeMsg.attachments[0].type).toBe('audio')
		// URL is stored with query string intact (for downstream download if needed)
		expect(bridgeMsg.attachments[0].url).toContain('?ex=')
	})

	test('image attachment is still classified as type "image"', async () => {
		globalThis.fetch = mock(async () => ({
			ok: true,
			statusText: 'OK',
			arrayBuffer: async () => Buffer.from('fake png').buffer,
		})) as any

		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: { discords: { default: { enabled: true, allowedChannels: [] } } },
		} as any, onMessage)

		const client = createdClients[0]
		const imageEntry = {
			id: 'img-1',
			url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
			name: 'photo.png',
			contentType: 'image/png',
			size: 512,
		}
		const msg = {
			...makeMessage({ mentioned: false }),
			attachments: new Map([['img-1', imageEntry]]),
		}

		await client.emit('messageCreate', msg)

		const bridgeMsg = (onMessage.mock.calls[0] as any)[0]
		expect(bridgeMsg.attachments[0].type).toBe('image')
	})

	test('null contentType falls back to "file" type (not "audio")', async () => {
		globalThis.fetch = mock(async () => ({
			ok: true,
			statusText: 'OK',
			arrayBuffer: async () => Buffer.from('binary data').buffer,
		})) as any

		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: { discords: { default: { enabled: true, allowedChannels: [] } } },
		} as any, onMessage)

		const client = createdClients[0]
		const unknownEntry = {
			id: 'unk-1',
			url: 'https://cdn.discordapp.com/attachments/1/2/data.bin',
			name: 'data.bin',
			contentType: null,
			size: 256,
		}
		const msg = {
			...makeMessage({ mentioned: false }),
			attachments: new Map([['unk-1', unknownEntry]]),
		}

		await client.emit('messageCreate', msg)

		const bridgeMsg = (onMessage.mock.calls[0] as any)[0]
		expect(bridgeMsg.attachments[0].type).toBe('file')
		expect(bridgeMsg.attachments[0].mimeType).toBe('application/octet-stream')
	})

	test('application/ogg contentType is classified as "audio"', async () => {
		mockFetchWithAudio()
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: { discords: { default: { enabled: true, allowedChannels: [] } } },
		} as any, onMessage)

		const client = createdClients[0]
		const msg = makeVoiceMessage({ contentType: 'application/ogg', filename: 'audio.ogg' })

		await client.emit('messageCreate', msg)

		const bridgeMsg = (onMessage.mock.calls[0] as any)[0]
		expect(bridgeMsg.attachments[0].type).toBe('audio')
	})

	test('attachment download failure is logged and attachment is skipped', async () => {
		globalThis.fetch = mock(async () => ({
			ok: false,
			statusText: 'Forbidden',
		})) as any

		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')

		await bridge.initialize({
			bridges: { discords: { default: { enabled: true, allowedChannels: [] } } },
		} as any, onMessage)

		const client = createdClients[0]
		const msg = makeVoiceMessage()

		await client.emit('messageCreate', msg)

		// Still dispatches the message but with no attachments
		expect(onMessage).toHaveBeenCalledTimes(1)
		const bridgeMsg = (onMessage.mock.calls[0] as any)[0]
		expect(bridgeMsg.attachments).toHaveLength(0)
	})
})

// ── Thread-per-turn messaging model ──────────────────────────────────────────

function makeThreadableMessage(content = 'have Cody verify git remotes') {
	const threadSend = mock(async (_msg: any) => ({ id: 'tmsg-1' }))
	const thread = {
		id: 'thread-1',
		name: content.slice(0, 100),
		send: threadSend,
	}
	const startThread = mock(async (_opts: any) => thread)
	const reply = mock(async (_msg: any) => ({ id: 'reply-1' }))
	const channelSend = mock(async (_msg: any) => ({ id: 'chan-1' }))
	const sendTyping = mock(() => Promise.resolve())

	const msg: any = {
		id: `m-thread-${Math.random().toString(36).slice(2)}`,
		author: { bot: false, id: 'u-1', username: 'alice' },
		channelId: '22222222222222222',
		content,
		guild: { name: 'Guild' },
		channel: { name: 'general', send: channelSend, sendTyping },
		attachments: new Map(),
		mentions: { users: { has: () => false } },
		react: mock(async () => ({})),
		reactions: { cache: new Map() },
		startThread,
		reply,
		_thread: thread,
		_threadSend: threadSend,
		_reply: reply,
		_channelSend: channelSend,
	}
	return msg
}

describe('DiscordBridge one-thread-per-turn model', () => {
	beforeEach(() => {
		createdClients.length = 0
		mockGetBotTokenForInstance.mockClear()
		mockGetBotTokenForInstance.mockImplementation(() => 'fake-discord-token')
	})

	async function initBridge() {
		const onMessage = mock(async () => true)
		const bridge = new DiscordBridge('default')
		await bridge.initialize({
			bridges: { discords: { default: { enabled: true, allowedChannels: [] } } },
		} as any, onMessage)
		const client = createdClients[0]
		return { bridge, client, onMessage }
	}

	test('thread is created on user message when first sub-agent starts', async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage()

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({
			type: 'subagent-status',
			status: 'started',
			subagentId: 'sub-1',
			task: 'Verify git remotes',
			message: 'Verify git remotes',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// startThread was called on the user's own message
		expect(msg.startThread).toHaveBeenCalledTimes(1)
		// thread name = user message content
		expect(msg.startThread.mock.calls[0][0].name).toBe('have Cody verify git remotes')
		// sub-agent started message posted to thread
		expect(msg._threadSend).toHaveBeenCalledTimes(1)
		const threadMsg = (msg._threadSend.mock.calls[0] as any)[0] as string
		expect(threadMsg).toContain('Sub-agent started')
		expect(threadMsg).toContain('sub-1')
	})

	test("Chip's intermediate done goes to thread, not main channel", async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage()

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		// Sub-agent starts → pendingSubagents becomes 1, thread is created
		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'started',
			subagentId: 'sub-1', task: 'Verify git remotes', message: 'Verify git remotes',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// Chip's LLM response fires done while pendingSubagents is still 1
		await bridge.handleDaemonEvent({
			type: 'chunk', text: "I'm delegating to Cody...",
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({ type: 'done', sessionId: 'sess-1' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// Main channel NOT called for Chip's intermediate prose
		expect(msg._channelSend).not.toHaveBeenCalled()
		expect(msg._reply).not.toHaveBeenCalled()
		// Thread received Chip's text
		const allThreadCalls = msg._threadSend.mock.calls.map((c: any) => c[0])
		const hasChipText = allThreadCalls.some((m: string) => m?.includes("I'm delegating to Cody"))
		expect(hasChipText).toBe(true)
	})

	test('final done sends to thread AND replies to user message in main channel', async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage()

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'started',
			subagentId: 'sub-1', task: 'Verify git remotes', message: 'Verify git remotes',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		// Sub-agent completes → pendingSubagents back to 0
		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'completed',
			subagentId: 'sub-1', task: 'Verify git remotes', message: 'done',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// Second start for parent's continuation turn (currentMessage already set — no queue pop)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({ type: 'chunk', text: 'Remotes verified. All good.' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({ type: 'done', sessionId: 'sess-1' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// Thread receives final answer
		const allThreadCalls = msg._threadSend.mock.calls.map((c: any) => c[0])
		const finalInThread = allThreadCalls.some((m: string) => m?.includes('Remotes verified'))
		expect(finalInThread).toBe(true)

		// Main channel gets a reply (not a send)
		expect(msg._reply).toHaveBeenCalledTimes(1)
		const replyText = (msg._reply.mock.calls[0] as any)[0] as string
		expect(replyText).toContain('Remotes verified')
		expect(replyText).toContain('thread ↑')

		// Plain channel.send NOT called for the final answer
		expect(msg._channelSend).not.toHaveBeenCalled()
	})

	test('second start does not pop from queue when currentMessage is still set', async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage()

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		// Trigger a sub-agent so currentMessage stays alive after first done
		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'started',
			subagentId: 'sub-1', task: 'task', message: 'task',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'completed',
			subagentId: 'sub-1', task: 'task', message: 'done',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// Second start should NOT try to pop from queue (queue is empty now)
		// It should succeed without error because it reuses the existing currentMessage
		await expect(
			bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		).resolves.toBeUndefined()
	})

	test('progress-update routes to thread when available', async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage()

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		// Create thread via sub-agent
		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'started',
			subagentId: 'sub-1', task: 'task', message: 'task',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		const callsBeforeProgress = msg._threadSend.mock.calls.length

		await bridge.handleDaemonEvent({
			type: 'progress-update',
			message: 'Step 1 done',
			step: 1,
			totalSteps: 3,
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// New message in thread
		expect(msg._threadSend.mock.calls.length).toBe(callsBeforeProgress + 1)
		const progressMsg = (msg._threadSend.mock.calls[callsBeforeProgress] as any)[0] as string
		expect(progressMsg).toContain('Step 1 done')
		// Main channel untouched
		expect(msg._channelSend).not.toHaveBeenCalled()
	})

	test('agent-handoff routes to thread when available', async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage()

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'started',
			subagentId: 'sub-1', task: 'task', message: 'task',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		const callsBefore = msg._threadSend.mock.calls.length

		await bridge.handleDaemonEvent({
			type: 'agent-handoff',
			fromAgent: 'chip',
			toAgent: 'cody',
			reason: 'coding task',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		expect(msg._threadSend.mock.calls.length).toBe(callsBefore + 1)
		const handoffMsg = (msg._threadSend.mock.calls[callsBefore] as any)[0] as string
		expect(handoffMsg).toContain('Agent Handoff')
		expect(handoffMsg).toContain('chip')
		expect(msg._channelSend).not.toHaveBeenCalled()
	})

	test('simple conversation with no sub-agents sends to main channel unchanged', async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage('just a simple question')

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({ type: 'chunk', text: 'Simple answer.' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })
		await bridge.handleDaemonEvent({ type: 'done', sessionId: 'sess-1' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// No thread created (no sub-agents)
		expect(msg.startThread).not.toHaveBeenCalled()
		// Response goes to main channel via send, not reply
		expect(msg._channelSend).toHaveBeenCalledTimes(1)
		expect((msg._channelSend.mock.calls[0] as any)[0]).toBe('Simple answer.')
		expect(msg._reply).not.toHaveBeenCalled()
	})

	test('thread creation failure falls back to main channel for subagent-status', async () => {
		const { bridge, client } = await initBridge()
		const msg = makeThreadableMessage()
		// Make startThread throw
		msg.startThread.mockImplementation(async () => { throw new Error('no thread perms') })

		await client.emit('messageCreate', msg)
		await bridge.handleDaemonEvent({ type: 'start' } as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// Point channels.fetch at the channel so fallback works
		const fakeClient = createdClients[0] as any
		fakeClient.channels.fetch = mock(async () => msg.channel)

		await bridge.handleDaemonEvent({
			type: 'subagent-status', status: 'started',
			subagentId: 'sub-1', task: 'task', message: 'task',
		} as any, { channelUserId: '22222222222222222', sessionId: 'sess-1' })

		// Falls back to main channel
		expect(msg._channelSend).toHaveBeenCalledTimes(1)
	})
})
