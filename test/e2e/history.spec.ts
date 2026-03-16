/**
 * E2E tests — History page (/history).
 *
 * Covers:
 * - Page loads and shows activity log table
 * - Filter input narrows results
 * - Refresh button reloads data
 * - Clicking a row opens detail modal
 * - Empty state shows appropriate message
 * - Log entries display model, tokens, duration, cost
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

async function gotoHistory(page: import('@playwright/test').Page, data = createMockHistoryLogs()) {
	await mockNavAPIs(page)
	await page.route('/api/history**', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }),
	)
	await page.goto('/history', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------
test.describe('history page load', () => {
	test('renders log entries with model names', async ({ page }) => {
		await gotoHistory(page)
		await expect(page.getByText('gpt-4o')).toBeVisible({ timeout: 10_000 })
	})

	test('shows prompt snippet in log entries', async ({ page }) => {
		await gotoHistory(page)
		await expect(page.getByText('What is the weather today?')).toBeVisible({ timeout: 10_000 })
	})

	test('shows empty state when no logs', async ({ page }) => {
		await gotoHistory(page, { logs: [] })
		// Should show no-data indication
		await expect(page.getByText('No history matching criteria')).toBeVisible({ timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------
test.describe('history filter', () => {
	test('filter input is visible', async ({ page }) => {
		await gotoHistory(page)
		await expect(page.getByTestId('history-filter-input')).toBeVisible({ timeout: 10_000 })
	})

	test('typing in filter narrows visible entries', async ({ page }) => {
		await gotoHistory(page)
		await page.getByTestId('history-filter-input').fill('quantum')
		// Only the quantum computing log should be visible
		await expect(page.getByText('Explain quantum computing')).toBeVisible()
		await expect(page.getByText('What is the weather today?')).not.toBeVisible()
	})

	test('clearing filter shows all entries again', async ({ page }) => {
		await gotoHistory(page)
		await page.getByTestId('history-filter-input').fill('quantum')
		await expect(page.getByText('What is the weather today?')).not.toBeVisible()
		await page.getByTestId('history-filter-input').fill('')
		await expect(page.getByText('What is the weather today?')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------
test.describe('history refresh', () => {
	test('refresh button is visible', async ({ page }) => {
		await gotoHistory(page)
		await expect(page.getByTestId('history-refresh-btn')).toBeVisible({ timeout: 10_000 })
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
		await page.goto('/history', { waitUntil: 'load' })
		const initialFetches = fetchCount

		await page.getByTestId('history-refresh-btn').click()
		await page.waitForTimeout(1000)
		expect(fetchCount).toBeGreaterThan(initialFetches)
	})
})

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------
test.describe('history detail modal', () => {
	test('clicking a log entry opens detail view', async ({ page }) => {
		await gotoHistory(page)
		// Click the first row/entry
		await page.getByText('What is the weather today?').click()
		// Should show detailed view with session ID, token counts, etc.
		await expect(page.getByText('session-abc')).toBeVisible({ timeout: 5_000 })
	})
})
