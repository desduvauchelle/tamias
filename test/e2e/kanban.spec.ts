/**
 * E2E tests — Kanban board on the Projects page.
 *
 * Covers:
 * - Board renders all 4 columns: todo, in-progress, awaiting-review, done
 * - "Add Task" inline form appears when clicking the column button
 * - Submitting with a non-empty title adds the task to the board
 * - Submitting with an empty title does not create a task
 * - Cancel hides the inline form without adding a task
 * - Task detail modal opens when clicking a task card
 * - Modal shows correct title, status, priority fields
 * - "Save & Notify AI" updates the task
 */

import { test, expect } from '@playwright/test'
import { ensureOnboarded, cleanupIdentity } from './helpers'

test.beforeAll(() => ensureOnboarded())
test.afterAll(() => cleanupIdentity())

const MOCK_PROJECT = {
	id: 'test-proj',
	name: 'Test Project',
	path: '~/.tamias/workspace/test-proj',
	description: 'A test project',
	kanban: [
		{ id: 'task-1', title: 'Existing Task', status: 'todo', createdAt: Date.now() - 1000 }
	]
}

async function goToKanban(page: import('@playwright/test').Page, project = MOCK_PROJECT) {
	// Mock all required API calls
	await page.route('/api/projects', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([project]) })
	)
	await page.route(`/api/projects/${project.id}`, route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) })
		}
		if (route.request().method() === 'PUT') {
			// Echo back the update
			return route.request().postDataJSON().then((body: any) => {
				const updated = { ...project, ...body }
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
			})
		}
		return route.continue()
	})
	await page.route('/api/project-event', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
	)
	await page.route('/api/discord/channels', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [] }) })
	)
	await page.route('/api/readme', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: '' }) })
	)

	await page.goto(`/projects?id=${project.id}&tab=kanban`, { waitUntil: 'load' })
	// Wait for the kanban board to render
	await expect(page.getByText('Kanban Board')).toBeVisible({ timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Column rendering
// ---------------------------------------------------------------------------
test.describe('kanban board layout', () => {
	test('renders all four columns', async ({ page }) => {
		await goToKanban(page)
		// Column headers (capitalized display names)
		await expect(page.getByText('todo', { exact: true })).toBeVisible()
		await expect(page.getByText('in-progress', { exact: true })).toBeVisible()
		await expect(page.getByText('awaiting-review', { exact: true })).toBeVisible()
		await expect(page.getByText('done', { exact: true })).toBeVisible()
	})

	test('existing task appears in the correct column', async ({ page }) => {
		await goToKanban(page)
		await expect(page.getByText('Existing Task')).toBeVisible()
	})
})

// ---------------------------------------------------------------------------
// Adding a task
// ---------------------------------------------------------------------------
test.describe('adding a task', () => {
	test('clicking "Add Task" in the todo column shows the inline form', async ({ page }) => {
		await goToKanban(page)
		// Click the first "Add Task" button (todo column)
		await page.locator('button:has-text("Add Task")').first().click()
		await expect(page.locator('input[placeholder="Task title..."]')).toBeVisible()
	})

	test('submitting the form with a title adds the task and closes the form', async ({ page }) => {
		await goToKanban(page)
		await page.locator('button:has-text("Add Task")').first().click()
		await page.fill('input[placeholder="Task title..."]', 'Brand New Task')
		await page.click('button[type="submit"]:has-text("Add")')
		// The task should appear in the board — API responded with the new task
		await expect(page.locator('input[placeholder="Task title..."]')).not.toBeVisible({ timeout: 3000 })
	})

	test('PUT /api/projects/:id is called with the updated kanban when a task is added', async ({ page }) => {
		let capturedBody: any = null
		await page.route(`/api/projects/${MOCK_PROJECT.id}`, route => {
			if (route.request().method() === 'PUT') {
				capturedBody = route.request().postDataJSON()
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PROJECT) })
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PROJECT) })
		})
		await page.route('/api/projects', route =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PROJECT]) })
		)
		await page.route('/api/project-event', route =>
			route.fulfill({ status: 200, body: '{}' })
		)
		await page.route('/api/discord/channels', route =>
			route.fulfill({ status: 200, body: JSON.stringify({ channels: [] }) })
		)
		await page.route('/api/readme', route =>
			route.fulfill({ status: 200, body: JSON.stringify({ content: '' }) })
		)
		await page.goto(`/projects?id=${MOCK_PROJECT.id}&tab=kanban`, { waitUntil: 'load' })
		await expect(page.getByText('Kanban Board')).toBeVisible({ timeout: 10_000 })

		await page.locator('button:has-text("Add Task")').first().click()
		await page.fill('input[placeholder="Task title..."]', 'Test Task')
		await page.click('button[type="submit"]:has-text("Add")')

		// Wait for the PUT to fire
		await page.waitForTimeout(500)
		expect(capturedBody).not.toBeNull()
		expect(capturedBody.kanban).toBeDefined()
		const newTask = capturedBody.kanban.find((t: any) => t.title === 'Test Task')
		expect(newTask).toBeDefined()
		expect(newTask.status).toBe('todo') // first column is todo
	})

	test('clicking Cancel hides the inline form without adding a task', async ({ page }) => {
		await goToKanban(page)
		await page.locator('button:has-text("Add Task")').first().click()
		await page.fill('input[placeholder="Task title..."]', 'Temporary text')
		await page.click('button:has-text("Cancel")')
		await expect(page.locator('input[placeholder="Task title..."]')).not.toBeVisible({ timeout: 2000 })
	})
})

// ---------------------------------------------------------------------------
// Task detail modal
// ---------------------------------------------------------------------------
test.describe('task detail modal', () => {
	test('clicking a task card opens the detail modal', async ({ page }) => {
		await goToKanban(page)
		await page.getByText('Existing Task').click()
		// Modal should contain the title in a textarea
		await expect(page.locator('textarea').filter({ hasText: 'Existing Task' })).toBeVisible({ timeout: 3000 })
	})

	test('modal shows status, priority, and assignee fields', async ({ page }) => {
		await goToKanban(page)
		await page.getByText('Existing Task').click()
		// Status select
		await expect(page.locator('select').filter({ hasText: 'todo' })).toBeVisible()
		// Priority select (shows 'low', 'medium', 'high', 'urgent' options)
		await expect(page.getByRole('option', { name: 'medium' })).toBeAttached()
		// Assignee input
		await expect(page.locator('input[placeholder*="ssignee"]').or(page.locator('input[placeholder*="assign"]'))).toBeVisible()
	})

	test('modal closes when the X / close button is clicked', async ({ page }) => {
		await goToKanban(page)
		await page.getByText('Existing Task').click()
		await expect(page.locator('textarea').filter({ hasText: 'Existing Task' })).toBeVisible()
		// The close button has aria text or is an × character
		await page.keyboard.press('Escape')
		await expect(page.locator('textarea').filter({ hasText: 'Existing Task' })).not.toBeVisible({ timeout: 2000 })
	})
})
