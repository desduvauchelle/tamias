import { tool, generateText } from 'ai'
import { z } from 'zod'
import type { BrowserContext, Page } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { AIService } from '../services/aiService.ts'
import { TAMIAS_DIR, getApiKeyForConnection, getAllConnections, getFirecrawlConfig } from '../utils/config.ts'

export const WEB_TOOL_NAME = 'web'
export const WEB_TOOL_LABEL = '🌐 Web (browse, click, type, screenshot, search, scrape)'

// ---------------------------------------------------------------------------
// Browser internals (from browser.ts)
// ---------------------------------------------------------------------------

const BROWSER_DATA_DIR = join(TAMIAS_DIR, 'browser-data')
// Playwright is stored in ~/.tamias/node_modules/playwright (installed by install.sh or browser_install tool)
const PLAYWRIGHT_PATH = join(TAMIAS_DIR, 'node_modules', 'playwright')
const PLAYWRIGHT_BIN = join(TAMIAS_DIR, 'node_modules', '.bin', 'playwright')

async function loadPlaywright() {
	try {
		return await import(PLAYWRIGHT_PATH) as typeof import('playwright')
	} catch {
		throw new Error(
			'Playwright is not installed. Ask the AI to run browser_install, or run: tamias browser --setup'
		)
	}
}

let sharedContext: BrowserContext | null = null
let authContext: BrowserContext | null = null

async function getBrowserContext(headless = true): Promise<BrowserContext> {
	if (sharedContext) {
		return sharedContext
	}

	if (!existsSync(BROWSER_DATA_DIR)) {
		mkdirSync(BROWSER_DATA_DIR, { recursive: true })
	}

	const { chromium } = await loadPlaywright()
	sharedContext = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
		headless,
		viewport: { width: 1280, height: 720 },
	})

	return sharedContext
}

async function getActivePage(context: BrowserContext): Promise<Page> {
	const pages = context.pages()
	return pages.length > 0 ? pages[0] : await context.newPage()
}

/**
 * Simplified text-based snapshot of the page for AI processing.
 */
async function getPageSnapshot(page: Page): Promise<string> {
	const snapshot = await page.evaluate(() => {
		const walk = (node: Node): string => {
			if (node.nodeType === Node.TEXT_NODE) {
				return node.textContent?.trim() || ''
			}

			if (node.nodeType !== Node.ELEMENT_NODE) {
				return ''
			}

			const el = node as HTMLElement
			const style = window.getComputedStyle(el)
			if (style.display === 'none' || style.visibility === 'hidden') {
				return ''
			}

			const tagName = el.tagName.toLowerCase()
			const role = el.getAttribute('role')
			const ariaLabel = el.getAttribute('aria-label')
			const text = Array.from(el.childNodes)
				.map(walk)
				.filter(Boolean)
				.join(' ')

			if (tagName === 'a') {
				const href = el.getAttribute('href')
				return `[Link: ${text || el.innerText || ariaLabel || 'unnamed'} (${href || '#'})]`
			}

			if (tagName === 'button') {
				return `[Button: ${text || el.innerText || ariaLabel || 'unnamed'}]`
			}

			if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
				const name = el.getAttribute('name') || el.getAttribute('id') || ''
				const placeholder = el.getAttribute('placeholder') || ''
				const value = (el as HTMLInputElement).value || ''
				return `[Input: ${name} ${placeholder ? `placeholder="${placeholder}"` : ''} value="${value}"]`
			}

			if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
				return `\n${tagName.toUpperCase()}: ${text}\n`
			}

			if (tagName === 'div' || tagName === 'section' || tagName === 'article') {
				return text ? `\n${text}\n` : ''
			}

			return text
		}

		return walk(document.body).replace(/\n\s*\n/g, '\n').trim()
	})

	return `URL: ${page.url()}\nTitle: ${await page.title()}\n\n${snapshot}`
}

export async function getBrowserInstallStatus(): Promise<{ installed: boolean }> {
	try {
		await loadPlaywright()
		return { installed: true }
	} catch {
		return { installed: false }
	}
}

export function isAuthBrowserOpen(): boolean {
	return authContext !== null
}

export async function launchAuthBrowser(url?: string): Promise<{ ok: boolean; message: string }> {
	try {
		if (!existsSync(BROWSER_DATA_DIR)) {
			mkdirSync(BROWSER_DATA_DIR, { recursive: true })
		}
		if (!authContext) {
			const { chromium } = await loadPlaywright()
			authContext = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
				headless: false,
				viewport: { width: 1280, height: 900 },
			})
			authContext.on('close', () => {
				authContext = null
				// Reset shared headless context so it re-reads saved cookies on next use
				if (sharedContext) {
					sharedContext.close().catch(() => { })
					sharedContext = null
				}
			})
		}
		if (url) {
			const pages = authContext.pages()
			const page = pages.length > 0 ? pages[0] : await authContext.newPage()
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
		}
		return { ok: true, message: 'Browser launched. Authenticate in the browser window, then close it or click "Close Browser" when done.' }
	} catch (err) {
		return { ok: false, message: String(err) }
	}
}

export async function closeAuthBrowser(): Promise<{ ok: boolean }> {
	if (authContext) {
		await authContext.close().catch(() => { })
		authContext = null
	}
	// Reset headless context so next tool invocation picks up the saved session
	if (sharedContext) {
		await sharedContext.close().catch(() => { })
		sharedContext = null
	}
	return { ok: true }
}

