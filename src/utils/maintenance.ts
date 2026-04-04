import { db } from './db'
import { runDailyDigestMaintenance } from './dailyDigest'

/**
 * Runs periodic database maintenance:
 * 1. Prunes detailed text from old logs (older than today).
 * 2. Archives metadata for logs older than 30 days to ai_logs_archive table.
 * 3. Deletes archived logs from the database.
 * 4. Cleans up old inactive sessions.
 * 5. Runs VACUUM to optimize disk space.
 */
export async function runDatabaseMaintenance(): Promise<void> {
	console.log('[Maintenance] Starting database maintenance...')

	try {
		const now = new Date()
		const today = now.toISOString().split('T')[0]
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

		// 1. Prune detailed text from logs older than today (but keep tokens and metadata)
		const pruneResult = db.prepare(`
            UPDATE ai_logs
            SET requestMessagesJson = NULL, response = 'Detailed log pruned'
            WHERE timestamp < ? AND requestMessagesJson IS NOT NULL
        `).run(today)
		if (pruneResult.changes > 0) {
			console.log(`[Maintenance] Pruned text from ${pruneResult.changes} historical logs.`)
		}

		// 2. Archive logs older than 30 days into ai_logs_archive table
		const archiveResult = db.prepare(`
			INSERT INTO ai_logs_archive (timestamp, sessionId, model, provider, action, durationMs,
				promptTokens, completionTokens, totalTokens, estimatedCostUsd, tenantId, agentId, channelId)
			SELECT timestamp, sessionId, model, provider, action, durationMs,
				promptTokens, completionTokens, totalTokens, estimatedCostUsd, tenantId, agentId, channelId
			FROM ai_logs WHERE timestamp < ?
		`).run(thirtyDaysAgo)
		if (archiveResult.changes > 0) {
			console.log(`[Maintenance] Archived ${archiveResult.changes} logs older than 30 days to ai_logs_archive.`)
		}

		// 3. Delete archived logs from the database
		const deleteResult = db.prepare('DELETE FROM ai_logs WHERE timestamp < ?').run(thirtyDaysAgo)
		if (deleteResult.changes > 0) {
			console.log(`[Maintenance] Deleted ${deleteResult.changes} archived logs from ai_logs.`)
		}

		// 4. Clean up inactive sessions (older than 90 days)
		const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
		const sessionResult = db.prepare('DELETE FROM sessions WHERE updatedAt < ?').run(ninetyDaysAgo)
		if (sessionResult.changes > 0) {
			console.log(`[Maintenance] Cleaned up ${sessionResult.changes} sessions older than 90 days.`)
		}

		// 5. Run VACUUM to reclaim space
		console.log('[Maintenance] Running VACUUM...')
		db.exec('VACUUM;')

		// 6. Generate daily digests for recent days that don't have one yet
		runDailyDigestMaintenance(3)

		console.log('[Maintenance] Database maintenance completed.')
	} catch (err) {
		console.error('[Maintenance] Failed to run database maintenance:', err)
	}
}
