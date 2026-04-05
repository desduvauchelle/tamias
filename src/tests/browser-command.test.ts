import { expect, test, describe } from 'bun:test'
import { createBrowserCommand, type BrowserCommandDeps } from '../commands/browser.ts'

interface PromptLogStore {
	error: string[]
	success: string[]
	info: string[]
	warn: string[]
}

function createPromptMocks() {
	const logs: PromptLogStore = {
		error: [],
		success: [],
		info: [],
		warn: [],
	}

	let spinnerState: { started: string[]; stopped: string[] } = { started: [], stopped: [] }

	const prompts: BrowserCommandDeps['prompts'] = {
		intro: () => { },
		outro: () => { },
		log: {
			error: (msg: string) => logs.error.push(msg),
			success: (msg: string) => logs.success.push(msg),
			info: (msg: string) => logs.info.push(msg),
			warn: (msg: string) => logs.warn.push(msg),
			step: () => { },
			message: () => { },
		},
		spinner: () => {
			const state = { started: [] as string[], stopped: [] as string[] }
			spinnerState = state
			return {
				start: (msg: string) => state.started.push(msg),
				stop: (msg: string) => state.stopped.push(msg),
				message: () => { },
			}
		},
	} as BrowserCommandDeps['prompts']

	return { prompts, logs, getSpinnerState: () => spinnerState }
}

function createDeps(overrides: Partial<BrowserCommandDeps> = {}) {
	const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
	const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
		fetchCalls.push({ url: String(input), init })
		return new Response('{}', { status: 200 })
	}
	const promptMocks = createPromptMocks()

	const deps: BrowserCommandDeps = {
		getDaemonUrl: () => 'http://127.0.0.1:9001',
		isDaemonRunning: async () => true,
		readDaemonInfo: () => ({ token: 'test-token-abc' }),
		fetch: fetchMock,
		prompts: promptMocks.prompts,
		...overrides,
	}

	return {
		deps,
		fetchCalls,
		logs: promptMocks.logs,
		getSpinnerState: promptMocks.getSpinnerState,
	}
}

async function runSubcommand(deps: BrowserCommandDeps, args: string[]) {
	const command = createBrowserCommand(deps)
	await command.parseAsync(args, { from: 'user' })
}

describe('tamias browser status', () => {
	test('calls GET /browser/status with token', async () => {
		const { deps, fetchCalls } = createDeps({
			fetch: async (input) => {
				fetchCalls.push({ url: String(input) })
				return new Response(JSON.stringify({ installed: true, headedOpen: false }))
			},
		})

		await runSubcommand(deps, ['status'])

		expect(fetchCalls.length).toBe(1)
		const calledUrl = fetchCalls[0]?.url
		expect(calledUrl).toBe('http://127.0.0.1:9001/browser/status?token=test-token-abc')
	})

	test('reports installed and closed state', async () => {
		const { deps, logs } = createDeps({
			fetch: async () => new Response(JSON.stringify({ installed: true, headedOpen: false })),
		})

		await runSubcommand(deps, ['status'])
		expect(logs.info.some((m) => m.includes('installed'))).toBe(true)
		expect(logs.info.some((m) => m.includes('closed'))).toBe(true)
	})

	test('reports not installed state', async () => {
		const { deps, logs } = createDeps({
			fetch: async () => new Response(JSON.stringify({ installed: false, headedOpen: false })),
		})

		await runSubcommand(deps, ['status'])
		expect(logs.warn.some((m) => m.includes('Install Playwright'))).toBe(true)
	})

	test('handles daemon not running', async () => {
		const { deps, logs, fetchCalls } = createDeps({
			isDaemonRunning: async () => false,
		})

		await runSubcommand(deps, ['status'])
		expect(fetchCalls.length).toBe(0)
		expect(logs.error.some((m) => m.includes('Daemon is not running'))).toBe(true)
	})
})

