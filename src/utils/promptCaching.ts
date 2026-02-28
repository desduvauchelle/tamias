/**
 * Prompt caching utilities for Tamias.
 *
 * Applies provider-specific cache control to maximize prompt cache hits.
 * Currently supports:
 * - Anthropic (direct + via OpenRouter): explicit cache_control breakpoints
 * - OpenAI/DeepSeek: automatic prefix caching (no code needed, benefits from tier reorder)
 *
 * The system prompt tier reorder in memory.ts ensures static content appears first,
 * enabling automatic prefix caching across all providers.
 */

import type { JSONValue } from '@ai-sdk/provider'

/** A JSON-safe object compatible with the AI SDK's SharedV3ProviderOptions values. */
type JSONObject = { [key: string]: JSONValue | undefined }

export interface CacheAwarePromptConfig {
	/** The full system prompt text */
	systemPrompt: string
	/** The AI provider name */
	provider: string
	/** The model ID being used */
	modelId: string
	/** Session ID for user-based cache scoping */
	sessionId?: string
}

/**
 * Determine if a provider supports explicit cache control directives.
 * Anthropic models (direct or via OpenRouter) support cache_control breakpoints.
 */
export function supportsExplicitCaching(provider: string, modelId: string): boolean {
	if (provider === 'anthropic') return true
	if (provider === 'openrouter' && modelId.startsWith('anthropic/')) return true
	return false
}

/**
 * Build providerOptions for streamText/generateText calls.
 * Adds cache control and user tracking as appropriate for the provider.
 */
export function buildProviderOptions(
	provider: string,
	modelId: string,
	sessionId?: string,
): Record<string, JSONObject> | undefined {
	const opts: Record<string, JSONObject> = {}

	if (provider === 'openrouter') {
		const orOpts: JSONObject = {
			usage: { include: true },
		}
		if (sessionId) {
			orOpts.user = `tamias-${sessionId}`
		}
		opts.openrouter = orOpts
	}

	return Object.keys(opts).length > 0 ? opts : undefined
}
