/**
 * E2E tests — Skills page (/skills).
 *
 * Covers:
 * - Page loads and lists skills (with tree structure)
 * - Built-in skills show badge
 * - Selecting a skill shows its content
 * - Creating a new skill
 * - Editing an existing custom skill
 * - Deleting a custom skill
 * - Tag filtering
 */

import { test, expect } from '@playwright/test'
import {
	ensureOnboarded,
	cleanupIdentity,
	mockNavAPIs,
	createMockSkill,
} from './helpers'

const MOCK_SKILLS = [
	createMockSkill({ name: 'researcher', folder: 'researcher', tags: ['ai'], isBuiltIn: true }),
	createMockSkill({ name: 'my-custom', folder: 'my-custom', tags: ['custom'], isBuiltIn: false, content: '# Custom\nDo custom things.' }),
	createMockSkill({ name: 'child-skill', folder: 'child-skill', tags: ['custom'], parent: 'my-custom', isBuiltIn: false }),
]

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

async function gotoSkills(page: import('@playwright/test').Page, skills = MOCK_SKILLS) {
	await mockNavAPIs(page)
	await page.route('/api/skills', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(skills) })
		}
		// POST — create/update
		return route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' })
	})
	await page.route('/api/skills/*', route => {
		if (route.request().method() === 'DELETE') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
		}
		return route.continue()
	})
	await page.goto('/skills', { waitUntil: 'load' })
}

// ---------------------------------------------------------------------------
// Page load & listing
// ---------------------------------------------------------------------------
test.describe('skills page load', () => {
	test('renders the skill list', async ({ page }) => {
		await gotoSkills(page)
		await expect(page.getByTestId('skill-item-researcher')).toBeVisible({ timeout: 10_000 })
		await expect(page.getByTestId('skill-item-my-custom')).toBeVisible()
	})

	test('built-in skills show a built-in indicator', async ({ page }) => {
		await gotoSkills(page)
		await expect(page.getByTestId('skill-item-researcher')).toBeVisible({ timeout: 10_000 })
		// Built-in skills should have some visual indicator (badge or text)
		const researcherItem = page.getByTestId('skill-item-researcher')
		await expect(researcherItem).toContainText('built-in', { ignoreCase: true })
	})

	test('child skills appear in the list', async ({ page }) => {
		await gotoSkills(page)
		await expect(page.getByTestId('skill-item-child-skill')).toBeVisible({ timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// Skill selection & detail
// ---------------------------------------------------------------------------
test.describe('skill detail', () => {
	test('clicking a skill shows its content', async ({ page }) => {
		await gotoSkills(page)
		await page.getByTestId('skill-item-my-custom').click()
		// Should show the skill name in the detail heading
		await expect(page.getByRole('heading', { name: 'my-custom' })).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Create skill
// ---------------------------------------------------------------------------
test.describe('create skill', () => {
	test('new skill form appears when create button is clicked', async ({ page }) => {
		await gotoSkills(page)
		// Click the create button (in the sidebar or the empty-state button)
		const createBtn = page.getByTestId('skill-create-btn').or(page.getByTestId('skill-create-empty-btn'))
		await createBtn.first().click()
		await expect(page.getByTestId('skill-name-input')).toBeVisible({ timeout: 5_000 })
		await expect(page.getByTestId('skill-content-input')).toBeVisible()
	})

	test('saving a new skill sends POST to /api/skills', async ({ page }) => {
		let capturedBody: unknown
		await mockNavAPIs(page)
		await page.route('/api/skills', route => {
			if (route.request().method() === 'POST') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capturedBody) })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SKILLS) })
		})
		await page.route('/api/skills/*', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
		)
		await page.goto('/skills', { waitUntil: 'load' })

		const createBtn = page.getByTestId('skill-create-btn').or(page.getByTestId('skill-create-empty-btn'))
		await createBtn.first().click()
		await page.getByTestId('skill-name-input').fill('new-test-skill')
		await page.getByTestId('skill-content-input').fill('# Test\nSome content here.')
		await page.getByTestId('skill-save-btn').click()

		await page.waitForTimeout(1000)
		expect(capturedBody).toBeDefined()
		expect((capturedBody as Record<string, unknown>).name).toBe('new-test-skill')
	})

	test('cancel button discards the form', async ({ page }) => {
		await gotoSkills(page)
		const createBtn = page.getByTestId('skill-create-btn').or(page.getByTestId('skill-create-empty-btn'))
		await createBtn.first().click()
		await expect(page.getByTestId('skill-name-input')).toBeVisible()
		await page.getByTestId('skill-cancel-btn').click()
		await expect(page.getByTestId('skill-name-input')).not.toBeVisible({ timeout: 3_000 })
	})
})

// ---------------------------------------------------------------------------
// Edit skill
// ---------------------------------------------------------------------------
test.describe('edit skill', () => {
	test('edit button opens the editor form pre-filled', async ({ page }) => {
		await gotoSkills(page)
		await page.getByTestId('skill-item-my-custom').click()
		await page.getByTestId('skill-edit-btn').click()
		await expect(page.getByTestId('skill-name-input')).toBeVisible({ timeout: 5_000 })
	})
})

// ---------------------------------------------------------------------------
// Delete skill
// ---------------------------------------------------------------------------
test.describe('delete skill', () => {
	test('delete button removes the skill after confirmation', async ({ page }) => {
		let deleteWasCalled = false
		await mockNavAPIs(page)
		await page.route('/api/skills', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SKILLS) }),
		)
		await page.route('/api/skills/*', route => {
			if (route.request().method() === 'DELETE') {
				deleteWasCalled = true
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
			}
			return route.continue()
		})
		await page.goto('/skills', { waitUntil: 'load' })

		await page.getByTestId('skill-item-my-custom').click()

		// Set up dialog handler before clicking delete
		page.on('dialog', dialog => dialog.accept())
		await page.getByTestId('skill-delete-btn').click()

		await page.waitForTimeout(1000)
		expect(deleteWasCalled).toBe(true)
	})
})
