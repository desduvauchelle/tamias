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
})
