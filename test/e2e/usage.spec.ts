/**
 * E2E tests — Usage page (/usage).
 *
 * Covers:
 * - Page loads and shows cost statistics
 * - Stat cards display today, yesterday, this week, this month values
 * - Charts render (area chart, pie chart, bar chart)
 * - Handles empty/zero usage data
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockUsageData,
} from './helpers'

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoUsage(page: import('@playwright/test').Page, data = createMockUsageData()) {
	await mockNavAPIs(page)
	await page.route('/api/usage', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }),
	)
	await page.goto('/usage', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------
test.describe('usage page load', () => {
	test('renders the usage page container', async ({ page }) => {
		await gotoUsage(page)
		await expect(page.getByTestId('usage-page')).toBeVisible({ timeout: 10_000 })
	})

	test('shows cost stat cards with dollar values', async ({ page }) => {
		await gotoUsage(page)
		// Today's cost ($1.23)
		await expect(page.getByText('$1.23')).toBeVisible({ timeout: 10_000 })
		// This month ($18.42)
		await expect(page.getByText('$18.42')).toBeVisible()
	})

	test('shows total spend', async ({ page }) => {
		await gotoUsage(page)
		await expect(page.getByText('$42.00')).toBeVisible({ timeout: 10_000 })
	})

	test('renders chart containers', async ({ page }) => {
		await gotoUsage(page)
		// The page should have Recharts containers (check for SVG elements)
		const svgs = page.locator('svg.recharts-surface')
		await expect(svgs.first()).toBeVisible({ timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
test.describe('usage edge cases', () => {
	test('handles zero usage data gracefully', async ({ page }) => {
		const emptyData = {
			today: 0,
			yesterday: 0,
			thisWeek: 0,
			thisMonth: 0,
			total: 0,
			dailySpend: [],
			modelDistribution: [],
			initiatorDistribution: [],
		}
		await gotoUsage(page, emptyData)
		await expect(page.getByTestId('usage-page')).toBeVisible({ timeout: 10_000 })
		// Should show $0.00 values
		await expect(page.getByText('$0.00').first()).toBeVisible()
	})
})
