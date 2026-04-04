import { describe, expect, test } from 'bun:test'
import { db } from './db.ts'
import { emitLogEvent, listUnifiedLogs } from './unifiedLogging.ts'

describe('unified logging', () => {
	test('writes and reads unified log records', () => {
		const before = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM unified_logs').get()?.count ?? 0

		const written = emitLogEvent({
			source: 'daemon',
			type: 'test_event',
			level: 'info',
			sessionId: 'test-session',
			channelId: 'terminal',
			message: 'Test unified log write',
			metadata: { ok: true, marker: 'unified-test' },
		})
		expect(written).toBeDefined()
		if (!written) return

		const after = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM unified_logs').get()?.count ?? 0
		expect(after).toBe(before + 1)

		const found = listUnifiedLogs({ q: 'unified-test', limit: 10 })
		expect(found.length).toBeGreaterThan(0)
		expect(found[0]?.source).toBe('daemon')

		db.prepare('DELETE FROM unified_logs WHERE id = ?').run(written.id)
	})
})
