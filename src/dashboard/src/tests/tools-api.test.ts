import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { NextRequest } from 'next/server'

const fakeHome = await mkdtemp(join(tmpdir(), 'tamias-tools-test-'))
const fakeTamiasDir = join(fakeHome, '.tamias')
const configPath = join(fakeTamiasDir, 'config.json')

import * as osModule from 'os'
mock.module('os', () => ({
	...osModule,
	homedir: () => fakeHome,
}))

await mkdir(fakeTamiasDir, { recursive: true })

const { GET, POST } = await import('../app/api/tools/route')

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
	return new NextRequest(new URL(url, 'http://localhost:3000'), init)
}

async function readConfig() {
	const content = await readFile(configPath, 'utf8')
	return JSON.parse(content)
}

beforeEach(async () => {
	await writeFile(configPath, JSON.stringify({
		version: '1.0',
		connections: {},
		bridges: { terminal: { enabled: true } },
		ngrok: { enabled: false },
	}, null, 2), 'utf8')
})

afterAll(async () => {
	await rm(fakeHome, { recursive: true, force: true })
})

describe('Tools API ngrok settings', () => {
	test('GET returns ngrok config with default shape', async () => {
		const res = await GET()
		expect(res.status).toBe(200)
		const body = await res.json() as { ngrok?: { enabled?: boolean } }
		expect(typeof body.ngrok?.enabled).toBe('boolean')
	})

	test('POST persists ngrok enabled setting', async () => {
		const res = await POST(req('/api/tools', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ngrok: { enabled: true } }),
		}) as unknown as Request)
		expect(res.status).toBe(200)
		const saved = await readConfig()
		expect(saved.ngrok.enabled).toBe(true)
	})
})
