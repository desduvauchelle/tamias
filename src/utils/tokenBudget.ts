/**
 * Token budget manager for Tamias.
 *
 * Structure-first approach: the system prompt is as long as it needs to be.
 * Trimming only applies when approaching the model's safe context limit.
 *
 * Uses a heuristic of chars/3.5 for token estimation (conservative).
 */

export interface ContextTier {
	name: string
	content: string
	/** Priority (lower = more important, never trimmed first) */
	priority: number
	/** Can this tier be trimmed? */
	trimmable: boolean
	/** If trimmable, what's the minimum content to keep? */
	minContent?: string
}

export interface TokenBudgetResult {
	/** Assembled system prompt text */
	systemPrompt: string
	/** Estimated total tokens */
	estimatedTokens: number
	/** Per-tier breakdown */
	tiers: Array<{ name: string; estimatedTokens: number; trimmed: boolean }>
	/** Whether any tier was trimmed */
	wasTrimmed: boolean
}

/** Estimate tokens from text using chars/3.5 heuristic */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 3.5)
}

/**
 * Assemble a system prompt from ordered tiers, trimming lower-priority
 * tiers only when the total exceeds the budget.
 *
 * @param tiers - Ordered context tiers (lower priority number = higher importance)
 * @param maxSystemTokens - Maximum token budget for the system prompt
 */
export function assembleSystemPrompt(
	tiers: ContextTier[],
	maxSystemTokens: number,
): TokenBudgetResult {
	// Sort by priority (most important first)
	const sorted = [...tiers].sort((a, b) => a.priority - b.priority)

	let totalTokens = 0
	const tierResults: TokenBudgetResult['tiers'] = []
	const includedSections: string[] = []

	// First pass: include everything
	for (const tier of sorted) {
		if (!tier.content.trim()) {
			tierResults.push({ name: tier.name, estimatedTokens: 0, trimmed: false })
			continue
		}
		const tokens = estimateTokens(tier.content)
		totalTokens += tokens
		tierResults.push({ name: tier.name, estimatedTokens: tokens, trimmed: false })
		includedSections.push(tier.content)
	}

	// If within budget, return everything
	if (totalTokens <= maxSystemTokens) {
		return {
			systemPrompt: includedSections.join('\n\n---\n\n'),
			estimatedTokens: totalTokens,
			tiers: tierResults,
			wasTrimmed: false,
		}
	}

	// Second pass: trim from lowest priority upward
	// Rebuild from sorted tiers, trimming/dropping the least important first
	const reversedPriority = [...sorted].reverse() // lowest priority first
	let tokensToShed = totalTokens - maxSystemTokens

	for (const tier of reversedPriority) {
		if (tokensToShed <= 0) break
		if (!tier.trimmable) continue

		const tierResult = tierResults.find(t => t.name === tier.name)
		if (!tierResult) continue

		if (tier.minContent) {
			// Replace with minimal version
			const minTokens = estimateTokens(tier.minContent)
			const saved = tierResult.estimatedTokens - minTokens
			if (saved > 0) {
				tokensToShed -= saved
				tier.content = tier.minContent
				tierResult.estimatedTokens = minTokens
				tierResult.trimmed = true
			}
		} else {
			// Drop entirely
			tokensToShed -= tierResult.estimatedTokens
			tier.content = ''
			tierResult.estimatedTokens = 0
			tierResult.trimmed = true
		}
	}

	// Rebuild the final prompt from the (possibly trimmed) tiers
	const finalSections = sorted
		.filter(t => t.content.trim())
		.map(t => t.content)

	const finalTokens = tierResults.reduce((sum, t) => sum + t.estimatedTokens, 0)

	return {
		systemPrompt: finalSections.join('\n\n---\n\n'),
		estimatedTokens: finalTokens,
		tiers: tierResults,
		wasTrimmed: true,
	}
}

/**
 * Calculate the max system prompt token budget based on model context window.
 * Default: 30% of context window, minimum 4000 tokens.
 */
