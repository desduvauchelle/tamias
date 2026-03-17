import { expect, test, describe, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { homedir } from 'os'

// Mock playwright BEFORE browser.ts is loaded.
// browser.ts dynamically imports playwright from ~/.tamias/node_modules/playwright;
// registering the mock here intercepts that dynamic import when functions are called.
const PLAYWRIGHT_DATA_DIR = join(homedir(), '.tamias', 'node_modules', 'playwright')
mock.module(PLAYWRIGHT_DATA_DIR, () => ({
	chromium: {
		launchPersistentContext: mock(async () => ({
			close: mock(async () => undefined),
			pages: mock(() => []),
			newPage: mock(async () => ({
				goto: mock(async () => undefined),
			})),
			on: (_evt: string, _cb: () => void) => undefined,
		})),
	},
}))

import {
	getBrowserInstallStatus,
	isAuthBrowserOpen,
	launchAuthBrowser,
	closeAuthBrowser,
} from '../tools/browser.ts'

afterEach(async () => {
	// Always close any lingering browser to keep module state clean
	await closeAuthBrowser()
})

describe('getBrowserInstallStatus', () => {
	test('returns an object with an installed boolean', async () => {
		const status = await getBrowserInstallStatus()
		expect(status).toHaveProperty('installed')
		expect(typeof status.installed).toBe('boolean')
	})

	test('returns installed:true when playwright module is available', async () => {
		const status = await getBrowserInstallStatus()
		// Our mock makes playwright importable, so it should report installed
		expect(status.installed).toBe(true)
	})
})

describe('isAuthBrowserOpen', () => {
	test('returns a boolean', () => {
		expect(typeof isAuthBrowserOpen()).toBe('boolean')
	})

	test('returns false before any launch', () => {
		expect(isAuthBrowserOpen()).toBe(false)
	})

	test('returns true after launchAuthBrowser', async () => {
		await launchAuthBrowser()
		expect(isAuthBrowserOpen()).toBe(true)
	})
})

describe('launchAuthBrowser', () => {
	test('returns { ok, message } shape', async () => {
		const result = await launchAuthBrowser()
		expect(result).toHaveProperty('ok')
		expect(result).toHaveProperty('message')
		expect(typeof result.ok).toBe('boolean')
		expect(typeof result.message).toBe('string')
	})

	test('returns ok:true when playwright mock succeeds', async () => {
		const result = await launchAuthBrowser()
		expect(result.ok).toBe(true)
	})

	test('accepts an optional URL without crashing', async () => {
		const result = await launchAuthBrowser('https://example.com')
		expect(result).toHaveProperty('ok')
		expect(result).toHaveProperty('message')
	})

	test('reuses existing context on second call', async () => {
		await launchAuthBrowser()
		expect(isAuthBrowserOpen()).toBe(true)
		// Second call should not try to re-launch
		const result = await launchAuthBrowser()
		expect(result.ok).toBe(true)
	})
})

describe('closeAuthBrowser', () => {
	test('returns { ok: true } when no browser is open', async () => {
		// afterEach already closed any browser — start clean
		await closeAuthBrowser()
		const result = await closeAuthBrowser()
		expect(result).toEqual({ ok: true })
	})

	test('returns { ok: true } after a browser was opened', async () => {
		await launchAuthBrowser()
		expect(isAuthBrowserOpen()).toBe(true)
		const result = await closeAuthBrowser()
		expect(result).toEqual({ ok: true })
	})

	test('sets isAuthBrowserOpen to false after close', async () => {
		await launchAuthBrowser()
		await closeAuthBrowser()
		expect(isAuthBrowserOpen()).toBe(false)
	})

	test('is safe to call multiple times', async () => {
		await closeAuthBrowser()
		await closeAuthBrowser()
		const result = await closeAuthBrowser()
		expect(result).toEqual({ ok: true })
	})
})
