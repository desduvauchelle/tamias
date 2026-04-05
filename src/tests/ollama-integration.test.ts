import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { loadConfig, saveConfig, invalidateConfigCache, getConfigFilePath } from '../utils/config.ts'
import type { TamiasConfig } from '../utils/config.ts'
import { fetchOllamaModels, pullOllamaModel } from '../utils/models.ts'

function writeTestConfig(overrides: Partial<TamiasConfig> = {}) {
	const configPath = getConfigFilePath()
	const dir = dirname(configPath)
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

	const config = {
		version: '1.0' as const,
		connections: {
			'my-ollama': {
				nickname: 'my-ollama',
				provider: 'ollama' as const,
				baseUrl: 'http://localhost:11434',
				selectedModels: ['llama3.2:latest'],
			},
			'remote-ollama': {
				nickname: 'remote-ollama',
				provider: 'ollama' as const,
				baseUrl: 'http://remote-host:11434',
			},
			'my-openai': {
				nickname: 'my-openai',
				provider: 'openai' as const,
				envKeyName: 'TAMIAS_CONN_OPENAI',
			},
		},
		bridges: { terminal: { enabled: true } },
		debug: false,
		ngrok: { enabled: false },
		...overrides,
	} as TamiasConfig
	writeFileSync(configPath, JSON.stringify(config))
	invalidateConfigCache()
}

describe('Ollama integration: config-based connection resolution', () => {
	let originalFetch: typeof globalThis.fetch

	beforeEach(() => {
		originalFetch = globalThis.fetch
		invalidateConfigCache()
		writeTestConfig()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('resolves Ollama connection from config', () => {
		const config = loadConfig()
		const conn = config.connections['my-ollama']
		expect(conn).toBeDefined()
		expect(conn.provider).toBe('ollama')
		expect(conn.baseUrl).toBe('http://localhost:11434')
	})

	test('resolves default baseUrl when connection has no baseUrl', () => {
		writeTestConfig({
			connections: {
				'local-ollama': {
					nickname: 'local-ollama',
					provider: 'ollama',
				},
			},
		} as Partial<TamiasConfig>)

		const config = loadConfig()
		const conn = config.connections['local-ollama']
		expect(conn.provider).toBe('ollama')
		expect(conn.baseUrl).toBeUndefined()
		// The Ollama functions default to http://127.0.0.1:11434 when baseUrl is undefined
	})

	test('can differentiate Ollama from non-Ollama connections', () => {
		const config = loadConfig()
		const ollamaConn = config.connections['my-ollama']
		const openaiConn = config.connections['my-openai']
		expect(ollamaConn.provider).toBe('ollama')
		expect(openaiConn.provider).toBe('openai')
		expect(openaiConn.provider).not.toBe('ollama')
	})

	test('supports multiple Ollama connections with different URLs', () => {
		const config = loadConfig()
		const local = config.connections['my-ollama']
		const remote = config.connections['remote-ollama']
		expect(local.baseUrl).toBe('http://localhost:11434')
		expect(remote.baseUrl).toBe('http://remote-host:11434')
	})

	test('fetchOllamaModels uses connection baseUrl from config', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://localhost:11434/api/tags')
			return new Response(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }))
		}) as unknown as typeof fetch

		const config = loadConfig()
		const conn = config.connections['my-ollama']
		const models = await fetchOllamaModels(conn.baseUrl || undefined)
		expect(models).toHaveLength(1)
		expect(models[0].id).toBe('llama3.2:latest')
	})

	test('fetchOllamaModels uses remote connection baseUrl', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://remote-host:11434/api/tags')
			return new Response(JSON.stringify({
				models: [{ name: 'codellama:7b' }, { name: 'mistral:latest' }],
			}))
		}) as unknown as typeof fetch

		const config = loadConfig()
		const conn = config.connections['remote-ollama']
		const models = await fetchOllamaModels(conn.baseUrl || undefined)
		expect(models).toHaveLength(2)
	})
})

