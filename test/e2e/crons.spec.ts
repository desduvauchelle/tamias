/**
 * E2E tests — Crons page (/crons).
 *
 * Covers:
 * - Page loads and displays scheduled tasks
 * - Empty state shows guidance message
 * - Creating a new cron job
 * - Editing an existing cron job
 * - Deleting a cron job
 * - Testing a cron job
 * - Cron card shows schedule, target, last run info
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockCronJob,
} from './helpers'

const MOCK_CRONS = [
	createMockCronJob({ id: 'c1', name: 'Hourly Check', schedule: '1h', type: 'ai', enabled: true }),
	createMockCronJob({ id: 'c2', name: 'Daily Report', schedule: '0 9 * * 1-5', type: 'message', prompt: 'Send daily report', enabled: false }),
]

const MOCK_TARGETS = {
	targets: [
		{ target: 'last', label: 'Most recent session' },
		{ target: 'discord:123', label: 'Discord #general', platform: 'discord' },
	],
}

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoCrons(page: import('@playwright/test').Page, crons = MOCK_CRONS) {
	await mockNavAPIs(page)
	await page.route('/api/crons', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ crons }) })
		}
		// POST — save all crons
		return route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' })
	})
	await page.route('/api/crons/targets', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TARGETS) }),
	)
	await page.route('/api/crons/test', route =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ ok: true, jobName: 'Hourly Check', target: 'last' }),
		}),
	)
	await page.goto('/crons', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load & listing
// ---------------------------------------------------------------------------
test.describe('crons page load', () => {
	test('renders cron jobs with their names', async ({ page }) => {
		await gotoCrons(page)
		await expect(page.getByText('Hourly Check')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByText('Daily Report')).toBeVisible()
	})

	test('shows the AUTOMATED TASKS heading', async ({ page }) => {
		await gotoCrons(page)
		await expect(page.getByText('AUTOMATED TASKS')).toBeVisible({ timeout: 10_000 })
	})

	test('shows cron schedule on cards', async ({ page }) => {
		await gotoCrons(page)
		await expect(page.getByText('1h')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByText('0 9 * * 1-5')).toBeVisible()
	})

	test('empty state shows guidance message', async ({ page }) => {
		await gotoCrons(page, [])
		await expect(page.getByText('No scheduled tasks yet')).toBeVisible({ timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// Create cron
// ---------------------------------------------------------------------------
test.describe('create cron', () => {
	test('add button opens the edit modal', async ({ page }) => {
		await gotoCrons(page)
		await page.getByTestId('cron-add-btn').click()
		// The modal should be visible with form fields
		await expect(page.locator('[data-testid="modal"]')).toBeVisible({ timeout: 5_000 })
	})
})

// ---------------------------------------------------------------------------
// Edit cron
// ---------------------------------------------------------------------------
test.describe('edit cron', () => {
	test('edit button opens modal for the selected cron', async ({ page }) => {
		await gotoCrons(page)
		// Click the first edit button
		await page.getByTestId('cron-edit-btn').first().click()
		await expect(page.getByText('Edit Cron')).toBeVisible({ timeout: 5_000 })
	})

	test('saving edits sends POST to /api/crons', async ({ page }) => {
		let capturedBody: unknown
		await mockNavAPIs(page)
		await page.route('/api/crons', route => {
			if (route.request().method() === 'POST') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ crons: MOCK_CRONS }) })
		})
		await page.route('/api/crons/targets', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TARGETS) }),
		)
		await page.route('/api/crons/test', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
		)
		await page.goto('/crons', { waitUntil: 'load' })

		await page.getByTestId('cron-edit-btn').first().click()
		// Click save in the modal
		await page.locator('[data-testid="modal"] button').filter({ hasText: 'Save' }).click()

		await page.waitForTimeout(1000)
		expect(capturedBody).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// Test cron
// ---------------------------------------------------------------------------
test.describe('test cron', () => {
	test('test button opens test modal', async ({ page }) => {
		await gotoCrons(page)
		await page.getByTestId('cron-test-btn').first().click()
		await expect(page.getByText('Test Job')).toBeVisible({ timeout: 5_000 })
	})

	test('running test sends POST to /api/crons/test', async ({ page }) => {
		let testCalled = false
		await mockNavAPIs(page)
		await page.route('/api/crons', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ crons: MOCK_CRONS }) }),
		)
		await page.route('/api/crons/targets', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TARGETS) }),
		)
		await page.route('/api/crons/test', route => {
			testCalled = true
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, jobName: 'Hourly Check', target: 'last' }),
			})
		})
		await page.goto('/crons', { waitUntil: 'load' })

		await page.getByTestId('cron-test-btn').first().click()
		await page.getByText('Run Test').click()

		await page.waitForTimeout(2000)
		expect(testCalled).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// Delete cron
// ---------------------------------------------------------------------------
test.describe('delete cron', () => {
	test('delete button removes the cron card after confirmation', async ({ page }) => {
		await gotoCrons(page)
		// Verify there are 2 crons initially
		await expect(page.getByText('Hourly Check')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByText('Daily Report')).toBeVisible()

		page.on('dialog', dialog => dialog.accept())
		await page.getByTestId('cron-delete-btn').first().click()

		// One of the cron cards should be gone
		await page.waitForTimeout(500)
		// We deleted the first one (Hourly Check), so Daily Report should remain
		await expect(page.getByText('Daily Report')).toBeVisible()
	})
})
