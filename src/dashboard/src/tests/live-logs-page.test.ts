import { describe, expect, test } from 'bun:test'
import { formatLiveLogTimestamp } from '../app/live-logs/page'

describe('Live logs timestamp formatting', () => {
	test('renders full locale date-time for valid ISO timestamp', () => {
		const iso = '2026-01-15T13:45:30.000Z'
		const formatted = formatLiveLogTimestamp(iso)

		expect(formatted).not.toBe(iso)
		expect(formatted.length).toBeGreaterThan(8)
	})

	test('returns original value for invalid timestamp string', () => {
		const invalid = 'not-a-timestamp'
		expect(formatLiveLogTimestamp(invalid)).toBe(invalid)
	})

	test('format helper remains stable for logs page naming change', () => {
		const iso = '2026-02-01T00:00:00.000Z'
		expect(typeof formatLiveLogTimestamp(iso)).toBe('string')
	})

	test('format helper keeps deterministic fallback for malformed values', () => {
		expect(formatLiveLogTimestamp('')).toBe('')
	})
})
