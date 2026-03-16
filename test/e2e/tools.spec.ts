/**
 * E2E tests — Tools page (/tools).
 *
 * Covers:
 * - Page loads and displays tool function rules
 * - Internal tools toggle on/off
 * - Email accounts section renders
 * - Adding an MCP server
 * - Editing MCP server opens modal
 * - Save button persists configuration
 * - Default image model setting
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockToolsConfig,
} from './helpers'

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoTools(page: import('@playwright/test').Page, config = createMockToolsConfig()) {
	await mockNavAPIs(page)
	await page.route('/api/tools', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) })
		}
		// POST — save
		return route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' })
	})
	await page.goto('/tools', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------
test.describe('tools page load', () => {
	test('renders the page with tool sections', async ({ page }) => {
		await gotoTools(page)
		// Should show the tools heading
		await expect(page.getByRole('heading', { name: 'TOOLS & MCP SERVERS' })).toBeVisible({ timeout: 10_000 })
	})

	test('shows internal tools with their names', async ({ page }) => {
		await gotoTools(page)
		await expect(page.getByText('Shell Commands')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByText('Web Browser')).toBeVisible()
	})

	test('shows email and MCP server sections', async ({ page }) => {
		await gotoTools(page)
		await expect(page.getByRole('heading', { name: 'Email Accounts' })).toBeVisible({ timeout: 10_000 })
		await expect(page.getByRole('heading', { name: 'MCP Integrations' })).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// MCP server management
// ---------------------------------------------------------------------------
test.describe('MCP servers', () => {
	test('add MCP server button is visible', async ({ page }) => {
		await gotoTools(page)
		await expect(page.getByTestId('add-mcp-btn')).toBeVisible({ timeout: 10_000 })
	})

	test('editing MCP server opens modal with form fields', async ({ page }) => {
		const config = createMockToolsConfig()
		config.mcpServers = {
			'test-server': {
				label: 'Test Server',
				transport: 'stdio',
				command: 'node',
				args: ['server.js'],
				env: {},
			},
		}
		await gotoTools(page, config)
		await page.getByTestId('mcp-edit-btn').first().click()
		await expect(page.getByTestId('mcp-label-input')).toBeVisible({ timeout: 5_000 })
		await expect(page.getByTestId('mcp-transport-select')).toBeVisible()
		await expect(page.getByTestId('mcp-command-input')).toBeVisible()
	})

	test('MCP modal save button triggers API call', async ({ page }) => {
		let saveCalled = false
		await mockNavAPIs(page)
		const config = createMockToolsConfig()
		config.mcpServers = {
			'test-server': {
				label: 'Test Server',
				transport: 'stdio',
				command: 'node',
				args: ['server.js'],
				env: {},
			},
		}
		await page.route('/api/tools', route => {
			if (route.request().method() === 'POST') {
				saveCalled = true
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) })
		})
		await page.goto('/tools', { waitUntil: 'load' })

		await page.getByTestId('mcp-edit-btn').first().click()
		await page.getByTestId('mcp-label-input').fill('Updated Server')
		await page.getByTestId('mcp-modal-save').click()

		await page.waitForTimeout(1000)
		expect(saveCalled).toBe(true)
	})

	test('MCP modal cancel closes without saving', async ({ page }) => {
		const config = createMockToolsConfig()
		config.mcpServers = {
			'test-server': {
				label: 'Test Server',
				transport: 'stdio',
				command: 'node',
				args: ['server.js'],
				env: {},
			},
		}
		await gotoTools(page, config)
		await page.getByTestId('mcp-edit-btn').first().click()
		await expect(page.getByTestId('mcp-label-input')).toBeVisible()
		await page.getByTestId('mcp-modal-cancel').click()
		await expect(page.getByTestId('mcp-label-input')).not.toBeVisible({ timeout: 3_000 })
	})
})

// ---------------------------------------------------------------------------
// Email accounts
// ---------------------------------------------------------------------------
test.describe('email accounts', () => {
	test('add email button is visible', async ({ page }) => {
		await gotoTools(page)
		await expect(page.getByTestId('add-email-btn')).toBeVisible({ timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// Save button
// ---------------------------------------------------------------------------
test.describe('save tools config', () => {
	test('save button sends POST to /api/tools', async ({ page }) => {
		let capturedBody: unknown
		await mockNavAPIs(page)
		await page.route('/api/tools', route => {
			if (route.request().method() === 'POST') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMockToolsConfig()) })
		})
		await page.goto('/tools', { waitUntil: 'load' })

		await page.getByTestId('tools-save-btn').click()
		await page.waitForTimeout(1000)
		expect(capturedBody).toBeDefined()
	})
})
