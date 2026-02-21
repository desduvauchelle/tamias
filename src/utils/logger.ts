import { db } from './db'

export interface AiLogPayload {
	timestamp: string
	sessionId: string
	model: string
	provider: string
	action: 'chat' | 'compact'
	durationMs: number
	tokens?: {
		prompt?: number
		completion?: number
		total?: number
	}
	messages: unknown[]
	response: string
}

/**
 * Appends a log entry to the SQLite database.
 */
export function logAiRequest(payload: AiLogPayload): void {
	try {
		db.prepare(`
            INSERT INTO ai_logs (timestamp, sessionId, model, provider, action, durationMs, promptTokens, completionTokens, totalTokens, requestMessagesJson, response)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
			payload.timestamp,
			payload.sessionId,
			payload.model,
			payload.provider,
			payload.action,
			payload.durationMs,
			payload.tokens?.prompt || null,
			payload.tokens?.completion || null,
			payload.tokens?.total || null,
			JSON.stringify(payload.messages),
			payload.response
		)
	} catch (err) {
		console.error('⚠️  Failed to write AI request log:', err)
	}
}
