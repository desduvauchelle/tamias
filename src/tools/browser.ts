import { tool } from 'ai'
import { z } from 'zod'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync } from 'fs'
import type { AIService } from '../services/aiService'
import { TAMIAS_DIR } from '../utils/config'

export const BROWSER_TOOL_NAME = 'browser'
export const BROWSER_TOOL_LABEL = '🌐 Browser (scrape, click, type, screenshot)'
const BROWSER_DATA_DIR = join(TAMIAS_DIR, 'browser-data')

let sharedContext: BrowserContext | null = null

async function getBrowserContext(headless = true): Promise<BrowserContext> {
	if (sharedContext) {
		return sharedContext
	}

	if (!existsSync(BROWSER_DATA_DIR)) {
		mkdirSync(BROWSER_DATA_DIR, { recursive: true })
	}

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

export function createBrowserTools(aiService: AIService, sessionId: string) {
	return {
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
	}
}
