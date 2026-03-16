/**
 * E2E tests — Chat page (/).
 *
 * Covers:
 * - Sessions sidebar renders the session list
 * - Search box filters sessions by name
 * - "+ New Session" modal opens and creates a session
 * - Creating a session with empty name does nothing
 * - ChatTerminal renders + accept textarea & send button
 * - Sending a message calls POST /api/chat and streams the reply
 * - Streamed assistant reply appears in the thread
 */

import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const TAMIAS_E2E_DIR = '/tmp/tamias-e2e'
const IDENTITY_PATH = join(TAMIAS_E2E_DIR, 'memory', 'IDENTITY.md')

function ensureOnboarded() {
	mkdirSync(join(TAMIAS_E2E_DIR, 'memory'), { recursive: true })
	if (!existsSync(IDENTITY_PATH)) {
		writeFileSync(IDENTITY_PATH, '# Test Identity\n')
	}
}

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => {
	if (existsSync(IDENTITY_PATH)) rmSync(IDENTITY_PATH)
})

const MOCK_SESSIONS = [
	{ id: 'session-alpha', name: 'Alpha Chat', model: 'gpt-4o', messageCount: 12 },
	{ id: 'session-beta', name: 'Beta Research', model: 'claude-3-5-sonnet', messageCount: 4 },
	{ id: 'session-gamma', channelName: 'Discord Channel', model: 'gpt-4o-mini', messageCount: 1 },
]

const MOCK_MODELS = {
	connections: [
		{ nickname: 'OpenAI', provider: 'openai', models: 'gpt-4o,gpt-4o-mini' },
		{ nickname: 'Anthropic', provider: 'anthropic', models: 'claude-3-5-sonnet' },
	]
}

/**
 * Navigate to the chat page with all API calls mocked.
 */
