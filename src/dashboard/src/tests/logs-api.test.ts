import { describe, expect, test, beforeAll, afterAll, mock } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const fakeHome = await mkdtemp(join(tmpdir(), 'tamias-logs-api-test-'))
const fakeTamiasDir = join(fakeHome, '.tamias')
const daemonPath = join(fakeTamiasDir, 'daemon.json')

import * as osModule from 'os'
mock.module('os', () => ({
	...osModule,
	homedir: () => fakeHome,
}))

beforeAll(async () => {
	await mkdir(fakeTamiasDir, { recursive: true })
	await writeFile(daemonPath, JSON.stringify({ port: 19095 }, null, 2), 'utf8')
})

afterAll(async () => {
	await rm(fakeHome, { recursive: true, force: true })
})

describe('GET /api/logs proxy', () => {
	test('forwards query params and returns daemon payload', async () => {
		const originalFetch = globalThis.fetch
		let calledUrl = ''
		globalThis.fetch = ((async (input: RequestInfo | URL) => {
			calledUrl = String(input)
			const payload = {
				logs: [
					{
						id: 1,
						timestamp: new Date().toISOString(),
						source: 'daemon',
						type: 'daemon_starting',
						level: 'info',
						message: 'Daemon vX starting',
					},
				],
			}
			return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
		}) as unknown) as typeof fetch

		try {
			const { GET } = await import('../app/api/logs/route')
			const req = new Request('http://localhost/api/logs?source=daemon&limit=20')
			const res = await GET(req)
			expect(res.status).toBe(200)
			const body = await res.json() as { logs: Array<{ source: string }> }
			expect(body.logs.length).toBe(1)
			expect(body.logs[0]?.source).toBe('daemon')
			expect(calledUrl).toContain('/logs?source=daemon&limit=20')
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
