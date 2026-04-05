import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const fakeHome = await mkdtemp(join(tmpdir(), 'tamias-update-api-test-'))
const fakeTamiasDir = join(fakeHome, '.tamias')
const daemonPath = join(fakeTamiasDir, 'daemon.json')
const cachePath = join(fakeTamiasDir, 'update-check.json')

import * as osModule from 'os'
mock.module('os', () => ({
	...osModule,
	homedir: () => fakeHome,
}))

await mkdir(fakeTamiasDir, { recursive: true })

const { GET, POST } = await import('../app/api/update/route')

beforeEach(async () => {
	await writeFile(daemonPath, JSON.stringify({ port: 19091 }, null, 2), 'utf8')
	await writeFile(cachePath, JSON.stringify({
		updateAvailable: true,
		currentVersion: '1.0.0',
		latestVersion: '1.1.0',
		checkedAt: Date.now(),
	}, null, 2), 'utf8')
})

afterAll(async () => {
	await rm(fakeHome, { recursive: true, force: true })
})

describe('/api/update route', () => {
	test('GET proxies daemon payload when daemon is reachable', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () => {
			return new Response(JSON.stringify({
				updateAvailable: true,
				currentVersion: '2.0.0',
				latestVersion: '2.1.0',
				checkedAt: 123,
				updateInProgress: false,
			}), { status: 200, headers: { 'Content-Type': 'application/json' } })
		}) as unknown as typeof fetch

		try {
			const res = await GET()
			expect(res.status).toBe(200)
			const body = await res.json() as { currentVersion?: string; latestVersion?: string; updateAvailable?: boolean }
			expect(body.updateAvailable).toBe(true)
			expect(body.currentVersion).toBe('2.0.0')
			expect(body.latestVersion).toBe('2.1.0')
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('GET falls back to local cache when daemon is unreachable', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () => {
			throw new Error('offline')
		}) as unknown as typeof fetch

		try {
			const res = await GET()
			expect(res.status).toBe(200)
			const body = await res.json() as { daemonOffline?: boolean; currentVersion?: string; latestVersion?: string }
			expect(body.daemonOffline).toBe(true)
			expect(body.currentVersion).toBe('1.0.0')
			expect(body.latestVersion).toBe('1.1.0')
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('POST preserves daemon error status and payload', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () => {
			return new Response(JSON.stringify({ ok: false, error: 'Update already running.' }), {
				status: 409,
				headers: { 'Content-Type': 'application/json' },
			})
		}) as unknown as typeof fetch

		try {
			const res = await POST()
			expect(res.status).toBe(409)
			const body = await res.json() as { ok?: boolean; error?: string }
			expect(body.ok).toBe(false)
			expect(body.error).toContain('already')
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('POST returns synthetic error payload when daemon returns non-JSON', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () => {
			return new Response('not-json', { status: 500, headers: { 'Content-Type': 'text/plain' } })
		}) as unknown as typeof fetch

		try {
			const res = await POST()
			expect(res.status).toBe(500)
			const body = await res.json() as { error?: string }
			expect(body.error).toContain('non-JSON')
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
