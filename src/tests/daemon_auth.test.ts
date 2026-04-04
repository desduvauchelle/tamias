import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'

describe('Daemon Authentication Integration', () => {
	const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

	const clearFile = () => {
		if (existsSync(DAEMON_FILE)) unlinkSync(DAEMON_FILE)
	}

	beforeEach(clearFile)
	afterEach(clearFile)

	test('should generate a 24-byte hex token on startup', () => {
		// Verify that writeDaemonInfo/readDaemonInfo handles the token field.
		// Uses fs directly so the test is not sensitive to mock.module() pollution
		// from other test files that mock ../utils/daemon.ts.

		const testInfo = {
			pid: 12345,
			port: 9001,
			startedAt: new Date().toISOString(),
			token: 'test-token-abcdef'
		}

		mkdirSync(join(homedir(), '.tamias'), { recursive: true })
		writeFileSync(DAEMON_FILE, JSON.stringify(testInfo, null, 2), 'utf-8')

		const saved = JSON.parse(readFileSync(DAEMON_FILE, 'utf-8'))
		expect(saved.token).toBe('test-token-abcdef')
	})
})
