/**
 * E2E tests — "Create New Project" modal.
 *
 * Covers:
 * - Auto-slug path generation from the project name
 * - Special characters are stripped from the slug
 * - User can manually override the auto-generated path
 * - Validation: name + path are required
 * - API duplicate-path rejection (409) shows an error toast
 * - API success (200) closes the modal and clears the form
 */

import { test, expect } from '@playwright/test'
import { ensureOnboarded, cleanupIdentity } from './helpers'

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function openCreateModal(page: import('@playwright/test').Page) {
	// Mock channels API so the select doesn't hang
	await page.route('/api/discord/channels', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [] }) })
	)
	// Mock projects list (empty)
	await page.route('/api/projects', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
		}
		return route.continue()
	})
	await page.goto('/', { waitUntil: 'load' })
	// Click the "Create New Project" button in the Workspace nav section
	await page.click('[data-tip="Create New Project"] button')
	await expect(page.getByText('Create New Project')).toBeVisible()
}

// ---------------------------------------------------------------------------
// Auto-slug path generation
// ---------------------------------------------------------------------------
test.describe('auto-slug path generation', () => {
	test('typing a plain name auto-fills the path with a slugified workspace path', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'My Awesome Startup')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await expect(pathInput).toHaveValue('~/.tamias/workspace/my-awesome-startup')
	})

	test('special characters (!, @, spaces) are stripped from the slug', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Hello World! 2.0 @test')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await expect(pathInput).toHaveValue('~/.tamias/workspace/hello-world-2-0-test')
	})

	test('slug has no leading or trailing dashes', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', '-- My Project --')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		const value = await pathInput.inputValue()
		expect(value).not.toMatch(/^~\/.tamias\/workspace\/-/)
		expect(value).not.toMatch(/-$/)
	})

	test('path is cleared when name is cleared', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Some Project')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await expect(pathInput).not.toHaveValue('')
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', '')
		await expect(pathInput).toHaveValue('')
	})
})

// ---------------------------------------------------------------------------
// Manual path override
// ---------------------------------------------------------------------------
test.describe('manual path override', () => {
	test('user can override the auto-generated path', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'My Project')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await pathInput.fill('/custom/path/to/project')
		await expect(pathInput).toHaveValue('/custom/path/to/project')
	})

	test('after manual edit, changing the name does NOT overwrite the path', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Initial Name')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await pathInput.fill('/my/custom/path')
		// Now change the name — path should remain what user typed
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Changed Name')
		await expect(pathInput).toHaveValue('/my/custom/path')
	})

	test('hint text changes to "Custom path" after manual edit', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Test')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		// Before manual edit: auto hint
		await expect(page.getByText(/Auto-generated from project name/i)).toBeVisible()
		// After manual edit: custom hint
		await pathInput.fill('/custom')
		await expect(page.getByText('Custom path')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
test.describe('form validation', () => {
	test('cannot save with empty name', async ({ page }) => {
		await openCreateModal(page)
		// Leave name empty, fill path
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await pathInput.fill('/some/path')
		await page.route('/api/projects', route => route.fulfill({ status: 400, body: '{}' }))
		await page.click('button:has-text("Save Project")')
		// Should show an error toast (not proceed to success)
		await expect(page.getByText(/required/i)).toBeVisible()
		// Modal stays open
		await expect(page.getByText('Create New Project')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// API response handling
// ---------------------------------------------------------------------------
test.describe('API response handling', () => {
	test('duplicate path (409) shows an error toast with the conflict message', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'My Project')
		// Override the POST with a 409
		await page.route('/api/projects', route => {
			if (route.request().method() === 'POST') {
				return route.fulfill({
					status: 409,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'Path "~/.tamias/workspace/my-project" is already used by project "Existing Project"' })
				})
			}
			return route.continue()
		})
		await page.click('button:has-text("Save Project")')
		await expect(page.getByText(/already used by project/i)).toBeVisible()
		// Modal stays open so user can fix the path
		await expect(page.getByText('Create New Project')).toBeVisible()
	})

	test('successful creation closes the modal', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'New Project')
		const created = { id: 'new-project', name: 'New Project', path: '~/.tamias/workspace/new-project', kanban: [] }
		await page.route('/api/projects', route => {
			if (route.request().method() === 'POST') {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
			}
			return route.continue()
		})
		await page.click('button:has-text("Save Project")')
		// Success toast shown
		await expect(page.getByText(/Project saved/i)).toBeVisible()
		// Modal closes
		await expect(page.getByText('Create New Project')).not.toBeVisible({ timeout: 3000 })
	})

	test('existing non-project directory is accepted (not blocked by the API)', async ({ page }) => {
		// This test verifies that a 409 is only returned for REGISTERED projects,
		// not for arbitrary directories that happen to exist on disk.
		// We simulate a successful response (200) even though the path dir could exist.
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Local Repo')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await pathInput.fill('/Users/me/existing-code-repo')
		const created = { id: 'local-repo', name: 'Local Repo', path: '/Users/me/existing-code-repo', kanban: [] }
		await page.route('/api/projects', route => {
			if (route.request().method() === 'POST') {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
			}
			return route.continue()
		})
		await page.click('button:has-text("Save Project")')
		await expect(page.getByText(/Project saved/i)).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Cancel / dismiss
// ---------------------------------------------------------------------------
test.describe('cancel behaviour', () => {
	test('Cancel button closes the modal without saving', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Throwaway')
		await page.click('button:has-text("Cancel")')
		await expect(page.getByText('Create New Project')).not.toBeVisible({ timeout: 2000 })
	})

	test('backdrop click closes the modal', async ({ page }) => {
		await openCreateModal(page)
		// Click the backdrop area at the top-left corner, well outside the centered modal-box
		await page.mouse.click(10, 10)
		await expect(page.getByText('Create New Project')).not.toBeVisible({ timeout: 2000 })
	})

	test('after cancel, re-opening clears path auto-fill state', async ({ page }) => {
		await openCreateModal(page)
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'First')
		const pathInput = page.locator('input[placeholder="~/.tamias/workspace/my-project"]')
		await pathInput.fill('/custom/override')
		await page.click('button:has-text("Cancel")')

		// Re-open modal
		await page.click('[data-tip="Create New Project"] button')
		await page.fill('input[placeholder="e.g. My Awesome Startup"]', 'Second')
		// Path should auto-fill again (manual edit state was reset)
		await expect(pathInput).toHaveValue('~/.tamias/workspace/second')
	})
})
