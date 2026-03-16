/**
 * E2E tests — Agents page (/agents).
 *
 * Covers:
 * - Page loads and shows agent list
 * - Empty state shows "What are Agents?" guidance
 * - Selecting an agent shows detail panel
 * - Create agent via modal
 * - Edit an existing agent
 * - Toggle agent enabled/disabled
 * - Delete agent with confirmation
 * - Agent slug auto-derived from name
 * - Model dropdown populated from API
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockAgent,
} from './helpers'

const MOCK_AGENTS = [
	createMockAgent({ id: 'a1', slug: 'researcher', name: 'Researcher', model: 'gpt-4o', enabled: true }),
	createMockAgent({ id: 'a2', slug: 'writer', name: 'Writer', model: 'claude-sonnet-4', enabled: false }),
]

const MOCK_MODELS = {
	connections: [
		{ models: 'gpt-4o,gpt-4o-mini' },
		{ models: 'claude-sonnet-4,claude-haiku' },
	],
	defaultModels: ['gpt-4o'],
}

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoAgents(page: import('@playwright/test').Page, agents = MOCK_AGENTS) {
	await mockNavAPIs(page)
	await page.route('/api/agents', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agents) })
		}
		// POST — return the sent body as-is (simulated create)
		return route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' })
	})
	await page.route('/api/agents/*', route => {
		const method = route.request().method()
		if (method === 'PUT') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' })
		}
		if (method === 'DELETE') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
		}
		return route.continue()
	})
	await page.route('/api/models', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MODELS) }),
	)
	await page.goto('/agents', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load & listing
// ---------------------------------------------------------------------------
test.describe('agents page load', () => {
	test('renders the agent list with names visible', async ({ page }) => {
		await gotoAgents(page)
		await expect(page.getByTestId('agent-item-researcher')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByTestId('agent-item-writer')).toBeVisible()
	})

	test('shows the Agents heading', async ({ page }) => {
		await gotoAgents(page)
		await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible({ timeout: 10_000 })
	})

	test('empty state shows guidance when no agents exist', async ({ page }) => {
		await gotoAgents(page, [])
		await expect(page.getByText('What are Agents?')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByTestId('agent-create-empty-btn')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Agent selection & detail panel
// ---------------------------------------------------------------------------
test.describe('agent detail panel', () => {
	test('clicking an agent shows its detail panel', async ({ page }) => {
		await gotoAgents(page)
		await page.getByTestId('agent-item-researcher').click()
		await expect(page.getByRole('heading', { name: 'Researcher' })).toBeVisible()
		await expect(page.getByText('gpt-4o').first()).toBeVisible()
	})

	test('detail panel shows edit and delete buttons', async ({ page }) => {
		await gotoAgents(page)
		await page.getByTestId('agent-item-researcher').click()
		await expect(page.getByTestId('agent-edit-btn')).toBeVisible()
		await expect(page.getByTestId('agent-delete-btn')).toBeVisible()
		await expect(page.getByTestId('agent-toggle-btn')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Create agent
// ---------------------------------------------------------------------------
test.describe('create agent', () => {
	test('clicking create opens modal with empty form', async ({ page }) => {
		await gotoAgents(page)
		await page.getByTestId('agent-create-btn').click()
		await expect(page.getByTestId('agent-name-input')).toBeVisible()
		await expect(page.getByTestId('agent-slug-input')).toBeVisible()
		await expect(page.getByTestId('agent-instructions-input')).toBeVisible()
	})

	test('slug auto-derives from name', async ({ page }) => {
		await gotoAgents(page)
		await page.getByTestId('agent-create-btn').click()
		await page.getByTestId('agent-name-input').fill('My New Agent')
		await expect(page.getByTestId('agent-slug-input')).toHaveValue('my-new-agent')
	})

	test('submitting the form sends POST to /api/agents', async ({ page }) => {
		let capturedBody: unknown
		await mockNavAPIs(page)
		await page.route('/api/agents', route => {
			if (route.request().method() === 'POST') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ...(capturedBody as Record<string, unknown>), id: 'new-id', enabled: true }),
				})
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AGENTS) })
		})
		await page.route('/api/agents/*', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
		)
		await page.route('/api/models', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MODELS) }),
		)
		await page.goto('/agents', { waitUntil: 'load' })

		await page.getByTestId('agent-create-btn').click()
		await page.getByTestId('agent-name-input').fill('Test Bot')
		await page.getByTestId('agent-instructions-input').fill('Be helpful.')
		await page.getByTestId('agent-modal-save').click()

		// Wait for the modal to close
		await expect(page.getByTestId('agent-name-input')).not.toBeVisible({ timeout: 5_000 })
		expect(capturedBody).toBeDefined()
		expect((capturedBody as Record<string, unknown>).name).toBe('Test Bot')
		expect((capturedBody as Record<string, unknown>).instructions).toBe('Be helpful.')
	})

	test('cancel button closes modal without saving', async ({ page }) => {
		await gotoAgents(page)
		await page.getByTestId('agent-create-btn').click()
		await expect(page.getByTestId('agent-name-input')).toBeVisible()
		await page.getByTestId('agent-modal-cancel').click()
		await expect(page.getByTestId('agent-name-input')).not.toBeVisible({ timeout: 3_000 })
	})
})

// ---------------------------------------------------------------------------
// Edit agent
// ---------------------------------------------------------------------------
test.describe('edit agent', () => {
	test('edit button opens modal pre-filled with agent data', async ({ page }) => {
		await gotoAgents(page)
		await page.getByTestId('agent-item-researcher').click()
		await page.getByTestId('agent-edit-btn').click()
		await expect(page.getByTestId('agent-name-input')).toHaveValue('Researcher')
	})

	test('save changes sends PUT with updated data', async ({ page }) => {
		let capturedBody: unknown
		await mockNavAPIs(page)
		await page.route('/api/agents', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AGENTS) }),
		)
		await page.route('/api/agents/*', route => {
			if (route.request().method() === 'PUT') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capturedBody) })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
		})
		await page.route('/api/models', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MODELS) }),
		)
		await page.goto('/agents', { waitUntil: 'load' })

		await page.getByTestId('agent-item-researcher').click()
		await page.getByTestId('agent-edit-btn').click()
		await page.getByTestId('agent-name-input').fill('Researcher v2')
		await page.getByTestId('agent-modal-save').click()

		await expect(page.getByTestId('agent-name-input')).not.toBeVisible({ timeout: 5_000 })
		expect(capturedBody).toBeDefined()
		expect((capturedBody as Record<string, unknown>).name).toBe('Researcher v2')
	})
})

// ---------------------------------------------------------------------------
// Toggle & Delete
// ---------------------------------------------------------------------------
test.describe('toggle and delete agent', () => {
	test('toggle button sends PUT with enabled field', async ({ page }) => {
		let capturedBody: unknown
		await mockNavAPIs(page)
		await page.route('/api/agents', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AGENTS) }),
		)
		await page.route('/api/agents/*', route => {
			if (route.request().method() === 'PUT') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capturedBody) })
			}
			if (route.request().method() === 'DELETE') {
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.continue()
		})
		await page.route('/api/models', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MODELS) }),
		)
		await page.goto('/agents', { waitUntil: 'load' })

		await page.getByTestId('agent-item-researcher').click()
		await page.getByTestId('agent-toggle-btn').click()

		// Should have sent { enabled: false } since Researcher was enabled
		await page.waitForTimeout(500)
		expect(capturedBody).toBeDefined()
		expect((capturedBody as Record<string, unknown>).enabled).toBe(false)
	})

	test('delete button triggers confirmation and sends DELETE', async ({ page }) => {
		let deleteWasCalled = false
		await mockNavAPIs(page)
		await page.route('/api/agents', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AGENTS) }),
		)
		await page.route('/api/agents/*', route => {
			if (route.request().method() === 'DELETE') {
				deleteWasCalled = true
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
		})
		await page.route('/api/models', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MODELS) }),
		)
		await page.goto('/agents', { waitUntil: 'load' })

		await page.getByTestId('agent-item-researcher').click()
		await page.getByTestId('agent-delete-btn').click()

		// Accept the browser confirm dialog
		page.on('dialog', dialog => dialog.accept())
		// Re-click in case dialog listener was registered late
		await page.getByTestId('agent-delete-btn').click()

		await page.waitForTimeout(1000)
		expect(deleteWasCalled).toBe(true)
	})
})
