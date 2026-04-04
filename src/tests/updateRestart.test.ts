// src/tests/updateRestart.test.ts
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── File isolation ────────────────────────────────────────────────────────────
let tmpDir: string
beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'tamias-ur-test-'))
	process.env.TAMIAS_DIR = tmpDir
})
afterEach(() => {
	delete process.env.TAMIAS_DIR
	rmSync(tmpDir, { recursive: true, force: true })
})

// ── Patch Bun.spawn and process.exit so nothing real happens ─────────────────
const spawnMock = mock(() => ({ unref: mock(() => undefined) }))
const originalSpawn = Bun.spawn
const originalExit = process.exit
beforeEach(() => {
	;(Bun as any).spawn = spawnMock
	process.exit = ((_code?: number) => {}) as never
})
afterEach(() => {
	;(Bun as any).spawn = originalSpawn
	process.exit = originalExit
	spawnMock.mockClear()
})

import { performUpdateAndRestart } from '../utils/update.ts'
import { readPendingRestart } from '../utils/pendingRestart.ts'

const ctx = {
	channelId: 'discord:1234567890',
	channelUserId: 'user-42',
	fromVersion: '26.03.16.4',
	toVersion: '26.04.03.1',
	changelog: '## Changelog\n- fix: cron jobs restored',
}

const successResult = { success: true as const, currentVersion: '26.03.16.4', latestVersion: '26.04.03.1' }
const failResult = { success: false as const, currentVersion: '26.03.16.4', error: 'download failed' }

describe('performUpdateAndRestart', () => {
	test('writes pending-restart.json after successful update', async () => {
		// Pass a mock performUpdate via DI — no HTTP calls
		await performUpdateAndRestart(ctx, async () => successResult)
		const info = readPendingRestart()
		expect(info).not.toBeNull()
		expect(info!.channelId).toBe('discord:1234567890')
		expect(info!.channelUserId).toBe('user-42')
		expect(info!.fromVersion).toBe('26.03.16.4')
		expect(info!.toVersion).toBe('26.04.03.1')
		expect(info!.changelog).toContain('cron jobs restored')
		expect(info!.requestedAt).toBeTruthy()
	})

	test('spawns a new daemon process after writing pending file', async () => {
		await performUpdateAndRestart(ctx, async () => successResult)
		expect(spawnMock).toHaveBeenCalledTimes(1)
		const [spawnArgs] = spawnMock.mock.calls[0] as unknown as [string[], unknown]
		expect(spawnArgs).toContain('--daemon')
	})

	test('does NOT write pending-restart.json when update fails', async () => {
		await performUpdateAndRestart(ctx, async () => failResult)
		expect(readPendingRestart()).toBeNull()
		expect(spawnMock).not.toHaveBeenCalled()
	})
})
