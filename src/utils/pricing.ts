/**
 * Utility to estimate costs based on verified OpenRouter pricing (Feb 2026).
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
	'o3': { input: 2.00, output: 8.00 },
	'o3-mini': { input: 1.10, output: 4.40 },
	'o3-pro': { input: 20.00, output: 80.00 },
	'o4-mini': { input: 1.10, output: 4.40 },
	'gpt-4-turbo': { input: 10.00, output: 30.00 },
	'gpt-4-1': { input: 2.00, output: 8.00 },
	'gpt-4-1-mini': { input: 0.40, output: 1.60 },
	'gpt-4-1-nano': { input: 0.10, output: 0.40 },

	// Anthropic
	'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
	'claude-3-5-haiku': { input: 0.80, output: 4.00 },
	'claude-3-opus': { input: 15.00, output: 75.00 },
	'claude-3-7-sonnet': { input: 3.00, output: 15.00 },
	'claude-sonnet-4': { input: 3.00, output: 15.00 },
	'claude-opus-4': { input: 15.00, output: 75.00 },

	// Google
	'gemini-1-5-pro': { input: 3.50, output: 10.50 },
	'gemini-1-5-flash': { input: 0.075, output: 0.30 },
	'gemini-1-5-flash-8b': { input: 0.0375, output: 0.15 },
	'gemini-2-0-flash': { input: 0.10, output: 0.40 },
	'gemini-2-0-flash-lite': { input: 0.10, output: 0.40 },
	'gemini-2-5-pro': { input: 1.25, output: 10.00 },
	'gemini-2-5-flash': { input: 0.30, output: 2.50 },
	'gemini-2-5-flash-lite': { input: 0.10, output: 0.40 },

	// DeepSeek
	'deepseek-chat': { input: 0.20, output: 0.77 },
	'deepseek-reasoner': { input: 0.55, output: 2.19 },

	// MiniMax
	'minimax-m1': { input: 0.40, output: 2.20 },

	// Moonshot / Kimi
	'kimi-k2': { input: 0.55, output: 2.20 },
}

/**
 * Image generation cost estimates per image.
 * Based on OpenAI published pricing (Feb 2026).
 */
const IMAGE_PRICING: Record<string, Record<string, number>> = {
	'dall-e-3': {
		'1024x1024': 0.04,
		'1024x1792': 0.08,
		'1792x1024': 0.08,
	},
	'dall-e-2': {
		'256x256': 0.016,
		'512x512': 0.018,
		'1024x1024': 0.02,
	},
	'gpt-image-1': {
		'1024x1024': 0.04,
		'1024x1792': 0.08,
		'1792x1024': 0.08,
	},
}

/** Default cost if the image model is unknown */
const DEFAULT_IMAGE_COST = 0.04

export function getImageCost(modelId: string, size?: string): number {
	const baseId = modelId.split('/').pop() || modelId
	const cleanId = baseId.toLowerCase().replace(/\./g, '-')
	const sizeKey = size || '1024x1024'

	const modelPricing = IMAGE_PRICING[cleanId]
		|| Object.entries(IMAGE_PRICING).find(([k]) => cleanId.includes(k))?.[1]

	if (modelPricing) {
		return modelPricing[sizeKey] ?? modelPricing['1024x1024'] ?? DEFAULT_IMAGE_COST
	}

	return DEFAULT_IMAGE_COST
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
			// Catch-all: use mid-tier pricing rather than $0 to avoid hiding real costs
			pricing = { input: 2.00, output: 8.00 }
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
