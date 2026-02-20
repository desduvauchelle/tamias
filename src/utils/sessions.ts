import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { z } from 'zod'

export const SESSIONS_ROOT = join(homedir(), '.tamias', 'sessions')

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const MessageSchema = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string(),
})

export const SessionPersistSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	createdAt: z.string(), // ISO String
	updatedAt: z.string(), // ISO String
	model: z.string(),
	summary: z.string().optional(),
	messages: z.array(MessageSchema),
})

export type SessionPersist = z.infer<typeof SessionPersistSchema>
export type Message = z.infer<typeof MessageSchema>

// ─── Persistence Logic ────────────────────────────────────────────────────────

function ensureSessionsDir(monthDir: string): void {
	const path = join(SESSIONS_ROOT, monthDir)
	if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

/** Get the directory for a session based on its creation date (YYYY-MM) */
function getMonthDir(isoDate: string): string {
	return isoDate.slice(0, 7) // 2024-02
}

/** Save a session to disk */
export function saveSessionToDisk(session: SessionPersist): void {
	const monthDir = getMonthDir(session.createdAt)
	ensureSessionsDir(monthDir)

	const filePath = join(SESSIONS_ROOT, monthDir, `${session.id}.json`)
	writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8')
}

/** Load a session from disk with validation */
export function loadSessionFromDisk(id: string, monthDir: string): SessionPersist | null {
	const filePath = join(SESSIONS_ROOT, monthDir, `${id}.json`)
	if (!existsSync(filePath)) return null

	try {
		const raw = readFileSync(filePath, 'utf-8')
		const parsed = JSON.parse(raw)
		return SessionPersistSchema.parse(parsed)
	} catch (err) {
		console.error(`⚠️  Failed to load session ${id} from ${monthDir}: ${err}`)
		return null
	}
}

/** List all sessions from disk, grouped by metadata */
export function listAllStoredSessions(): Array<{ id: string, name?: string, monthDir: string, updatedAt: string }> {
	if (!existsSync(SESSIONS_ROOT)) return []

	const results: Array<{ id: string, name?: string, monthDir: string, updatedAt: string }> = []
	const months = readdirSync(SESSIONS_ROOT).filter(f => /^\d{4}-\d{2}$/.test(f))

	for (const month of months) {
		const monthPath = join(SESSIONS_ROOT, month)
		const files = readdirSync(monthPath).filter(f => f.endsWith('.json'))

		for (const file of files) {
			try {
				const raw = readFileSync(join(monthPath, file), 'utf-8')
				const parsed = JSON.parse(raw)
				// Partial parse just for metadata
				results.push({
					id: parsed.id,
					name: parsed.name,
					monthDir: month,
					updatedAt: parsed.updatedAt
				})
			} catch {
				// Skip corrupt files
			}
		}
	}

	return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Delete a session from disk */
export function deleteSessionFromDisk(id: string, monthDir: string): void {
	const filePath = join(SESSIONS_ROOT, monthDir, `${id}.json`)
	if (existsSync(filePath)) {
		unlinkSync(filePath)
	}
}
