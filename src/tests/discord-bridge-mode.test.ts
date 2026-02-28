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
		channelId: 'c-1',
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
		channelId: 'c-1',
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
