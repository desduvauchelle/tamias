import { db } from './db'
import { z } from 'zod'

export const MessageSchema = z.object({
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string(),
})

export const SessionPersistSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	createdAt: z.string(), // ISO String
	updatedAt: z.string(), // ISO String
	model: z.string(),
	summary: z.string().optional(),
	channelId: z.string().optional(),
	channelUserId: z.string().optional(),
	channelName: z.string().optional(),
	messages: z.array(MessageSchema),
})

export type SessionPersist = z.infer<typeof SessionPersistSchema>
export type Message = z.infer<typeof MessageSchema>

/** Save a session to disk */
export function saveSessionToDisk(session: SessionPersist): void {
	db.transaction(() => {
		const [connectionNickname, ...rest] = session.model.split('/')
		const modelId = rest.join('/')

		db.prepare(`
			INSERT INTO sessions (id, name, model, connectionNickname, modelId, createdAt, updatedAt, summary, channelId, channelUserId, channelName)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				name = excluded.name,
				model = excluded.model,
				connectionNickname = excluded.connectionNickname,
				modelId = excluded.modelId,
				updatedAt = excluded.updatedAt,
				summary = excluded.summary,
				channelId = excluded.channelId,
				channelUserId = excluded.channelUserId,
				channelName = excluded.channelName
		`).run(
			session.id,
			session.name || null,
			session.model,
			connectionNickname,
			modelId,
			session.createdAt,
			session.updatedAt,
			session.summary || null,
			session.channelId || null,
			session.channelUserId || null,
			session.channelName || null
		)

		// Synchronize messages by overwriting
		db.prepare('DELETE FROM messages WHERE sessionId = ?').run(session.id)

		const insertMsg = db.prepare('INSERT INTO messages (sessionId, role, content) VALUES (?, ?, ?)')
		for (const msg of session.messages) {
			insertMsg.run(session.id, msg.role, msg.content)
		}
	})()
}

/** Load a session from disk */
export function loadSessionFromDisk(id: string): SessionPersist | null {
	const sessionRow = db.query<{
		id: string,
		name: string | null,
		createdAt: string,
		updatedAt: string,
		model: string,
		summary: string | null,
		channelId: string | null,
		channelUserId: string | null,
		channelName: string | null
	}, [string]>('SELECT * FROM sessions WHERE id = ?').get(id)

	if (!sessionRow) return null

	const messagesRows = db.query<{ role: string, content: string }, [string]>('SELECT role, content FROM messages WHERE sessionId = ? ORDER BY id ASC').all(id)

	return {
		id: sessionRow.id,
		name: sessionRow.name || undefined,
		createdAt: sessionRow.createdAt,
		updatedAt: sessionRow.updatedAt,
		model: sessionRow.model,
		summary: sessionRow.summary || undefined,
		channelId: sessionRow.channelId || undefined,
		channelUserId: sessionRow.channelUserId || undefined,
		channelName: sessionRow.channelName || undefined,
		messages: messagesRows as any
	}
}

/** List all sessions from disk, grouped by metadata */
export function listAllStoredSessions(): Array<{ id: string, name?: string, updatedAt: string }> {
	const rows = db.query<{ id: string, name: string | null, updatedAt: string }, []>('SELECT id, name, updatedAt FROM sessions ORDER BY updatedAt DESC').all()
	return rows.map(r => ({
		id: r.id,
		name: r.name || undefined,
		updatedAt: r.updatedAt
	}))
}

/** Delete a session from disk */
export function deleteSessionFromDisk(id: string): void {
	db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}
