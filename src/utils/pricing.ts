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
	'o1-pro': { input: 150.00, output: 600.00 },
	'o3': { input: 2.00, output: 8.00 },
	'o3-pro': { input: 20.00, output: 80.00 },
	'gpt-4-turbo': { input: 10.00, output: 30.00 },

	// Anthropic
	'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
	'claude-3-5-haiku': { input: 1.00, output: 5.00 },
	'claude-3-opus': { input: 15.00, output: 75.00 },
	'claude-3-7-sonnet': { input: 3.00, output: 15.00 },
	'claude-4-5-sonnet': { input: 6.00, output: 22.50 },
	'claude-4-5-haiku': { input: 1.00, output: 5.00 },
	'claude-4-5-opus': { input: 10.00, output: 37.50 },
	'claude-4-6-sonnet': { input: 6.00, output: 22.50 },
	'claude-4-6-opus': { input: 10.00, output: 37.50 },

	// Google
	'gemini-1.5-pro': { input: 3.50, output: 10.50 },
	'gemini-1.5-flash': { input: 0.075, output: 0.30 },
	'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
	'gemini-2.0-flash': { input: 0.10, output: 0.40 },
	'gemini-2.0-flash-lite': { input: 0.10, output: 0.40 },
	'gemini-2.5-pro': { input: 2.50, output: 15.00 },
	'gemini-2.5-flash': { input: 0.30, output: 2.50 },
	'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
	'gemini-3.0-pro': { input: 4.00, output: 18.00 },
	'gemini-3.0-flash': { input: 0.50, output: 3.00 },
	'gemini-3.1-pro': { input: 4.00, output: 18.00 },
	'gemini-3.1-flash': { input: 0.50, output: 3.00 },

	// DeepSeek
	'deepseek-chat': { input: 0.28, output: 0.42 },
	'deepseek-reasoner': { input: 0.55, output: 2.19 },

	// Generic/Future fallbacks
	'gpt-5-mini': { input: 0.15, output: 0.60 },
	'gpt-5': { input: 2.50, output: 10.00 },
}

export function getEstimatedCost(modelId: string, inputTokens: number, outputTokens: number): number {
	// 1. Clean ID (remove provider prefix)
	const baseId = modelId.split('/').pop() || modelId
	// 2. Normalize (lowercase, dots to dashes)
	const cleanId = baseId.toLowerCase().replace(/\./g, '-')

	// Exact match or partial match
	let pricing = PRICING[cleanId]
	if (!pricing) {
		const key = Object.keys(PRICING).find(k => cleanId.includes(k) || k.includes(cleanId))
		if (key) pricing = PRICING[key]
	}

	if (!pricing) {
		// Heuristic fallbacks for unknown models based on name
		if (cleanId.includes('mini') || cleanId.includes('flash') || cleanId.includes('haiku') || cleanId.includes('8b')) {
			pricing = { input: 0.20, output: 0.80 } // Slightly bumped cheap tier fallback
		} else if (cleanId.includes('pro') || cleanId.includes('sonnet') || cleanId.includes('70b') || cleanId.includes('gpt-4')) {
			pricing = { input: 5.00, output: 20.00 } // Bumped mid tier fallback
		} else if (cleanId.includes('opus') || cleanId.includes('large') || cleanId.includes('o1') || cleanId.includes('o3')) {
			pricing = { input: 20.00, output: 80.00 } // Bumped expensive tier fallback
		} else {
			// Catch-all
			return 0
		}
	}

	const inputCost = (inputTokens / 1_000_000) * pricing.input
	const outputCost = (outputTokens / 1_000_000) * pricing.output

	return inputCost + outputCost
}

export function formatCurrency(amount: number): string {
	if (amount > 0 && amount < 0.000001) {
		return '<$0.000001'
	}
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 6,
	}).format(amount)
}
