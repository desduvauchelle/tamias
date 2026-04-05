import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { loadConfig, saveConfig, invalidateConfigCache, getFirecrawlConfig } from '../utils/config.ts'
import { createFirecrawlTools, FIRECRAWL_TOOL_NAME } from '../tools/firecrawl.ts'
import { INTERNAL_TOOL_NAMES } from '../tools/internalToolNames.ts'

type FirecrawlScrapeResult = {
	success: boolean
	error?: string
	status?: number
	markdown?: string
}

async function resolveToolResult<T>(value: T | AsyncIterable<T>): Promise<T> {
	if (value && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function') {
		for await (const chunk of value as AsyncIterable<T>) return chunk
		throw new Error('Tool returned an empty async iterable result')
	}
	return value as T
}

describe('firecrawl config + tool', () => {
	const originalFetch = globalThis.fetch

	beforeEach(() => {
		invalidateConfigCache()
		const config = loadConfig()
		config.firecrawl = {
			enabled: false,
			baseUrl: 'http://localhost:3002',
			timeoutMs: 30000,
		}
		saveConfig(config)
		invalidateConfigCache()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('getFirecrawlConfig returns defaults when firecrawl is missing', () => {
		const config = loadConfig()
		delete config.firecrawl
		saveConfig(config)
		invalidateConfigCache()

		const firecrawl = getFirecrawlConfig()
		expect(firecrawl.enabled).toBe(false)
		expect(firecrawl.baseUrl).toBe('http://localhost:3002')
		expect(firecrawl.timeoutMs).toBe(30000)
	})

	test('FIRECRAWL_TOOL_NAME is firecrawl and web namespace is registered', () => {
		expect(FIRECRAWL_TOOL_NAME).toBe('firecrawl')
		// firecrawl is now merged into the 'web' namespace
		expect(INTERNAL_TOOL_NAMES).toContain('web')
	})

	test('scrape returns disabled error when firecrawl config is off', async () => {
		const tools = createFirecrawlTools({} as never, 'test-session')
		const execute = tools.scrape.execute
		expect(execute).toBeDefined()
		if (!execute) throw new Error('Missing scrape tool execute function')
		const result = await resolveToolResult<FirecrawlScrapeResult>(
			await execute({ url: 'https://example.com' }, { toolCallId: 'test', messages: [] }),
		)
		expect(result.success).toBe(false)
		expect(result.error).toContain('disabled')
	})

	test('scrape posts to local endpoint and returns markdown on success', async () => {
		const config = loadConfig()
		config.firecrawl = {
			enabled: true,
			baseUrl: 'http://localhost:3002',
			timeoutMs: 30000,
		}
		saveConfig(config)
		invalidateConfigCache()

		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async (input: string | URL | Request, init?: RequestInit) => {
			expect(String(input)).toBe('http://localhost:3002/v1/scrape')
			expect(init?.method).toBe('POST')
			expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
			expect(init?.body).toBe(JSON.stringify({ url: 'https://example.com' }))

			return {
				ok: true,
				status: 200,
				text: async () => JSON.stringify({
					success: true,
					data: { markdown: '# Example\n\nHello world' },
				}),
			} as Response
		}),
		})

		const tools = createFirecrawlTools({} as never, 'test-session')
		const execute = tools.scrape.execute
		expect(execute).toBeDefined()
		if (!execute) throw new Error('Missing scrape tool execute function')
		const result = await resolveToolResult<FirecrawlScrapeResult>(
			await execute({ url: 'https://example.com' }, { toolCallId: 'test', messages: [] }),
		)
		expect(result.success).toBe(true)
		expect(result.markdown).toContain('# Example')
	})

	test('scrape returns HTTP error details when endpoint fails', async () => {
		const config = loadConfig()
		config.firecrawl = {
			enabled: true,
			baseUrl: 'http://localhost:3002',
			timeoutMs: 30000,
		}
		saveConfig(config)
		invalidateConfigCache()

		Object.defineProperty(globalThis, 'fetch', {
			writable: true,
			value: mock(async () => ({
				ok: false,
				status: 500,
				text: async () => JSON.stringify({ error: 'boom' }),
			} as Response)),
		})

		const tools = createFirecrawlTools({} as never, 'test-session')
		const execute = tools.scrape.execute
		expect(execute).toBeDefined()
		if (!execute) throw new Error('Missing scrape tool execute function')
		const result = await resolveToolResult<FirecrawlScrapeResult>(
			await execute({ url: 'https://example.com' }, { toolCallId: 'test', messages: [] }),
		)
		expect(result.success).toBe(false)
		expect(result.status).toBe(500)
		expect(result.error).toContain('HTTP 500')
	})
})
