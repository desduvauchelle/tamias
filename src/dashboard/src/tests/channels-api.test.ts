import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { NextRequest } from 'next/server'

interface ChannelBridgeInstance {
	mode?: string
}

interface ChannelsGetResponse {
	bridges: {
		discords: Record<string, ChannelBridgeInstance>
		telegrams: Record<string, ChannelBridgeInstance>
	}
}

const fakeHome = await mkdtemp(join(tmpdir(), 'tamias-channels-test-'))
const fakeTamiasDir = join(fakeHome, '.tamias')
const configPath = join(fakeTamiasDir, 'config.json')

import * as osModule from 'os'
mock.module('os', () => ({
	...osModule,
	homedir: () => fakeHome,
}))

await mkdir(fakeTamiasDir, { recursive: true })

const { GET, POST } = await import('../app/api/channels/route')

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
	return new NextRequest(new URL(url, 'http://localhost:3000'), init)
}

async function readConfig() {
	const content = await readFile(configPath, 'utf8')
	return JSON.parse(content)
}

beforeEach(async () => {
	const baseConfig = {
		version: '1.0',
		connections: {},
		bridges: {
			terminal: { enabled: true },
			discords: {
				existing: {
					enabled: true,
					allowedChannels: ['123'],
					mode: 'mention-only',
				},
			},
			telegrams: {
				existing: {
					enabled: true,
					allowedChats: ['-100111'],
					mode: 'listen-only',
				},
			},
		},
	}
	await writeFile(configPath, JSON.stringify(baseConfig, null, 2), 'utf8')
})

afterAll(async () => {
	await rm(fakeHome, { recursive: true, force: true })
})

describe('Channels API mode handling', () => {
	test('GET returns instance mode values', async () => {
		const res = await GET()
		expect(res.status).toBe(200)
		const body = await res.json() as ChannelsGetResponse
		expect(body.bridges.discords.existing.mode).toBe('mention-only')
		expect(body.bridges.telegrams.existing.mode).toBe('listen-only')
	})

	test('POST defaults missing mode to full for new instances', async () => {
		const res = await POST(req('/api/channels', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				bridges: {
					discords: {
						newbot: {
							enabled: true,
							allowedChannels: ['456'],
							botToken: '',
						},
					},
					telegrams: {
						newbot: {
							enabled: true,
							allowedChats: ['-100222'],
							botToken: '',
						},
					},
				},
			}),
		}))

		expect(res.status).toBe(200)
		const saved = await readConfig()
		expect(saved.bridges.discords.newbot.mode).toBe('full')
		expect(saved.bridges.telegrams.newbot.mode).toBe('full')
	})

	test('POST preserves existing mode when omitted in payload', async () => {
		const res = await POST(req('/api/channels', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				bridges: {
					discords: {
						existing: {
							enabled: true,
							allowedChannels: ['123'],
							botToken: '',
						},
					},
					telegrams: {
						existing: {
							enabled: true,
							allowedChats: ['-100111'],
							botToken: '',
						},
					},
				},
			}),
		}))

		expect(res.status).toBe(200)
		const saved = await readConfig()
		expect(saved.bridges.discords.existing.mode).toBe('mention-only')
		expect(saved.bridges.telegrams.existing.mode).toBe('listen-only')
	})
})
