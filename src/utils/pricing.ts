/**
 * Simple utility to estimate costs based on public pricing (Feb 2026).
 * Prices are per 1M tokens.
 */

export interface ModelPricing {
	input: number  // USD per 1M tokens
	output: number // USD per 1M tokens
}

const PRICING: Record<string, ModelPricing> = {
	// OpenAI
	'gpt-4o': { input: 2.50, output: 10.00 },
	'gpt-4o-2024-08-06': { input: 2.50, output: 10.00 },
	'gpt-4o-mini': { input: 0.15, output: 0.60 },
	'o1': { input: 15.00, output: 60.00 },
	'o1-mini': { input: 3.00, output: 12.00 },
	'gpt-4-turbo': { input: 10.00, output: 30.00 },

	// Anthropic
	'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
	'claude-3-5-haiku': { input: 1.00, output: 5.00 },
	'claude-3-opus': { input: 15.00, output: 75.00 },

	// Google
	'gemini-1.5-pro': { input: 3.50, output: 10.50 },
	'gemini-1.5-flash': { input: 0.075, output: 0.30 },

	// DeepSeek (Approximation)
	'deepseek-chat': { input: 0.14, output: 0.28 },
	'deepseek-reasoner': { input: 0.55, output: 2.19 },
}

export function getEstimatedCost(modelId: string, inputTokens: number, outputTokens: number): number {
	// Try to find a match by cleaning the modelId (e.g., removing provider prefix)
	const cleanId = modelId.split('/').pop() || modelId

	// Exact match or partial match
	let pricing = PRICING[cleanId]
	if (!pricing) {
		const key = Object.keys(PRICING).find(k => cleanId.includes(k))
		if (key) pricing = PRICING[key]
	}

	if (!pricing) {
		// Default to something reasonable if unknown - maybe gpt-4o prices as a safe high-ish baseline?
		// Or 0 to avoid misleading high numbers? Let's use 0 to be conservative.
		return 0
	}

	const inputCost = (inputTokens / 1_000_000) * pricing.input
	const outputCost = (outputTokens / 1_000_000) * pricing.output

	return inputCost + outputCost
}

export function formatCurrency(amount: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 4,
	}).format(amount)
}
