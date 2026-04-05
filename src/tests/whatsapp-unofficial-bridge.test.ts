import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

class FakeEventBus {
	private handlers = new Map<string, Array<(payload: unknown) => void | Promise<void>>>()

	on(event: string, handler: (payload: unknown) => void | Promise<void>) {
		const list = this.handlers.get(event) ?? []
		list.push(handler)
		this.handlers.set(event, list)
	}

	async emit(event: string, payload: unknown): Promise<void> {
		const list = this.handlers.get(event) ?? []
		for (const handler of list) {
			await handler(payload)
		}
	}
}

interface FakeSocket {
	ev: FakeEventBus
	end: () => void
	logout: () => Promise<void>
	groupFetchAllParticipating: () => Promise<Record<string, unknown>>
	sendMessage: () => Promise<void>
}

const createdSockets: FakeSocket[] = []

mock.module('@whiskeysockets/baileys', () => ({
	makeWASocket: () => {
		const sock: FakeSocket = {
			ev: new FakeEventBus(),
			end: () => { },
			logout: async () => { },
			groupFetchAllParticipating: async () => ({}),
			sendMessage: async () => { },
		}
		createdSockets.push(sock)
		return sock
	},
	useMultiFileAuthState: async () => ({
		state: { creds: {}, keys: {} },
		saveCreds: async () => { },
	}),
	fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 102099] }),
	DisconnectReason: { loggedOut: 401 },
	makeCacheableSignalKeyStore: (keys: unknown) => keys,
	Browsers: { appropriate: () => ['Tamias', 'Chrome', '1.0'] },
}))

mock.module('pino', () => ({ default: () => ({}) }))

import { WhatsAppUnofficialBridge } from '../bridge/channels/whatsapp-unofficial.ts'

describe('WhatsAppUnofficialBridge reconnect logging', () => {
	let authDir = ''
	let logSpy: ReturnType<typeof spyOn>
	let warnSpy: ReturnType<typeof spyOn>
	let errorSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		createdSockets.length = 0
		authDir = join(tmpdir(), `tamias-wa-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
		writeFileSync(join(authDir, 'creds.json'), JSON.stringify({ me: 'ok' }))
		logSpy = spyOn(console, 'log').mockImplementation(() => { })
		warnSpy = spyOn(console, 'warn').mockImplementation(() => { })
		errorSpy = spyOn(console, 'error').mockImplementation(() => { })
	})

	afterEach(() => {
		logSpy.mockRestore()
		warnSpy.mockRestore()
		errorSpy.mockRestore()
		rmSync(authDir, { recursive: true, force: true })
	})

	test('logs reconnect-disabled as info (not error) when reconnect is off', async () => {
		const bridge = new WhatsAppUnofficialBridge('default')
		await bridge.initialize({
			version: '1.0',
			connections: {},
			debug: false,
			ngrok: { enabled: false },
			bridges: {
				terminal: { enabled: true },
				whatsappUnofficials: {
					default: { enabled: true, authDir },
				},
			},
		}, async () => true)

		expect(createdSockets.length).toBe(1)
		await bridge.destroy()
		await createdSockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } })

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Connection closed — reconnect disabled'))
		expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Max reconnect attempts reached'))
		expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Max reconnect attempts reached'))
	})

	test('logs max attempts as warning (not error)', async () => {
		const bridge = new WhatsAppUnofficialBridge('default')
		await bridge.initialize({
			version: '1.0',
			connections: {},
			debug: false,
			ngrok: { enabled: false },
			bridges: {
				terminal: { enabled: true },
				whatsappUnofficials: {
					default: { enabled: true, authDir },
				},
			},
		}, async () => true)

		expect(createdSockets.length).toBe(1)
		for (let i = 0; i < 13; i++) {
			await createdSockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } })
		}
		await createdSockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } })

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Max reconnect attempts reached (12)'))
		expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Max reconnect attempts reached'))
	})
})

describe('WhatsAppUnofficialBridge mention-only filtering', () => {
	let authDir = ''

	beforeEach(() => {
		createdSockets.length = 0
		authDir = join(tmpdir(), `tamias-wa-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
		writeFileSync(join(authDir, 'creds.json'), JSON.stringify({ me: 'ok' }))
	})

	afterEach(() => {
		rmSync(authDir, { recursive: true, force: true })
	})

	test('does not call onMessage when content does not match mention regex', async () => {
		const onMessage = mock(async () => true)
		const bridge = new WhatsAppUnofficialBridge('default')
		await bridge.initialize({
			version: '1.0',
			connections: {},
			debug: false,
			ngrok: { enabled: false },
			bridges: {
				terminal: { enabled: true },
				whatsappUnofficials: {
					default: {
						enabled: true,
						authDir,
						mode: 'mention-only',
						allowedGroups: ['*'],
						mentionPattern: '\\btamias\\b',
					},
				},
			},
		}, onMessage)

		const upsert = {
			type: 'notify',
			messages: [{
				key: { fromMe: false, remoteJid: '120363022222222222@g.us', participant: '1234567890@s.whatsapp.net' },
				pushName: 'Alice',
				message: { conversation: 'hello everyone' },
			}],
		}
		await createdSockets[0].ev.emit('messages.upsert', upsert)
		expect(onMessage).not.toHaveBeenCalled()
	})

	test('calls onMessage when content matches mention regex', async () => {
		const onMessage = mock(async () => true)
		const bridge = new WhatsAppUnofficialBridge('default')
		await bridge.initialize({
			version: '1.0',
			connections: {},
			debug: false,
			ngrok: { enabled: false },
			bridges: {
				terminal: { enabled: true },
				whatsappUnofficials: {
					default: {
						enabled: true,
						authDir,
						mode: 'mention-only',
						allowedGroups: ['*'],
						mentionPattern: '^tamias[:,\\s]',
					},
				},
			},
		}, onMessage)

		const upsert = {
			type: 'notify',
			messages: [{
				key: { fromMe: false, remoteJid: '120363022222222222@g.us', participant: '1234567890@s.whatsapp.net' },
				pushName: 'Alice',
				message: { conversation: 'Tamias: summarize this thread' },
			}],
		}
		await createdSockets[0].ev.emit('messages.upsert', upsert)
		expect(onMessage).toHaveBeenCalledTimes(1)
	})
})