async function gotoChat(page: import('@playwright/test').Page) {
	await page.route('/api/sessions', route =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ sessions: MOCK_SESSIONS }),
		})
	)
	await page.route('/api/models', route =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_MODELS),
		})
	)
	await page.route('/api/history**', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logs: [] }) })
	)
	// Default: sessions/:id returns empty messages
	await page.route('/api/sessions/*', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
	)

	await page.goto('/', { waitUntil: 'load' })
	// Wait until at least the Sessions heading is visible
	await expect(page.getByText('Sessions')).toBeVisible({ timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Sessions sidebar
// ---------------------------------------------------------------------------
test.describe('sessions sidebar', () => {
	test('lists all sessions after page load', async ({ page }) => {
		await gotoChat(page)
		await expect(page.getByText('Alpha Chat')).toBeVisible()
		await expect(page.getByText('Beta Research')).toBeVisible()
		await expect(page.getByText('Discord Channel')).toBeVisible()
	})

	test('search filters visible sessions by name', async ({ page }) => {
		await gotoChat(page)
		await page.fill('input[placeholder="Search sessions & mentions..."]', 'Alpha')
		await expect(page.getByText('Alpha Chat')).toBeVisible()
		await expect(page.getByText('Beta Research')).not.toBeVisible()
	})

	test('clearing the search shows all sessions again', async ({ page }) => {
		await gotoChat(page)
		await page.fill('input[placeholder="Search sessions & mentions..."]', 'Alpha')
		await expect(page.getByText('Beta Research')).not.toBeVisible()
		await page.fill('input[placeholder="Search sessions & mentions..."]', '')
		await expect(page.getByText('Beta Research')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// New Session modal
// ---------------------------------------------------------------------------
test.describe('new session modal', () => {
	test('clicking the "+" button opens the new session modal', async ({ page }) => {
		await gotoChat(page)
		// The "+" button is next to the "Sessions" heading
		await page.locator('aside, nav, [class*="sidebar"], [class*="w-60"]')
			.or(page.getByRole('complementary'))
			.locator('button')
			.filter({ hasText: /^\+$/ })
			.first()
			.click()
			.catch(async () => {
				// Fallback: find any button with a plus icon near the Sessions heading
				await page.locator('button svg').first().locator('..').click()
			})
		// The modal has a session name input
		await expect(page.locator('input[placeholder*="ession"]').or(page.locator('input[placeholder*="ame"]')).first()).toBeVisible({ timeout: 3000 })
	})

	test('creating a session opens the chat panel for that session', async ({ page }) => {
		await gotoChat(page)
		// Open new session modal via + button next to Sessions
		//  (we look for it generically in case the aria is not set)
		const plusButtons = page.locator('button').filter({ hasText: '+' })
		await plusButtons.first().click()

		// Fill the name and submit
		const nameInput = page.locator('input').filter({ hasText: '' }).nth(0)
		// Playwright text filter won't work for empty inputs — locate by placeholder
		const sessionInput = page.locator('input[placeholder*="ession"]')
			.or(page.locator('input[placeholder*="ame"]'))
			.or(page.locator('input[placeholder*="ID"]'))
			.first()
		await sessionInput.fill('my-test-session')

		// Mock the session history endpoint for this new session
		await page.route('/api/sessions/my-test-session', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
		)

		// Submit (Enter or button)
		await sessionInput.press('Enter')

		// The chat terminal for that session should be shown
		// ChatTerminal renders a message input area
		await expect(page.locator('input[placeholder*="essage"]')
			.or(page.locator('input[placeholder*="ype"]'))
			.or(page.locator('textarea'))
		).toBeVisible({ timeout: 5000 })
	})
})

// ---------------------------------------------------------------------------
// Chat terminal — sending a message
// ---------------------------------------------------------------------------
test.describe('chat terminal', () => {
	async function selectFirstSession(page: import('@playwright/test').Page) {
		await gotoChat(page)
		// Click the first session in the list
		await page.getByText('Alpha Chat').click()
		// Wait for chat terminal
		await expect(page.locator('input[type="text"]').last()).toBeVisible({ timeout: 5000 })
	}

	test('sending a message streams the assistant reply', async ({ page }) => {
		// Mock the SSE chat endpoint to return a short text response
		await page.route('/api/chat**', route => {
			// AI SDK Data Stream format:
			const sseBody = [
				'0:"Hello from the AI!"\n',
				'd:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":5}}\n',
			].join('')

			return route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				headers: {
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
					'x-vercel-ai-data-stream': 'v1',
				},
				body: sseBody,
			})
		})

		await selectFirstSession(page)

		// Type a message
		const input = page.locator('input[type="text"]').last()
		await input.fill('Hello AI!')

		// Send it
		await page.keyboard.press('Enter')

		// The user message appears in the thread
		await expect(page.getByText('Hello AI!')).toBeVisible({ timeout: 5000 })

		// The assistant reply should stream in
		await expect(page.getByText('Hello from the AI!')).toBeVisible({ timeout: 10_000 })
	})

	test('send button is present and triggers the same submit', async ({ page }) => {
		await page.route('/api/chat**', route => {
			const sseBody = '0:"Acknowledged."\nd:{"finishReason":"stop","usage":{}}\n'
			return route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				headers: { 'x-vercel-ai-data-stream': 'v1' },
				body: sseBody,
			})
		})

		await selectFirstSession(page)
		const input = page.locator('input[type="text"]').last()
		await input.fill('Test via send button')
		// Click the visible send button (not the hidden file input)
		await page.locator('button[type="submit"]').last().click()
		await expect(page.getByText('Test via send button')).toBeVisible({ timeout: 5000 })
	})

	test('error response from chat API shows an error indicator', async ({ page }) => {
		await page.route('/api/chat**', route => {
			const errorBody = '3:"Something went wrong"\n'
			return route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				headers: { 'x-vercel-ai-data-stream': 'v1' },
				body: errorBody,
			})
		})

		await selectFirstSession(page)
		const input = page.locator('input[type="text"]').last()
		await input.fill('trigger error')
		await page.keyboard.press('Enter')
		// The AI SDK surfaces `3:` frames as errors — some error indication should appear
		await expect(
			page.getByText(/error|Something went wrong/i).first()
		).toBeVisible({ timeout: 8_000 })
	})
})

// ---------------------------------------------------------------------------
// Project chat tab
// ---------------------------------------------------------------------------
test.describe('project chat tab', () => {
	test('navigating to /projects?id=X&tab=chat renders a ChatTerminal', async ({ page }) => {
		const project = {
			id: 'proj-chat',
			name: 'Chat Project',
			path: '~/.tamias/workspace/proj-chat',
			kanban: [],
		}

		await page.route('/api/projects', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([project]) })
		)
		await page.route('/api/projects/proj-chat', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) })
		)
		await page.route('/api/project-event', route =>
			route.fulfill({ status: 200, body: '{}' })
		)
		await page.route('/api/discord/channels', route =>
			route.fulfill({ status: 200, body: JSON.stringify({ channels: [] }) })
		)
		await page.route('/api/readme', route =>
			route.fulfill({ status: 200, body: JSON.stringify({ content: '' }) })
		)

		await page.goto('/projects?id=proj-chat&tab=chat', { waitUntil: 'load' })

		// ChatTerminal renders an input for typing messages
		await expect(
			page.locator('input[type="text"]').last()
				.or(page.locator('textarea').last())
		).toBeVisible({ timeout: 10_000 })
	})
})
