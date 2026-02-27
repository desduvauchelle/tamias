import { describe, expect, test, beforeAll, afterAll, mock } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const fakeHome = await mkdtemp(join(tmpdir(), 'tamias-history-test-'))
const fakeTamiasDir = join(fakeHome, '.tamias')
const daemonPath = join(fakeTamiasDir, 'daemon.json')

import * as osModule from 'os'
mock.module('os', () => ({
	...osModule,
	homedir: () => fakeHome,
}))

beforeAll(async () => {
	await mkdir(fakeTamiasDir, { recursive: true })
	await writeFile(daemonPath, JSON.stringify({ port: 19091 }, null, 2), 'utf8')
})

afterAll(async () => {
	await rm(fakeHome, { recursive: true, force: true })
})

describe('GET /api/history mapping', () => {
	test('maps rich daemon fields (provider/action/duration/tokens/cost/system/tools)', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = ((async () => {
			const payload = {
				logs: [
					{
						id: '42',
						timestamp: new Date().toISOString(),
						initiator: 'sess_abc',
						model: 'openrouter/xai/grok-4.1-fast',
						provider: 'openrouter',
						action: 'chat',
						durationMs: 777,
						tokensPrompt: 123,
						tokensCompletion: 45,
						tokensTotal: 168,
						inputSnippet: 'hello there',
						response: 'general kenobi',
						estimatedCostUsd: 0.00123,
						providerCostUsd: 0.00111,
						finalCostUsd: 0.00111,
						systemPrompt: 'SYSTEM X',
						sentMessages: [{ role: 'user', content: 'hello there' }],
						toolCalls: [{ toolName: 'memory__write_file', args: { path: 'MEMORY.md' } }],
						toolResults: [{ toolName: 'memory__write_file', result: { ok: true } }],
						usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168, costUsd: 0.00111 },
						fullHistory: [{ role: 'system', content: 'SYSTEM X' }, { role: 'user', content: 'hello there' }],
					},
				],
			}
			return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
		}) as unknown) as typeof fetch

		try {
			const { GET } = await import('../app/api/history/route')
			const req = new Request('http://localhost/api/history')
			const res = await GET(req)
			expect(res.status).toBe(200)
			const body = await res.json() as any
			expect(Array.isArray(body.logs)).toBe(true)
			expect(body.logs.length).toBe(1)
			const row = body.logs[0]
			expect(row.provider).toBe('openrouter')
			expect(row.action).toBe('chat')
			expect(row.durationMs).toBe(777)
			expect(row.tokens.prompt).toBe(123)
			expect(row.tokens.completion).toBe(45)
			expect(row.tokens.total).toBe(168)
			expect(row.estimatedCostUsd).toBe(0.00123)
			expect(row.providerCostUsd).toBe(0.00111)
			expect(row.finalCostUsd).toBe(0.00111)
			expect(row.systemPrompt).toBe('SYSTEM X')
			expect(row.sentMessages?.length).toBe(1)
			expect(row.toolCalls?.length).toBe(1)
			expect(row.toolResults?.length).toBe(1)
			expect(row.usage?.totalTokens).toBe(168)
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