describe('tamias browser open', () => {
	test('calls POST /browser/launch without url', async () => {
		const { deps, fetchCalls } = createDeps({
			fetch: async (input, init) => {
				fetchCalls.push({ url: String(input), init })
				return new Response(JSON.stringify({ ok: true, message: 'Browser launched.' }))
			},
		})

		await runSubcommand(deps, ['open'])

		expect(fetchCalls.length).toBe(1)
		const calledUrl = fetchCalls[0]?.url
		expect(calledUrl).toBe('http://127.0.0.1:9001/browser/launch?token=test-token-abc')

		const calledOpts = fetchCalls[0]?.init
		expect(calledOpts).toBeDefined()
		const requestInit = calledOpts!
		expect(requestInit.method).toBe('POST')
		const body = JSON.parse(String(requestInit.body))
		expect(body).toEqual({})
	})

	test('passes url in body when provided', async () => {
		const { deps, fetchCalls } = createDeps({
			fetch: async (input, init) => {
				fetchCalls.push({ url: String(input), init })
				return new Response(JSON.stringify({ ok: true, message: 'Browser launched.' }))
			},
		})

		await runSubcommand(deps, ['open', 'https://example.com'])

		expect(fetchCalls.length).toBe(1)
		const calledOpts = fetchCalls[0]?.init
		expect(calledOpts).toBeDefined()
		const body = JSON.parse(String(calledOpts!.body))
		expect(body).toEqual({ url: 'https://example.com' })
	})

	test('handles daemon not running', async () => {
		const { deps, logs, fetchCalls } = createDeps({
			isDaemonRunning: async () => false,
		})

		await runSubcommand(deps, ['open'])
		expect(fetchCalls.length).toBe(0)
		expect(logs.error.some((m) => m.includes('Daemon is not running'))).toBe(true)
	})

	test('handles launch failure response', async () => {
		const { deps, logs, getSpinnerState } = createDeps({
			fetch: async () => new Response(JSON.stringify({ ok: false, message: 'Playwright not installed' })),
		})

		await runSubcommand(deps, ['open'])
		expect(getSpinnerState().stopped).toContain('Failed')
		expect(logs.error.some((m) => m.includes('Playwright not installed'))).toBe(true)
	})

	test('handles network error', async () => {
		const { deps, logs, getSpinnerState } = createDeps({
			fetch: async () => {
				throw new Error('Connection refused')
			},
		})

		await runSubcommand(deps, ['open'])
		expect(getSpinnerState().stopped).toContain('Failed')
		expect(logs.error.some((m) => m.includes('Could not reach the daemon'))).toBe(true)
	})
})

describe('tamias browser close', () => {
	test('calls POST /browser/close with token', async () => {
		const { deps, fetchCalls } = createDeps({
			fetch: async (input, init) => {
				fetchCalls.push({ url: String(input), init })
				return new Response(JSON.stringify({ ok: true }))
			},
		})

		await runSubcommand(deps, ['close'])

		expect(fetchCalls.length).toBe(1)
		const calledUrl = fetchCalls[0]?.url
		expect(calledUrl).toBe('http://127.0.0.1:9001/browser/close?token=test-token-abc')

		const calledOpts = fetchCalls[0]?.init
		expect(calledOpts).toBeDefined()
		expect(calledOpts!.method).toBe('POST')
	})

	test('handles daemon not running', async () => {
		const { deps, logs, fetchCalls } = createDeps({
			isDaemonRunning: async () => false,
		})

		await runSubcommand(deps, ['close'])
		expect(fetchCalls.length).toBe(0)
		expect(logs.error.some((m) => m.includes('Daemon is not running'))).toBe(true)
	})

	test('handles close failure response', async () => {
		const { deps, logs, getSpinnerState } = createDeps({
			fetch: async () => new Response(JSON.stringify({ ok: false })),
		})

		await runSubcommand(deps, ['close'])
		expect(getSpinnerState().stopped).toContain('Failed')
		expect(logs.error.some((m) => m.includes('Failed to close browser'))).toBe(true)
	})

	test('handles network error', async () => {
		const { deps, logs, getSpinnerState } = createDeps({
			fetch: async () => {
				throw new Error('Connection refused')
			},
		})

		await runSubcommand(deps, ['close'])
		expect(getSpinnerState().stopped).toContain('Failed')
		expect(logs.error.some((m) => m.includes('Could not reach the daemon'))).toBe(true)
	})
})
