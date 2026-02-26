import { db } from './db'
import { getEstimatedCost } from './pricing'

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
	/** Optional enriched fields from Phase 8 */
	tenantId?: string
	agentId?: string
	channelId?: string
	cachedPromptTokens?: number
	systemTokens?: number
	conversationTokens?: number
	toolTokens?: number
}

/**
 * Appends a log entry to the SQLite database and returns its ID.
 */
export function logAiRequest(payload: AiLogPayload): number | undefined {
	try {
		// Calculate estimated cost
		let estimatedCostUsd: number | null = null
		try {
			if (payload.tokens?.prompt && payload.tokens?.completion) {
				estimatedCostUsd = getEstimatedCost(payload.model, payload.tokens.prompt, payload.tokens.completion)
			}
		} catch { /* pricing may not have this model */ }

		const result = db.prepare(`
            INSERT INTO ai_logs (timestamp, sessionId, model, provider, action, durationMs, promptTokens, completionTokens, totalTokens, requestMessagesJson, response, tenantId, agentId, channelId, cachedPromptTokens, systemTokens, conversationTokens, toolTokens, estimatedCostUsd)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			payload.response,
			payload.tenantId || null,
			payload.agentId || null,
			payload.channelId || null,
			payload.cachedPromptTokens || null,
			payload.systemTokens || null,
			payload.conversationTokens || null,
			payload.toolTokens || null,
			estimatedCostUsd,
		)
		return result.lastInsertRowid as number
	} catch (err) {
		console.error('⚠️  Failed to write AI request log:', err)
		return undefined
	}
}
