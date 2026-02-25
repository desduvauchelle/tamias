import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { db } from './db'

const MEMORY_DIR = join(homedir(), '.tamias', 'memory')
const DAILY_DIR = join(MEMORY_DIR, 'daily')

function ensureDailyDir() {
	if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true })
}

/** Returns YYYY-MM-DD for N days ago (UTC). */
export function getDateStr(daysAgo = 0): string {
	const d = new Date()
	d.setUTCDate(d.getUTCDate() - daysAgo)
	return d.toISOString().slice(0, 10)
}

interface SessionRow {
	id: string
	name: string | null
	summary: string | null
	channelId: string | null
	channelName: string | null
	updatedAt: string
}

function getSessionsForDate(date: string): SessionRow[] {
	// updatedAt is stored as ISO strings; match everything within the UTC day
	return db.query<SessionRow, [string, string]>(
		`SELECT id, name, summary, channelId, channelName, updatedAt
		 FROM sessions
		 WHERE updatedAt >= ? AND updatedAt < ?
		 ORDER BY updatedAt ASC`,
	).all(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`)
}

function buildDigestContent(date: string): string | null {
	const sessions = getSessionsForDate(date)
	const notesPath = join(DAILY_DIR, `${date}.md`)
	const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf-8').trim() : ''

	if (sessions.length === 0 && !notes) return null

	const lines: string[] = [`# ${date}`]

	if (sessions.length > 0) {
		lines.push('\n## Sessions')
		for (const s of sessions) {
			const label = s.name || s.id
			const channel = s.channelName
				? ` [${s.channelName}]`
				: s.channelId && s.channelId !== 'terminal'
					? ` [${s.channelId}]`
					: ''
			lines.push(`\n### ${label}${channel}`)
			if (s.summary) lines.push(s.summary.trim())
		}
	}

	if (notes) {
		lines.push('\n## Notes\n')
		lines.push(notes)
	}

	return lines.join('\n') + '\n'
}

/**
 * Generate the digest file for a given date if it doesn't already exist
 * and there is data available. Returns true if a digest was written.
 */
export function generateDailyDigestIfMissing(date: string): boolean {
	ensureDailyDir()
	const digestPath = join(DAILY_DIR, `${date}.digest.md`)
	if (existsSync(digestPath)) return false

	const content = buildDigestContent(date)
	if (!content) return false

	writeFileSync(digestPath, content, 'utf-8')
	console.log(`[DailyDigest] Generated digest for ${date}`)
	return true
}

/**
 * Read digests for the last N completed days (excluding today), most recent first.
 * Skips days with no digest file.
 */
export function readRecentDigests(count = 3): Array<{ date: string; content: string }> {
	ensureDailyDir()
	const results: Array<{ date: string; content: string }> = []
	// Look back up to count+5 days to skip any empty/missing days
	for (let i = 1; i <= count + 5 && results.length < count; i++) {
		const date = getDateStr(i)
		const digestPath = join(DAILY_DIR, `${date}.digest.md`)
		if (existsSync(digestPath)) {
			const content = readFileSync(digestPath, 'utf-8').trim()
			if (content) results.push({ date, content })
		}
	}
	return results
}

/**
 * Called at startup and every 24h.
 * Generates digests for any recent days that are missing one.
 */
export function runDailyDigestMaintenance(daysBack = 3): void {
	for (let i = 1; i <= daysBack; i++) {
		generateDailyDigestIfMissing(getDateStr(i))
	}
}