export function getSystemPromptBudget(modelContextWindow: number, ratio = 0.30): number {
	return Math.max(4000, Math.floor(modelContextWindow * ratio))
}

// ─── Message-level token utilities ────────────────────────────────────────────

export interface CoreMessageLike {
	role: string
	content: unknown
}

export interface TrimResult {
	/** Messages kept (newest first ordering preserved) */
	kept: CoreMessageLike[]
	/** Number of messages dropped */
	dropped: number
	/** Estimated tokens of the kept messages */
	estimatedTokens: number
}

/**
 * Estimate the total token count of an array of chat messages.
 * Stringifies each message's content and sums the per-message estimates.
 */
export function estimateMessageTokens(messages: CoreMessageLike[]): number {
	let total = 0
	for (const msg of messages) {
		const text = typeof msg.content === 'string'
			? msg.content
			: JSON.stringify(msg.content ?? '')
		// Add ~4 tokens overhead per message for role/framing
		total += estimateTokens(text) + 4
	}
	return total
}

/**
 * Calculate the token budget available for chat messages.
 *
 * Returns the lesser of:
 *   contextWindow × messageRatio
 *   contextWindow − systemPromptTokens − responseReserve
 *
 * This ensures messages never overflow even when the system prompt is large.
 */
export function getMessageTokenBudget(
	contextWindow: number,
	systemPromptTokens: number,
	responseReserve: number,
	messageRatio = 0.30,
): number {
	const ratioBudget = Math.floor(contextWindow * messageRatio)
	const remainderBudget = contextWindow - systemPromptTokens - responseReserve
	return Math.max(0, Math.min(ratioBudget, remainderBudget))
}

/**
 * Trim messages to fit within a token budget.
 *
 * Drops messages from the OLDEST end first, always keeping at least the
 * last `minKeep` messages (default 2) so the model has recent context.
 */
export function trimMessagesToTokenBudget(
	messages: CoreMessageLike[],
	maxTokens: number,
	minKeep = 2,
): TrimResult {
	if (messages.length === 0) {
		return { kept: [], dropped: 0, estimatedTokens: 0 }
	}

	// Always keep at least minKeep messages regardless of budget
	const guaranteed = Math.min(minKeep, messages.length)

	// Walk from newest to oldest, accumulating tokens
	let tokens = 0
	let keepFrom = messages.length // will move backward

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		const text = typeof msg.content === 'string'
			? msg.content
			: JSON.stringify(msg.content ?? '')
		const msgTokens = estimateTokens(text) + 4

		if (tokens + msgTokens > maxTokens && (messages.length - i) > guaranteed) {
			break
		}
		tokens += msgTokens
		keepFrom = i
	}

	// Ensure we always keep at least `guaranteed` messages
	const maxKeepFrom = messages.length - guaranteed
	if (keepFrom > maxKeepFrom) {
		keepFrom = maxKeepFrom
		// Recalculate tokens for the guaranteed set
		tokens = 0
		for (let i = keepFrom; i < messages.length; i++) {
			const text = typeof messages[i].content === 'string'
				? messages[i].content as string
				: JSON.stringify(messages[i].content ?? '')
			tokens += estimateTokens(text) + 4
		}
	}

	const kept = messages.slice(keepFrom)
	return {
		kept,
		dropped: keepFrom,
		estimatedTokens: tokens,
	}
}

/**
 * Get a debug summary of the token budget breakdown.
 */
export function formatTokenBudgetDebug(result: TokenBudgetResult): string {
	const lines = [`[context] Total: ~${result.estimatedTokens} tokens${result.wasTrimmed ? ' (TRIMMED)' : ''}`]
	for (const tier of result.tiers) {
		const badge = tier.trimmed ? ' [trimmed]' : ''
		if (tier.estimatedTokens > 0) {
			lines.push(`  ${tier.name}: ~${tier.estimatedTokens}${badge}`)
		}
	}
	return lines.join('\n')
}
