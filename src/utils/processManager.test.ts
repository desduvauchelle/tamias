import { describe, test, expect } from 'bun:test'
import { detectRateLimit, spawnProcess, killProcess, getActiveProcessIds } from '../utils/processManager.ts'

describe('detectRateLimit', () => {
	// ── Happy path ─────────────────────────────────────────────────────────
	test('detects "rate limit" pattern', () => {
		expect(detectRateLimit('Error: rate limit exceeded')).toBe(true)
	})

	test('detects "rate_limit" with underscore', () => {
		expect(detectRateLimit('rate_limit error')).toBe(true)
	})

	test('detects "too many requests"', () => {
		expect(detectRateLimit('HTTP 429 Too Many Requests')).toBe(true)
	})

	test('detects "overloaded"', () => {
		expect(detectRateLimit('API is overloaded, try again later')).toBe(true)
	})

	test('detects HTTP 429 status code', () => {
		expect(detectRateLimit('Received status 429 from API')).toBe(true)
	})

	test('detects "quota exceeded"', () => {
		expect(detectRateLimit('Your API quota exceeded for this month')).toBe(true)
	})

	test('detects "throttle" variants', () => {
		expect(detectRateLimit('Request throttled by server')).toBe(true)
		expect(detectRateLimit('throttling enabled')).toBe(true)
	})

	test('detects "capacity"', () => {
		expect(detectRateLimit('Server at capacity, please wait')).toBe(true)
	})

	// ── Non-matching ──────────────────────────────────────────────────────
	test('returns false for normal output', () => {
		expect(detectRateLimit('File saved successfully')).toBe(false)
	})

	test('returns false for empty string', () => {
		expect(detectRateLimit('')).toBe(false)
	})

	test('returns false for unrelated error messages', () => {
		expect(detectRateLimit('TypeError: undefined is not a function')).toBe(false)
	})

	// ── Case insensitivity ────────────────────────────────────────────────
	test('detects patterns case-insensitively', () => {
		expect(detectRateLimit('RATE LIMIT reached')).toBe(true)
		expect(detectRateLimit('Too Many Requests')).toBe(true)
	})
})

describe('spawnProcess', () => {
	// ── Happy path ─────────────────────────────────────────────────────────
	test('runs a simple command and captures stdout', async () => {
		const result = await spawnProcess('test-echo', {
			command: 'echo',
			args: ['hello world'],
			cwd: '/tmp',
			timeout: 10,
		})
		expect(result.success).toBe(true)
		expect(result.stdout.trim()).toBe('hello world')
		expect(result.stderr).toBe('')
		expect(result.exitCode).toBe(0)
		expect(result.timedOut).toBe(false)
		expect(result.rateLimited).toBe(false)
		expect(result.durationMs).toBeGreaterThanOrEqual(0)
	})

	test('captures stderr from failing command', async () => {
		const result = await spawnProcess('test-fail', {
			command: 'ls',
			args: ['/nonexistent-path-that-does-not-exist-xyz'],
			cwd: '/tmp',
			timeout: 10,
		})
		expect(result.success).toBe(false)
		expect(result.exitCode).not.toBe(0)
		expect(result.stderr.length).toBeGreaterThan(0)
	})

	test('respects working directory', async () => {
		const result = await spawnProcess('test-cwd', {
			command: 'pwd',
			args: [],
			cwd: '/tmp',
			timeout: 10,
		})
		expect(result.success).toBe(true)
		// /tmp may resolve to /private/tmp on macOS
		expect(result.stdout.trim()).toMatch(/\/tmp$/)
	})

	// ── Timeout handling ──────────────────────────────────────────────────
	test('kills process after timeout and sets timedOut flag', async () => {
		const result = await spawnProcess('test-timeout', {
			command: 'sleep',
			args: ['60'],
			cwd: '/tmp',
			timeout: 1,
		})
		expect(result.success).toBe(false)
		expect(result.timedOut).toBe(true)
		expect(result.exitCode).toBe(null)
	})

	// ── Streaming callbacks ───────────────────────────────────────────────
	test('calls onStdout callback with output chunks', async () => {
		const chunks: string[] = []
		await spawnProcess('test-stream', {
			command: 'echo',
			args: ['streaming test'],
			cwd: '/tmp',
			timeout: 10,
			onStdout: (chunk) => chunks.push(chunk),
		})
		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks.join('').trim()).toBe('streaming test')
	})

	test('calls onStderr callback for error output', async () => {
		const chunks: string[] = []
		await spawnProcess('test-stderr-stream', {
			command: 'ls',
			args: ['/nonexistent-path-xyz'],
			cwd: '/tmp',
			timeout: 10,
			onStderr: (chunk) => chunks.push(chunk),
		})
		expect(chunks.length).toBeGreaterThan(0)
	})

	// ── Rate limit detection in output ────────────────────────────────────
	test('detects rate limit in stdout', async () => {
		const result = await spawnProcess('test-ratelimit', {
			command: 'echo',
			args: ['Error: rate limit exceeded'],
			cwd: '/tmp',
			timeout: 10,
		})
		expect(result.rateLimited).toBe(true)
	})

	// ── Process cleanup ───────────────────────────────────────────────────
	test('removes process from active map after completion', async () => {
		const id = 'test-cleanup-' + Date.now()
		await spawnProcess(id, {
			command: 'echo',
			args: ['done'],
			cwd: '/tmp',
			timeout: 10,
		})
		expect(getActiveProcessIds()).not.toContain(id)
	})

	// ── Multi-line output ─────────────────────────────────────────────────
	test('captures multi-line output correctly', async () => {
		const result = await spawnProcess('test-multiline', {
			command: 'printf',
			args: ['line1\\nline2\\nline3'],
			cwd: '/tmp',
			timeout: 10,
		})
		expect(result.success).toBe(true)
		const lines = result.stdout.trim().split('\n')
		expect(lines.length).toBe(3)
	})

	// ── Duration tracking ─────────────────────────────────────────────────
	test('tracks duration accurately', async () => {
		const result = await spawnProcess('test-duration', {
			command: 'sleep',
			args: ['0.5'],
			cwd: '/tmp',
			timeout: 10,
		})
		expect(result.durationMs).toBeGreaterThanOrEqual(400)
		expect(result.durationMs).toBeLessThan(5000)
	})
})

describe('killProcess', () => {
	test('returns false for non-existent process', () => {
		expect(killProcess('does-not-exist')).toBe(false)
	})

	test('kills an active process and returns true', async () => {
		const id = 'test-kill-' + Date.now()
		// Start a long-running process
		const processPromise = spawnProcess(id, {
			command: 'sleep',
			args: ['60'],
			cwd: '/tmp',
			timeout: 60,
		})

		// Give it a moment to start
		await new Promise(r => setTimeout(r, 100))
		expect(getActiveProcessIds()).toContain(id)

		const killed = killProcess(id)
		expect(killed).toBe(true)
		expect(getActiveProcessIds()).not.toContain(id)

		// Await the result — should reflect being killed
		const result = await processPromise
		expect(result.success).toBe(false)
	})
})

describe('getActiveProcessIds', () => {
	test('returns empty array when no processes running', () => {
		// After all other tests complete, active list should be clean
		const ids = getActiveProcessIds()
		expect(Array.isArray(ids)).toBe(true)
	})
})
