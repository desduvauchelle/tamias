/**
 * E2E tests — Live Logs page (/live-logs).
 *
 * Covers:
 * - Page loads and shows log output
 * - Refresh button fetches new data
 * - Empty state shows waiting message
 * - Logs displayed in monospace format
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockHistoryLogs,
} from './helpers'

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoLiveLogs(page: import('@playwright/test').Page, data = createMockHistoryLogs()) {
	await mockNavAPIs(page)
	await page.route('/api/history**', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }),
	)
	await page.goto('/live-logs', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------
test.describe('live-logs page load', () => {
	test('renders the live-logs container', async ({ page }) => {
		await gotoLiveLogs(page)
		await expect(page.getByTestId('live-logs-page')).toBeVisible({ timeout: 10_000 })
	})

	test('shows log entries in formatted output', async ({ page }) => {
		await gotoLiveLogs(page)
		// Logs should show session IDs and model names
		await expect(page.getByText('session-abc')).toBeVisible({ timeout: 10_000 })
	})

	test('empty state shows waiting message', async ({ page }) => {
		await gotoLiveLogs(page, { logs: [] })
		await expect(page.getByTestId('live-logs-page')).toBeVisible({ timeout: 10_000 })
		// Should show some "waiting" or "no activity" text
		await expect(page.getByText(/waiting|no.*activity|loading/i)).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------
test.describe('live-logs refresh', () => {
	test('refresh button is visible', async ({ page }) => {
		await gotoLiveLogs(page)
		await expect(page.getByTestId('live-logs-refresh-btn')).toBeVisible({ timeout: 10_000 })
	})

	test('clicking refresh fetches new data', async ({ page }) => {
		let fetchCount = 0
		await mockNavAPIs(page)
		await page.route('/api/history**', route => {
			fetchCount++
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(createMockHistoryLogs()),
			})
		})
		await page.goto('/live-logs', { waitUntil: 'load' })
		const initialFetches = fetchCount

		await page.getByTestId('live-logs-refresh-btn').click()
		await page.waitForTimeout(1000)
		expect(fetchCount).toBeGreaterThan(initialFetches)
	})
})