// ---------------------------------------------------------------------------
// Combined web tools factory
// ---------------------------------------------------------------------------

export function createWebTools(aiService: AIService, sessionId: string) {
	return {
		// -- Browser tools --------------------------------------------------
		browse: tool({
			description: 'Navigate to a URL and return a text-based snapshot of the page.',
			inputSchema: z.object({
				url: z.string().describe('The URL to navigate to.'),
				wait: z.number().default(2000).describe('Milliseconds to wait for the page to load/render.'),
			}),
			execute: async ({ url, wait }) => {
				try {
					const context = await getBrowserContext()
					const page = await getActivePage(context)
					await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
					if (wait > 0) await new Promise(r => setTimeout(r, wait, {}))
					const snapshot = await getPageSnapshot(page)
					return { success: true, url: page.url(), snapshot }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		click: tool({
			description: 'Click on an element on the current page.',
			inputSchema: z.object({
				selector: z.string().describe('CSS selector, text, or ARIA role to click (e.g. "button:has-text(\'Login\')").'),
			}),
			execute: async ({ selector }) => {
				try {
					const context = await getBrowserContext()
					const page = await getActivePage(context)
					await page.click(selector, { timeout: 5000 })
					return { success: true, url: page.url() }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		type: tool({
			description: 'Type text into an input field on the current page.',
			inputSchema: z.object({
				selector: z.string().describe('CSS selector or text for the input field.'),
				text: z.string().describe('The text to type.'),
				pressEnter: z.boolean().optional().default(false).describe('Whether to press Enter after typing.'),
			}),
			execute: async ({ selector, text, pressEnter }) => {
				try {
					const context = await getBrowserContext()
					const page = await getActivePage(context)
					await page.fill(selector, text, { timeout: 5000 })
					if (pressEnter) await page.keyboard.press('Enter')
					return { success: true, url: page.url() }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		press: tool({
			description: 'Simulate a key press (e.g. Enter, Escape, ArrowDown).',
			inputSchema: z.object({
				key: z.string().describe('The key to press.'),
			}),
			execute: async ({ key }) => {
				try {
					const context = await getBrowserContext()
					const page = await getActivePage(context)
					await page.keyboard.press(key)
					return { success: true, url: page.url() }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		screenshot: tool({
			description: 'Capture a screenshot of the current page.',
			inputSchema: z.object({
				fullPage: z.boolean().optional().default(false).describe('Whether to capture the full page.'),
			}),
			execute: async ({ fullPage }) => {
				try {
					const context = await getBrowserContext()
					const page = await getActivePage(context)
					const buffer = await page.screenshot({ fullPage })
					const fileName = `screenshot_${Date.now()}.png`

					const session = aiService.getSession(sessionId)
					if (session) {
						session.emitter.emit('event', {
							type: 'file',
							name: fileName,
							buffer: buffer,
							mimeType: 'image/png'
						})
					}

					return { success: true, fileName }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		fetch: tool({
			description: 'Perform a direct HTTP request (useful for simple scraping or API calls).',
			inputSchema: z.object({
				url: z.string().describe('The URL to fetch.'),
				method: z.string().optional().default('GET').describe('HTTP method.'),
				headers: z.record(z.string(), z.string()).optional().describe('Optional request headers.'),
			}),
			execute: async ({ url, method, headers }) => {
				try {
					const res = await fetch(url, { method, headers: headers as Record<string, string> })
					const text = await res.text()
					return { success: true, status: res.status, content: text.slice(0, 50000) }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		browser_install: tool({
			description:
				'Install the Playwright browser automation library and download Chromium (~150 MB). ' +
				'Call this when any browser tool fails with "Playwright is not installed". Safe to run multiple times.',
			inputSchema: z.object({}),
			execute: async () => {
				try {
					const tamiasDir = TAMIAS_DIR
					const pkgJson = join(tamiasDir, 'package.json')

					// Ensure a package.json exists so `bun add` has somewhere to record the dep
					if (!existsSync(pkgJson)) {
						writeFileSync(pkgJson, JSON.stringify({ name: 'tamias-data', version: '1.0.0', private: true }, null, 2))
					}

					const bunPath =
						Bun.which('bun') ??
						join(homedir(), '.bun', 'bin', 'bun')

					// Step 1: install the playwright npm package into ~/.tamias/node_modules
					const addProc = Bun.spawn([bunPath, 'add', 'playwright', '--cwd', tamiasDir], {
						stdout: 'pipe',
						stderr: 'pipe',
					})
					const addCode = await addProc.exited
					if (addCode !== 0) {
						const err = await new Response(addProc.stderr).text()
						return { success: false, error: 'Failed to install playwright package: ' + err }
					}

					// Step 2: download the Chromium browser binary
					const installProc = Bun.spawn([PLAYWRIGHT_BIN, 'install', 'chromium'], {
						stdout: 'pipe',
						stderr: 'pipe',
					})
					const installCode = await installProc.exited
					if (installCode !== 0) {
						const err = await new Response(installProc.stderr).text()
						return { success: false, error: 'Failed to download Chromium: ' + err }
					}

					return { success: true, message: 'Playwright and Chromium installed. Browser tools are ready.' }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// -- Web search tool (from websearch.ts) ----------------------------
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

		// -- Firecrawl scrape tool (from firecrawl.ts) ----------------------
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
