/**
 * E2E tests — Models page (/models).
 *
 * Covers:
 * - Page loads and lists provider connections
 * - Clicking a connection opens the edit modal
 * - Edit modal shows provider, nickname, API key fields
 * - Saving a connection persists changes
 * - Deleting a connection
 * - Cancel closes modal without saving
 * - Selected models displayed as badges
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockModelsConfig,
} from './helpers'

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoModels(page: import('@playwright/test').Page, config = createMockModelsConfig()) {
	await mockNavAPIs(page)
	await page.route('/api/models', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) })
		}
		// POST — save
		return route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' })
	})
	// Mock OpenRouter API
	await page.route('https://openrouter.ai/api/v1/models', route =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ data: [{ id: 'openrouter/model-1', name: 'Model 1' }] }),
		}),
	)
	await page.goto('/models', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------
test.describe('models page load', () => {
	test('renders the page with connection cards', async ({ page }) => {
		await gotoModels(page)
		await expect(page.getByTestId('connection-row-openai-main')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByTestId('connection-row-anthropic-main')).toBeVisible()
	})

	test('shows provider labels on connections', async ({ page }) => {
		await gotoModels(page)
		await expect(page.getByTestId('connection-row-openai-main')).toBeVisible({ timeout: 10_000 })
		// Provider label should be within the connection row
		await expect(page.getByTestId('connection-row-openai-main').getByText('OpenAI', { exact: true })).toBeVisible()
	})

	test('shows model count badge on connections', async ({ page }) => {
		await gotoModels(page)
		await expect(page.getByTestId('connection-row-openai-main')).toBeVisible({ timeout: 10_000 })
		// Should show model count badge
		await expect(page.getByTestId('connection-row-openai-main').getByText('2 models')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Edit connection modal
// ---------------------------------------------------------------------------
test.describe('edit connection modal', () => {
	test('clicking a connection opens the edit modal', async ({ page }) => {
		await gotoModels(page)
		await page.getByTestId('connection-row-openai-main').click()
		await expect(page.getByTestId('edit-connection-modal')).toBeVisible({ timeout: 5_000 })
	})

	test('modal shows save and cancel buttons', async ({ page }) => {
		await gotoModels(page)
		await page.getByTestId('connection-row-openai-main').click()
		await expect(page.getByTestId('connection-save-btn')).toBeVisible({ timeout: 5_000 })
		await expect(page.getByTestId('connection-cancel-btn')).toBeVisible()
	})

	test('cancel closes the modal', async ({ page }) => {
		await gotoModels(page)
		await page.getByTestId('connection-row-openai-main').click()
		await expect(page.getByTestId('edit-connection-modal')).toBeVisible({ timeout: 5_000 })
		await page.getByTestId('connection-cancel-btn').click()
		await expect(page.getByTestId('edit-connection-modal')).not.toBeVisible({ timeout: 3_000 })
	})

	test('save sends POST to /api/models', async ({ page }) => {
		let saveCalled = false
		await mockNavAPIs(page)
		await page.route('/api/models', route => {
			if (route.request().method() === 'POST') {
				saveCalled = true
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMockModelsConfig()) })
		})
		await page.route('https://openrouter.ai/api/v1/models', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
		)
		await page.goto('/models', { waitUntil: 'load' })

		await page.getByTestId('connection-row-openai-main').click()
		await expect(page.getByTestId('edit-connection-modal')).toBeVisible({ timeout: 5_000 })
		await page.getByTestId('connection-save-btn').click()

		await page.waitForTimeout(1000)
		expect(saveCalled).toBe(true)
	})

	test('delete button removes the connection from UI', async ({ page }) => {
		await gotoModels(page)
		await expect(page.getByTestId('connection-row-openai-main')).toBeVisible({ timeout: 10_000 })

		await page.getByTestId('connection-row-openai-main').click()
		await expect(page.getByTestId('edit-connection-modal')).toBeVisible({ timeout: 5_000 })

		await page.getByTestId('connection-delete-btn').click()

		// The connection row should disappear from the page
		await expect(page.getByTestId('connection-row-openai-main')).not.toBeVisible({ timeout: 5_000 })
	})
})
