import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import { getFirecrawlConfig } from '../utils/config.ts'

export const FIRECRAWL_TOOL_NAME = 'firecrawl'
export const FIRECRAWL_TOOL_LABEL = '🔥 Firecrawl Local (scrape via local /v1/scrape API)'

export function createFirecrawlTools(_aiService: AIService, _sessionId: string) {
	return {
		scrape: tool({
			description: 'Scrape a URL using local Firecrawl API and return extracted content.',
			inputSchema: z.object({
				url: z.string().url().describe('The URL to scrape'),
			}),
			execute: async ({ url }: { url: string }) => {
				const firecrawl = getFirecrawlConfig()
				if (!firecrawl.enabled) {
					return {
						success: false,
						error: 'Firecrawl local is disabled. Enable it in config.firecrawl.enabled.',
					}
				}

				const endpoint = `${firecrawl.baseUrl.replace(/\/+$/, '')}/v1/scrape`
				const timeoutMs = firecrawl.timeoutMs
				const controller = new AbortController()
				const timeout = setTimeout(() => controller.abort(), timeoutMs)

				try {
					const response = await fetch(endpoint, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ url }),
						signal: controller.signal,
					})

					const text = await response.text()
					let payload: unknown = null
					try {
						payload = text ? JSON.parse(text) : null
					} catch {
						payload = text
					}

					if (!response.ok) {
						return {
							success: false,
							status: response.status,
							error: `Firecrawl scrape failed: HTTP ${response.status}`,
							details: payload,
							url,
						}
					}

					const markdown =
						typeof payload === 'object' &&
							payload !== null &&
							'data' in payload &&
							typeof (payload as { data?: unknown }).data === 'object' &&
							(payload as { data?: { markdown?: unknown } }).data &&
							typeof (payload as { data: { markdown?: unknown } }).data.markdown === 'string'
							? (payload as { data: { markdown: string } }).data.markdown
							: undefined

					return {
						success: true,
						url,
						endpoint,
						markdown: markdown && markdown.length > 50000 ? `${markdown.slice(0, 50000)}\n\n[... truncated]` : markdown,
						result: payload,
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					return {
						success: false,
						error: `Firecrawl scrape failed: ${message}`,
						url,
						endpoint,
					}
				} finally {
					clearTimeout(timeout)
				}
			},
		}),
	}
}