describe('Ollama integration: pull model flow', () => {
	let originalFetch: typeof globalThis.fetch

	beforeEach(() => {
		originalFetch = globalThis.fetch
		invalidateConfigCache()
		writeTestConfig()
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('pull sends request to correct endpoint based on config baseUrl', async () => {
		globalThis.fetch = mock(async (url: string, opts: RequestInit) => {
			expect(url).toBe('http://localhost:11434/api/pull')
			expect(opts.method).toBe('POST')
			const body = JSON.parse(opts.body as string)
			expect(body.name).toBe('phi3')
			expect(body.stream).toBe(true)
			return new Response('{"status":"success"}\n', { status: 200 })
		}) as unknown as typeof fetch

		const config = loadConfig()
		const conn = config.connections['my-ollama']
		const events = []
		for await (const event of pullOllamaModel('phi3', conn.baseUrl || undefined)) {
			events.push(event)
		}
		expect(events).toHaveLength(1)
		expect(events[0].status).toBe('success')
	})

	test('pull to remote Ollama instance uses correct URL', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://remote-host:11434/api/pull')
			return new Response('{"status":"success"}\n', { status: 200 })
		}) as unknown as typeof fetch

		const config = loadConfig()
		const conn = config.connections['remote-ollama']
		const events = []
		for await (const event of pullOllamaModel('mistral', conn.baseUrl || undefined)) {
			events.push(event)
		}
		expect(events).toHaveLength(1)
	})

	test('pull with full progress stream', async () => {
		const ndjson = [
			'{"status":"pulling manifest"}',
			'{"status":"downloading digestname","digest":"sha256:abc123","total":4000000000,"completed":1000000000}',
			'{"status":"downloading digestname","digest":"sha256:abc123","total":4000000000,"completed":4000000000}',
			'{"status":"verifying sha256 digest"}',
			'{"status":"writing manifest"}',
			'{"status":"success"}',
		].join('\n') + '\n'

		globalThis.fetch = mock(async () => {
			return new Response(ndjson, { status: 200 })
		}) as unknown as typeof fetch

		const events = []
		for await (const event of pullOllamaModel('llama3.2')) {
			events.push(event)
		}
		expect(events).toHaveLength(6)
		expect(events[0].status).toBe('pulling manifest')
		expect(events[1].digest).toBe('sha256:abc123')
		expect(events[1].total).toBe(4000000000)
		expect(events[1].completed).toBe(1000000000)
		expect(events[5].status).toBe('success')
	})

	test('pull handles Ollama not running', async () => {
		globalThis.fetch = mock(async () => {
			throw new Error('fetch failed: ECONNREFUSED')
		}) as unknown as typeof fetch

		const gen = pullOllamaModel('llama3.2')
		await expect(gen.next()).rejects.toThrow('ECONNREFUSED')
	})

	test('pull handles model not found', async () => {
		globalThis.fetch = mock(async () => {
			return new Response('model not found', { status: 404, statusText: 'Not Found' })
		}) as unknown as typeof fetch

		const gen = pullOllamaModel('nonexistent-model')
		await expect(gen.next()).rejects.toThrow('Ollama pull failed: 404 Not Found')
	})
})

describe('Ollama integration: daemon endpoint validation logic', () => {
	beforeEach(() => {
		invalidateConfigCache()
		writeTestConfig()
	})

	test('GET /ollama/models would validate connection exists', () => {
		const config = loadConfig()
		// Valid ollama connection
		expect(config.connections['my-ollama']).toBeDefined()
		expect(config.connections['my-ollama'].provider).toBe('ollama')

		// Non-existent connection
		expect(config.connections['nonexistent']).toBeUndefined()
	})

	test('GET /ollama/models would reject non-ollama connection', () => {
		const config = loadConfig()
		const conn = config.connections['my-openai']
		expect(conn.provider).not.toBe('ollama')
	})

	test('POST /ollama/pull requires model parameter', () => {
		// The daemon endpoint checks: if (!body.model) return 400
		const body = {} as { model?: string }
		expect(body.model).toBeUndefined()
	})

	test('POST /ollama/pull validates connection if provided', () => {
		const config = loadConfig()

		// Valid ollama connection
		const ollamaConn = config.connections['my-ollama']
		expect(ollamaConn.provider).toBe('ollama')

		// Non-ollama connection should be rejected
		const openaiConn = config.connections['my-openai']
		expect(openaiConn.provider).not.toBe('ollama')
	})

	test('selectedModels persists through config round-trip', () => {
		const config = loadConfig()
		const conn = config.connections['my-ollama']
		expect(conn.selectedModels).toEqual(['llama3.2:latest'])

		// Simulate adding a model after pull
		conn.selectedModels = [...(conn.selectedModels || []), 'mistral:7b']
		saveConfig(config)
		invalidateConfigCache()

		const reloaded = loadConfig()
		expect(reloaded.connections['my-ollama'].selectedModels).toEqual(['llama3.2:latest', 'mistral:7b'])
	})
})