describe('WhatsAppUnofficialBridge group discovery rate-limit handling', () => {
	let authDir = ''
	let logSpy: ReturnType<typeof spyOn>
	let warnSpy: ReturnType<typeof spyOn>
	let errorSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		createdSockets.length = 0
		authDir = join(tmpdir(), `tamias-wa-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
		writeFileSync(join(authDir, 'creds.json'), JSON.stringify({ me: 'ok' }))
		logSpy = spyOn(console, 'log').mockImplementation(() => { })
		warnSpy = spyOn(console, 'warn').mockImplementation(() => { })
		errorSpy = spyOn(console, 'error').mockImplementation(() => { })
	})

	afterEach(() => {
		logSpy.mockRestore()
		warnSpy.mockRestore()
		errorSpy.mockRestore()
		rmSync(authDir, { recursive: true, force: true })
	})

	function makeBridge() {
		return new WhatsAppUnofficialBridge('default')
	}

	function resetThrottle(bridge: WhatsAppUnofficialBridge) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const b = bridge as any
		b.lastGroupDiscoveryAt = 0
	}

	function setConnected(bridge: WhatsAppUnofficialBridge) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const b = bridge as any
		b.connectionStatus = 'connected'
	}

	async function initBridge(bridge: WhatsAppUnofficialBridge) {
		await bridge.initialize({
			version: '1.0',
			connections: {},
			debug: false,
			ngrok: { enabled: false },
			bridges: {
				terminal: { enabled: true },
				whatsappUnofficials: {
					default: { enabled: true, authDir },
				},
			},
		}, async () => true)
	}

	test('throttles group discovery within minInterval', async () => {
		const bridge = makeBridge()
		await initBridge(bridge)
		expect(createdSockets.length).toBe(1)

		let fetchCount = 0
		createdSockets[0].groupFetchAllParticipating = async () => {
			fetchCount++
			return { 'group1@g.us': { subject: 'Test', participants: [] } }
		}

		// Simulate connection open to trigger first discovery
		await createdSockets[0].ev.emit('connection.update', { connection: 'open' })
		expect(fetchCount).toBe(1)

		// Second call immediately — should be throttled
		const groups = await bridge.discoverGroups()
		expect(fetchCount).toBe(1) // Not incremented
		expect(groups.length).toBe(1) // Returns cached data
	})

	test('detects 429 rate-limit errors and logs warning instead of error', async () => {
		const bridge = makeBridge()
		await initBridge(bridge)

		createdSockets[0].groupFetchAllParticipating = async () => {
			throw new Error('rate-overlimit')
		}

		// Simulate connection open — triggers discoverGroups which hits 429
		await createdSockets[0].ev.emit('connection.update', { connection: 'open' })

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rate-limited (429)'))
		// Should NOT log via console.error for 429
		const errorCalls = errorSpy.mock.calls.filter(
			(args: unknown[]) => typeof args[0] === 'string' && args[0].includes('Group discovery failed')
		)
		expect(errorCalls.length).toBe(0)
	})

	test('activates circuit breaker after consecutive 429 failures', async () => {
		const bridge = makeBridge()
		await initBridge(bridge)

		let fetchCount = 0
		createdSockets[0].groupFetchAllParticipating = async () => {
			fetchCount++
			throw new Error('rate-overlimit')
		}

		// First call — triggers on connection open
		await createdSockets[0].ev.emit('connection.update', { connection: 'open' })
		expect(fetchCount).toBe(1) // 1st 429

		// Manually call discoverGroups to simulate further 429s
		// After 429 failure, connectionStatus may revert and throttle blocks,
		// so we use helpers to reset state for testing the circuit breaker logic.
		resetThrottle(bridge)
		setConnected(bridge)
		await bridge.discoverGroups() // 2nd 429
		expect(fetchCount).toBe(2)

		resetThrottle(bridge)
		setConnected(bridge)
		await bridge.discoverGroups() // 3rd 429 — should trigger circuit breaker
		expect(fetchCount).toBe(3)

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Group discovery paused'))

		// 4th attempt should be blocked by circuit breaker (cooldownUntil is in the future)
		resetThrottle(bridge)
		setConnected(bridge)
		await bridge.discoverGroups()
		expect(fetchCount).toBe(3) // Still 3, not called again
	})

	test('resets circuit breaker state on successful discovery', async () => {
		const bridge = makeBridge()
		await initBridge(bridge)

		// Simulate 2 consecutive 429 failures
		let shouldFail = true
		createdSockets[0].groupFetchAllParticipating = async () => {
			if (shouldFail) throw new Error('rate-overlimit')
			return { 'g1@g.us': { subject: 'GroupA', participants: [] } }
		}

		await createdSockets[0].ev.emit('connection.update', { connection: 'open' })
		expect((bridge as any).consecutive429s).toBe(1)

		// Now succeed
		shouldFail = false
		resetThrottle(bridge)
		setConnected(bridge)
		const groups = await bridge.discoverGroups()

		expect((bridge as any).consecutive429s).toBe(0)
		expect(groups.length).toBe(1)
		expect(groups[0].name).toBe('GroupA')
	})

	test('skips discovery silently on reconnect when recently discovered', async () => {
		const bridge = makeBridge()
		await initBridge(bridge)

		let fetchCount = 0
		createdSockets[0].groupFetchAllParticipating = async () => {
			fetchCount++
			return { 'g1@g.us': { subject: 'Test', participants: [] } }
		}

		// First connection open — discovery happens
		await createdSockets[0].ev.emit('connection.update', { connection: 'open' })
		expect(fetchCount).toBe(1)

		// Simulate reconnect (close + open) — discovery should be throttled
		await createdSockets[0].ev.emit('connection.update', { connection: 'open' })
		expect(fetchCount).toBe(1) // Throttled — not called again
	})
})
