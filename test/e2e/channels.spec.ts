/**
 * E2E tests — Channels page (/channels).
 *
 * Covers:
 * - Page loads with channel sections (Terminal, Discord, Telegram, WhatsApp)
 * - Terminal toggle works
 * - Adding a Discord instance
 * - Adding a Telegram instance
 * - Adding a WhatsApp instance
 * - Bot card shows token, mode, allowed channels fields
 * - Removing an instance
 * - Save button persists configuration
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockChannelConfig,
} from './helpers'

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoChannels(page: import('@playwright/test').Page, config = createMockChannelConfig()) {
	await mockNavAPIs(page)
	await page.route('/api/channels', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) })
		}
		// POST — save
		return route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' })
	})
	await page.goto('/channels', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------
test.describe('channels page load', () => {
	test('renders the page with sections', async ({ page }) => {
		await gotoChannels(page)
		await expect(page.getByText('COMMUNICATION CHANNELS')).toBeVisible({ timeout: 10_000 })
	})

	test('shows Terminal section', async ({ page }) => {
		await gotoChannels(page)
		await expect(page.getByText('Terminal / Local CLI')).toBeVisible({ timeout: 10_000 })
	})

	test('shows Discord and Telegram section headings', async ({ page }) => {
		await gotoChannels(page)
		await expect(page.getByText('Discord Bots')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByText('Telegram Bots')).toBeVisible()
		await expect(page.getByText('WhatsApp (Personal)')).toBeVisible()
	})

	test('shows existing Discord instance card', async ({ page }) => {
		await gotoChannels(page)
		await expect(page.getByTestId('channel-card-discord-default')).toBeVisible({ timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// Terminal toggle
// ---------------------------------------------------------------------------
test.describe('terminal toggle', () => {
	test('terminal toggle is checked by default', async ({ page }) => {
		await gotoChannels(page)
		await expect(page.getByTestId('channel-toggle-terminal')).toBeChecked()
	})

	test('terminal toggle can be unchecked', async ({ page }) => {
		await gotoChannels(page)
		await page.getByTestId('channel-toggle-terminal').uncheck()
		await expect(page.getByTestId('channel-toggle-terminal')).not.toBeChecked()
	})
})

// ---------------------------------------------------------------------------
// Discord instance
// ---------------------------------------------------------------------------
test.describe('discord instance', () => {
	test('existing discord card has toggle and mode selector', async ({ page }) => {
		await gotoChannels(page)
		await expect(page.getByTestId('channel-toggle-discord-default')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByTestId('channel-mode-discord-default')).toBeVisible()
	})

	test('can change discord reply mode', async ({ page }) => {
		await gotoChannels(page)
		await page.getByTestId('channel-mode-discord-default').selectOption('mention-only')
		await expect(page.getByTestId('channel-mode-discord-default')).toHaveValue('mention-only')
	})

	test('add discord instance button creates a new card', async ({ page }) => {
		await gotoChannels(page)
		// Type instance name and click add
		await page.fill('input[placeholder*="default"]', 'my-bot')
		await page.getByTestId('channel-add-discord').click()
		// New card should appear
		await expect(page.getByTestId('channel-card-discord-my-bot')).toBeVisible({ timeout: 5_000 })
	})

	test('remove button removes the discord instance', async ({ page }) => {
		await gotoChannels(page)
		await page.getByTestId('channel-remove-discord-default').click()
		await expect(page.getByTestId('channel-card-discord-default')).not.toBeVisible({ timeout: 3_000 })
	})
})

// ---------------------------------------------------------------------------
// Telegram instance
// ---------------------------------------------------------------------------
test.describe('telegram instance', () => {
	test('add telegram instance creates a new card', async ({ page }) => {
		const config = createMockChannelConfig()
		await gotoChannels(page, config)
		// Find the telegram "Add" input - it's the one in the Telegram section
		const telegramSection = page.locator('section').filter({ hasText: 'Telegram Bots' })
		await telegramSection.locator('input[type="text"]').fill('tg-bot')
		await page.getByTestId('channel-add-telegram').click()
		await expect(page.getByTestId('channel-card-telegram-tg-bot')).toBeVisible({ timeout: 5_000 })
	})
})

// ---------------------------------------------------------------------------
// WhatsApp instance
// ---------------------------------------------------------------------------
test.describe('whatsapp instance', () => {
	test('add whatsapp instance creates a new card', async ({ page }) => {
		await gotoChannels(page)
		const waSection = page.locator('section').filter({ hasText: 'WhatsApp (Personal)' })
		await waSection.locator('input[type="text"]').fill('personal')
		await page.getByTestId('channel-add-whatsapp-unofficial').click()
		await expect(page.getByTestId('channel-card-whatsapp-personal')).toBeVisible({ timeout: 5_000 })
	})
})

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------
test.describe('save channels', () => {
	test('save button sends POST with bridges config', async ({ page }) => {
		let capturedBody: unknown
		await mockNavAPIs(page)
		await page.route('/api/channels', route => {
			if (route.request().method() === 'POST') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMockChannelConfig()) })
		})
		await page.goto('/channels', { waitUntil: 'load' })

		await page.getByTestId('channels-save-btn').click()
		await page.waitForTimeout(1000)
		expect(capturedBody).toBeDefined()
		expect((capturedBody as Record<string, unknown>).bridges).toBeDefined()
	})
})
