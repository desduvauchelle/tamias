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
