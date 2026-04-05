import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { fetchOllamaModels, pullOllamaModel, fetchModels } from './models.ts'
import type { OllamaPullProgress } from './models.ts'

describe('fetchOllamaModels', () => {
	let originalFetch: typeof globalThis.fetch

	beforeEach(() => {
		originalFetch = globalThis.fetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('fetches models from native /api/tags endpoint', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://127.0.0.1:11434/api/tags')
			return new Response(JSON.stringify({
				models: [
					{ name: 'llama3.2:latest' },
					{ name: 'mistral:7b' },
				],
			}))
		}) as unknown as typeof fetch

		const models = await fetchOllamaModels()
		expect(models).toHaveLength(2)
		expect(models[0]).toEqual({ id: 'llama3.2:latest', name: 'llama3.2:latest' })
		expect(models[1]).toEqual({ id: 'mistral:7b', name: 'mistral:7b' })
	})

	test('uses custom baseUrl', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://myhost:9999/api/tags')
			return new Response(JSON.stringify({ models: [{ name: 'phi3' }] }))
		}) as unknown as typeof fetch

		const models = await fetchOllamaModels('http://myhost:9999')
		expect(models).toHaveLength(1)
		expect(models[0].id).toBe('phi3')
	})

	test('strips trailing slash from baseUrl', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://localhost:11434/api/tags')
			return new Response(JSON.stringify({ models: [] }))
		}) as unknown as typeof fetch

		const models = await fetchOllamaModels('http://localhost:11434/')
		expect(models).toHaveLength(0)
	})

	test('uses OpenAI-compatible endpoint when baseUrl ends with /v1', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://localhost:11434/v1/models')
			return new Response(JSON.stringify({
				data: [{ id: 'llama3.2' }, { id: 'codellama' }],
			}))
		}) as unknown as typeof fetch

		const models = await fetchOllamaModels('http://localhost:11434/v1')
		expect(models).toHaveLength(2)
		expect(models[0]).toEqual({ id: 'llama3.2', name: 'llama3.2' })
	})

	test('throws on non-OK response from native endpoint', async () => {
		globalThis.fetch = mock(async () => {
			return new Response('', { status: 500 })
		}) as unknown as typeof fetch

		await expect(fetchOllamaModels()).rejects.toThrow('Ollama API error: 500')
	})

	test('throws on non-OK response from /v1 endpoint', async () => {
		globalThis.fetch = mock(async () => {
			return new Response('', { status: 404 })
		}) as unknown as typeof fetch

		await expect(fetchOllamaModels('http://localhost:11434/v1')).rejects.toThrow('Ollama (OpenAI) API error: 404')
	})

	test('returns empty array for empty models list', async () => {
		globalThis.fetch = mock(async () => {
			return new Response(JSON.stringify({ models: [] }))
		}) as unknown as typeof fetch

		const models = await fetchOllamaModels()
		expect(models).toEqual([])
	})
})

