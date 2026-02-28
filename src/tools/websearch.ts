import { tool } from 'ai'
import { z } from 'zod'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { loadConfig, getApiKeyForConnection, getAllConnections } from '../utils/config.ts'
import type { AIService } from '../services/aiService.ts'

export const WEBSEARCH_TOOL_NAME = 'websearch'
export const WEBSEARCH_TOOL_LABEL = '🔍 Web Search (on-demand web queries via OpenRouter)'

export function createWebsearchTools(aiService: AIService, sessionId: string) {
	return {
		search: tool({
			description: 'Search the web for current information. Use this when you need up-to-date facts, news, documentation, or any information that may not be in your training data. Returns web-grounded results.',
			inputSchema: z.object({
				query: z.string().describe('The search query — be specific and descriptive for best results'),
			}),
			execute: async ({ query }: { query: string }) => {
				try {
					// Find an OpenRouter connection to use for web search
					const connections = getAllConnections()
					const orConn = connections.find(c => c.provider === 'openrouter')

					if (!orConn) {
						return {
							success: false,
							error: 'No OpenRouter connection configured. Web search requires an OpenRouter provider. Add one with `tamias config`.',
						}
					}

					const apiKey = getApiKeyForConnection(orConn.nickname)
					if (!apiKey) {
						return {
							success: false,
							error: `No API key found for OpenRouter connection '${orConn.nickname}'.`,
						}
					}

					// Pick a fast, cheap model for the search — prefer flash/mini models if available
					const cheapKeywords = ['flash', 'mini', 'haiku', 'small', 'lite', 'nano']
					const availableModels = orConn.selectedModels ?? []
					const cheapModel = availableModels.find(m =>
						cheapKeywords.some(k => m.toLowerCase().includes(k))
					) ?? availableModels[0] ?? 'google/gemini-2.0-flash-001'

					// Use :online suffix to enable OpenRouter web grounding
					const openrouter = createOpenRouter({ apiKey })
					const model = openrouter(`${cheapModel}:online`)

					const { text, usage } = await generateText({
						model,
						system: 'You are a web search assistant. Search the web and return factual, well-sourced results for the query. Be concise but thorough. Include relevant URLs when available.',
						prompt: query,
						headers: {
							'X-Title': 'Tamias (websearch)',
							'X-Tamias-Source': 'from-websearch',
						},
					})

					const truncated = text.length > 15000 ? text.slice(0, 15000) + '\n\n[... truncated — results exceeded 15,000 chars]' : text

					return {
						success: true,
						query,
						results: truncated,
						model: cheapModel,
						tokens: usage?.totalTokens,
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err)
					return {
						success: false,
						error: `Web search failed: ${message}`,
						query,
					}
				}
			},
		}),
	}
}
