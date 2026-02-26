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
 * Default: 35% of context window, minimum 4000 tokens.
 */
export function getSystemPromptBudget(modelContextWindow: number, ratio = 0.35): number {
	return Math.max(4000, Math.floor(modelContextWindow * ratio))
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