describe('pullOllamaModel', () => {
	let originalFetch: typeof globalThis.fetch

	beforeEach(() => {
		originalFetch = globalThis.fetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('streams progress events from NDJSON response', async () => {
		const ndjson = [
			'{"status":"pulling manifest"}',
			'{"status":"downloading","digest":"sha256:abc","total":1000,"completed":500}',
			'{"status":"downloading","digest":"sha256:abc","total":1000,"completed":1000}',
			'{"status":"success"}',
		].join('\n') + '\n'

		globalThis.fetch = mock(async () => {
			return new Response(ndjson, { status: 200 })
		}) as unknown as typeof fetch

		const events: OllamaPullProgress[] = []
		for await (const event of pullOllamaModel('llama3.2')) {
			events.push(event)
		}

		expect(events).toHaveLength(4)
		expect(events[0].status).toBe('pulling manifest')
		expect(events[1]).toEqual({
			status: 'downloading',
			digest: 'sha256:abc',
			total: 1000,
			completed: 500,
		})
		expect(events[3].status).toBe('success')
	})

	test('sends correct POST body to Ollama API', async () => {
		globalThis.fetch = mock(async (url: string, opts: RequestInit) => {
			expect(url).toBe('http://127.0.0.1:11434/api/pull')
			expect(opts.method).toBe('POST')
			const body = JSON.parse(opts.body as string)
			expect(body.name).toBe('mistral:7b')
			expect(body.stream).toBe(true)
			return new Response('{"status":"success"}\n', { status: 200 })
		}) as unknown as typeof fetch

		const events: OllamaPullProgress[] = []
		for await (const event of pullOllamaModel('mistral:7b')) {
			events.push(event)
		}
		expect(events).toHaveLength(1)
	})

	test('uses custom baseUrl', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://myhost:9999/api/pull')
			return new Response('{"status":"success"}\n', { status: 200 })
		}) as unknown as typeof fetch

		const events: OllamaPullProgress[] = []
		for await (const event of pullOllamaModel('phi3', 'http://myhost:9999')) {
			events.push(event)
		}
		expect(events).toHaveLength(1)
	})

	test('strips trailing slash from baseUrl', async () => {
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe('http://localhost:11434/api/pull')
			return new Response('{"status":"success"}\n', { status: 200 })
		}) as unknown as typeof fetch

		const events: OllamaPullProgress[] = []
		for await (const event of pullOllamaModel('test', 'http://localhost:11434/')) {
			events.push(event)
		}
		expect(events).toHaveLength(1)
	})

	test('throws on non-OK response', async () => {
		globalThis.fetch = mock(async () => {
			return new Response('not found', { status: 404, statusText: 'Not Found' })
		}) as unknown as typeof fetch

		const gen = pullOllamaModel('nonexistent')
		await expect(gen.next()).rejects.toThrow('Ollama pull failed: 404 Not Found')
	})

	test('handles partial JSON lines across chunks', async () => {
		const encoder = new TextEncoder()
		const chunk1 = encoder.encode('{"status":"pull')
		const chunk2 = encoder.encode('ing manifest"}\n{"status":"success"}\n')

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(chunk1)
				controller.enqueue(chunk2)
				controller.close()
			},
		})

		globalThis.fetch = mock(async () => {
			return new Response(stream, { status: 200 })
		}) as unknown as typeof fetch

		const events: OllamaPullProgress[] = []
		for await (const event of pullOllamaModel('test')) {
			events.push(event)
		}

		expect(events).toHaveLength(2)
		expect(events[0].status).toBe('pulling manifest')
		expect(events[1].status).toBe('success')
	})

	test('skips malformed JSON lines', async () => {
		const ndjson = '{"status":"ok"}\nnot-json\n{"status":"done"}\n'

		globalThis.fetch = mock(async () => {
			return new Response(ndjson, { status: 200 })
		}) as unknown as typeof fetch

		const events: OllamaPullProgress[] = []
		for await (const event of pullOllamaModel('test')) {
			events.push(event)
		}

		expect(events).toHaveLength(2)
		expect(events[0].status).toBe('ok')
		expect(events[1].status).toBe('done')
	})

	test('handles remaining buffer after stream ends', async () => {
		// No trailing newline
		const ndjson = '{"status":"success"}'

		globalThis.fetch = mock(async () => {
			return new Response(ndjson, { status: 200 })
		}) as unknown as typeof fetch

		const events: OllamaPullProgress[] = []
		for await (const event of pullOllamaModel('test')) {
			events.push(event)
		}

		expect(events).toHaveLength(1)
		expect(events[0].status).toBe('success')
	})
})

describe('fetchModels with ollama provider', () => {
	let originalFetch: typeof globalThis.fetch

	beforeEach(() => {
		originalFetch = globalThis.fetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	test('delegates to fetchOllamaModels for ollama provider', async () => {
		globalThis.fetch = mock(async () => {
			return new Response(JSON.stringify({
				models: [{ name: 'llama3.2' }],
			}))
		}) as unknown as typeof fetch

		const models = await fetchModels('ollama', '', 'http://localhost:11434')
		expect(models).toHaveLength(1)
		expect(models[0].id).toBe('llama3.2')
	})

	test('returns empty array on fetch error', async () => {
		globalThis.fetch = mock(async () => {
			throw new Error('ECONNREFUSED')
		}) as unknown as typeof fetch

		const models = await fetchModels('ollama', '')
		expect(models).toEqual([])
	})
})
