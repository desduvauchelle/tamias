import { describe, expect, test, beforeEach, mock } from 'bun:test'
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
