import { expect, test, describe, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import * as daemonUtils from '../utils/daemon.ts'

// ── Helpers ──────────────────────────────────────────────────────────
let fetchSpy: ReturnType<typeof spyOn>
let isDaemonRunningSpy: ReturnType<typeof spyOn>
let getDaemonUrlSpy: ReturnType<typeof spyOn>
let readDaemonInfoSpy: ReturnType<typeof spyOn>

function mockDaemonRunning(running = true) {
	isDaemonRunningSpy = spyOn(daemonUtils, 'isDaemonRunning').mockResolvedValue(running)
	getDaemonUrlSpy = spyOn(daemonUtils, 'getDaemonUrl').mockReturnValue('http://127.0.0.1:9001')
	readDaemonInfoSpy = spyOn(daemonUtils, 'readDaemonInfo').mockReturnValue({
		pid: 1234,
		port: 9001,
		startedAt: new Date().toISOString(),
		token: 'test-token-abc',
	})
}

function mockFetchJson(data: unknown, ok = true) {
	fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify(data), {
			status: ok ? 200 : 500,
			headers: { 'Content-Type': 'application/json' },
		})
	)
}

afterEach(() => {
	mock.restore()
})

// ── Import the functions we're testing ────────────────────────────────
// We import the command module to access the subcommands. Since Commander
// actions are closures calling fetch → daemon, we test via the actual
// subcommand invocation using program.parseAsync.
import { browserCommand } from '../commands/browser.ts'

// Helper to run a subcommand silently (suppress clack output)
async function runSubcommand(args: string[]) {
	// Suppress console output from @clack/prompts
	const origLog = console.log
	const origWarn = console.warn
	const origError = console.error
	console.log = () => { }
	console.warn = () => { }
	console.error = () => { }
	try {
		await browserCommand.parseAsync(args, { from: 'user' })
	} finally {
		console.log = origLog
		console.warn = origWarn
		console.error = origError
	}
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('tamias browser status', () => {
	test('calls GET /browser/status with token', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ installed: true, headedOpen: false })

		await runSubcommand(['status'])

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const calledUrl = fetchSpy!.mock.calls[0][0] as string
		expect(calledUrl).toContain('/browser/status')
		expect(calledUrl).toContain('token=test-token-abc')
	})

	test('reports installed and closed state', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ installed: true, headedOpen: false })

		// Should not throw
		await runSubcommand(['status'])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})

	test('reports not installed state', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ installed: false, headedOpen: false })

		await runSubcommand(['status'])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})

	test('handles daemon not running', async () => {
		mockDaemonRunning(false)
		mockFetchJson({}) // setup spy so we can verify it was NOT called

		await runSubcommand(['status'])
		expect(fetchSpy!.mock.calls.length).toBe(0)
	})
})

describe('tamias browser open', () => {
	test('calls POST /browser/launch without url', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ ok: true, message: 'Browser launched.' })

		await runSubcommand(['open'])

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const calledUrl = fetchSpy!.mock.calls[0][0] as string
		expect(calledUrl).toContain('/browser/launch')
		expect(calledUrl).toContain('token=test-token-abc')

		const calledOpts = fetchSpy!.mock.calls[0][1] as RequestInit
		expect(calledOpts.method).toBe('POST')
		const body = JSON.parse(calledOpts.body as string)
		expect(body).toEqual({})
	})

	test('passes url in body when provided', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ ok: true, message: 'Browser launched.' })

		await runSubcommand(['open', 'https://example.com'])

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const calledOpts = fetchSpy!.mock.calls[0][1] as RequestInit
		const body = JSON.parse(calledOpts.body as string)
		expect(body).toEqual({ url: 'https://example.com' })
	})

	test('handles daemon not running', async () => {
		mockDaemonRunning(false)
		mockFetchJson({})

		await runSubcommand(['open'])
		expect(fetchSpy!.mock.calls.length).toBe(0)
	})

	test('handles launch failure response', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ ok: false, message: 'Playwright not installed' })

		await runSubcommand(['open'])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})

	test('handles network error', async () => {
		mockDaemonRunning(true)
		fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

		await runSubcommand(['open'])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})
})

describe('tamias browser close', () => {
	test('calls POST /browser/close with token', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ ok: true })

		await runSubcommand(['close'])

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const calledUrl = fetchSpy!.mock.calls[0][0] as string
		expect(calledUrl).toContain('/browser/close')
		expect(calledUrl).toContain('token=test-token-abc')

		const calledOpts = fetchSpy!.mock.calls[0][1] as RequestInit
		expect(calledOpts.method).toBe('POST')
	})

	test('handles daemon not running', async () => {
		mockDaemonRunning(false)
		mockFetchJson({})

		await runSubcommand(['close'])
		expect(fetchSpy!.mock.calls.length).toBe(0)
	})

	test('handles close failure response', async () => {
		mockDaemonRunning(true)
		mockFetchJson({ ok: false })

		await runSubcommand(['close'])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})

	test('handles network error', async () => {
		mockDaemonRunning(true)
		fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

		await runSubcommand(['close'])
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})
})
