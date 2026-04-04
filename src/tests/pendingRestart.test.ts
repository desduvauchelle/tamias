// src/tests/pendingRestart.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let tmpDir: string

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'tamias-pr-test-'))
	process.env.TAMIAS_DIR = tmpDir
})

afterEach(() => {
	delete process.env.TAMIAS_DIR
	rmSync(tmpDir, { recursive: true, force: true })
})

import {
	writePendingRestart,
	readPendingRestart,
	clearPendingRestart,
	checkPendingRestart,
	type PendingRestart,
} from '../utils/pendingRestart.ts'

const sample: PendingRestart = {
	channelId: 'discord:1234567890',
	channelUserId: 'user-42',
	fromVersion: '26.03.16.4',
	toVersion: '26.04.03.1',
	changelog: '## What\'s New\n- Fixed cron jobs\n- Better auth',
	requestedAt: '2026-04-03T23:36:00.000Z',
}

describe('writePendingRestart / readPendingRestart', () => {
	test('readPendingRestart returns null when file does not exist', () => {
		expect(readPendingRestart()).toBeNull()
	})

	test('writePendingRestart writes JSON and readPendingRestart returns it', () => {
		writePendingRestart(sample)
		const result = readPendingRestart()
		expect(result).toEqual(sample)
	})

	test('readPendingRestart returns null when file is corrupt JSON', () => {
		const { writeFileSync } = require('fs')
		writeFileSync(join(tmpDir, 'pending-restart.json'), 'not-json', 'utf-8')
		expect(readPendingRestart()).toBeNull()
	})
})

describe('clearPendingRestart', () => {
	test('deletes the file when it exists', () => {
		writePendingRestart(sample)
		clearPendingRestart()
		expect(readPendingRestart()).toBeNull()
	})

	test('is a no-op when file does not exist', () => {
		expect(() => clearPendingRestart()).not.toThrow()
	})
})

describe('checkPendingRestart', () => {
	test('is a no-op when no pending file exists', async () => {
		const broadcastMock = mock(() => Promise.resolve())
		const fakeBridgeManager = { broadcastToChannel: broadcastMock } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(broadcastMock).not.toHaveBeenCalled()
	})

	test('sends message to stored channelId with version info', async () => {
		writePendingRestart(sample)
		const broadcastMock = mock(() => Promise.resolve())
		const fakeBridgeManager = { broadcastToChannel: broadcastMock } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(broadcastMock).toHaveBeenCalledTimes(1)
		const [calledChannelId, calledMessage, calledUserId] = broadcastMock.mock.calls[0] as unknown as [string, string, string]
		expect(calledChannelId).toBe('discord:1234567890')
		expect(calledMessage).toContain('26.03.16.4')
		expect(calledMessage).toContain('26.04.03.1')
		expect(calledMessage).toContain("What's New")
		expect(calledUserId).toBe('user-42')
	})

	test('deletes the file after sending', async () => {
		writePendingRestart(sample)
		const fakeBridgeManager = { broadcastToChannel: mock(() => Promise.resolve()) } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(readPendingRestart()).toBeNull()
	})

	test('deletes the file even when broadcastToChannel throws', async () => {
		writePendingRestart(sample)
		const fakeBridgeManager = { broadcastToChannel: mock(() => Promise.reject(new Error('no connection'))) } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(readPendingRestart()).toBeNull()
	})
})
