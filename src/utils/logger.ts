import { db } from './db'
import { getEstimatedCost } from './pricing'
import { recordUsage } from './usageRolling'
import { emitLogEvent } from './unifiedLogging'

export interface AiLogPayload {
	timestamp: string
	sessionId: string
	model: string
	provider: string
	action: 'chat' | 'compact' | 'image' | 'transcription'
	durationMs: number
	tokens?: {
		prompt?: number
		completion?: number
		total?: number
	}
	messages: unknown[]
	systemPromptText?: string
	requestInputMessages?: unknown[]
	toolCalls?: unknown[]
	toolResults?: unknown[]
	usageRaw?: unknown
	response: string
	/** Optional enriched fields from Phase 8 */
	tenantId?: string
	agentId?: string
	channelId?: string
	cachedPromptTokens?: number
	systemTokens?: number
	conversationTokens?: number
	toolTokens?: number
	providerCostUsd?: number
}

/**
 * Appends a log entry to the SQLite database and returns its ID.
 */
export function logAiRequest(payload: AiLogPayload): number | undefined {
	try {
		// Calculate estimated cost
		let estimatedCostUsd: number | null = null
		let providerCostUsd: number | null = payload.providerCostUsd ?? null
		try {
			if (payload.tokens?.prompt && payload.tokens?.completion) {
				estimatedCostUsd = getEstimatedCost(payload.model, payload.tokens.prompt, payload.tokens.completion)
			}
		} catch { /* pricing may not have this model */ }

		// Prefer provider-reported cost when available; fallback to estimated pricing
		const finalCostUsd = providerCostUsd ?? estimatedCostUsd

		const result = db.prepare(`
            INSERT INTO ai_logs (timestamp, sessionId, model, provider, action, durationMs, promptTokens, completionTokens, totalTokens, requestMessagesJson, systemPromptText, requestInputMessagesJson, toolCallsJson, toolResultsJson, usageJson, response, tenantId, agentId, channelId, cachedPromptTokens, systemTokens, conversationTokens, toolTokens, estimatedCostUsd, providerCostUsd)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			payload.systemPromptText || null,
			payload.requestInputMessages ? JSON.stringify(payload.requestInputMessages) : null,
			payload.toolCalls ? JSON.stringify(payload.toolCalls) : null,
			payload.toolResults ? JSON.stringify(payload.toolResults) : null,
			payload.usageRaw ? JSON.stringify(payload.usageRaw) : null,
			payload.response,
			payload.tenantId || null,
			payload.agentId || null,
			payload.channelId || null,
			payload.cachedPromptTokens || null,
			payload.systemTokens || null,
			payload.conversationTokens || null,
			payload.toolTokens || null,
			finalCostUsd,
			providerCostUsd,
		)

		const aiLogId = result.lastInsertRowid as number

		// Increment rolling 30-day usage summary
		recordUsage({
			model: payload.model,
			promptTokens: payload.tokens?.prompt || 0,
			completionTokens: payload.tokens?.completion || 0,
			estimatedCostUsd: finalCostUsd || 0,
			channelId: payload.channelId,
			tenantId: payload.tenantId,
			agentId: payload.agentId,
		})

		emitLogEvent({
			timestamp: payload.timestamp,
			source: 'ai',
			type: `request_${payload.action}`,
			level: 'info',
			sessionId: payload.sessionId,
			channelId: payload.channelId,
			agentId: payload.agentId,
			tenantId: payload.tenantId,
			aiLogId,
			message: `AI ${payload.action} completed on ${payload.model}`,
			metadata: {
				model: payload.model,
				provider: payload.provider,
				durationMs: payload.durationMs,
				tokens: payload.tokens ?? {},
				estimatedCostUsd: finalCostUsd,
				systemPromptText: payload.systemPromptText ?? null,
				requestInputMessages: payload.requestInputMessages ?? [],
				toolCalls: payload.toolCalls ?? [],
				toolResults: payload.toolResults ?? [],
				response: payload.response,
			},
		})

		return aiLogId
	} catch (err) {
		console.error('⚠️  Failed to write AI request log:', err)
		return undefined
	}
}
