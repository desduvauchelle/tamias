/**
 * E2E tests for the onboarding redirect middleware.
 *
 * The middleware checks for IDENTITY.md under $TAMIAS_DIR/memory/IDENTITY.md.
 * When found → user is onboarded, serve the page. When missing → redirect to /onboarding.
 *
 * The dev server is started with TAMIAS_DIR=/tmp/tamias-e2e so tests can create/
 * delete the file without touching the developer's real ~/.tamias directory.
 */

import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { TAMIAS_E2E_DIR, IDENTITY_PATH } from './helpers'

function createIdentity() {
	mkdirSync(TAMIAS_E2E_DIR + '/memory', { recursive: true })
	writeFileSync(IDENTITY_PATH, '# Test Identity\n\nThis is a test identity file.\n')
}

function removeIdentity() {
	if (existsSync(IDENTITY_PATH)) {
		rmSync(IDENTITY_PATH)
	}
}

// ---------------------------------------------------------------------------
// Not-onboarded state: IDENTITY.md does NOT exist
// ---------------------------------------------------------------------------
test.describe('when not onboarded (no IDENTITY.md)', () => {
	test.beforeEach(() => {
		removeIdentity()
	})

	test('GET / redirects to /onboarding', async ({ page }) => {
		await page.goto('/', { waitUntil: 'load' })
		expect(page.url()).toContain('/onboarding')
	})

	test('GET /dashboard redirects to /onboarding', async ({ page }) => {
		await page.goto('/dashboard', { waitUntil: 'load' })
		expect(page.url()).toContain('/onboarding')
	})

	test('GET /onboarding is accessible and does not loop', async ({ page }) => {
		await page.goto('/onboarding', { waitUntil: 'load' })
		// Should stay on /onboarding, not redirect away
		expect(page.url()).toContain('/onboarding')
	})

	test('API routes are not blocked by the onboarding redirect', async ({ request }) => {
		// /api/* routes should not be redirected to /onboarding (they are excluded in middleware)
		const response = await request.get('/api/status')
		// We just need that the response is not a redirect to /onboarding HTML page.
		// A 200, 404, or 503 are all valid — none of them mean the middleware
		// intercepted the request and returned a redirect to /onboarding HTML.
		expect(response.status()).not.toBe(302)
		expect(response.status()).not.toBe(301)
	})
})

// ---------------------------------------------------------------------------
// Onboarded state: IDENTITY.md exists
// ---------------------------------------------------------------------------
test.describe('when onboarded (IDENTITY.md exists)', () => {
	test.beforeEach(() => {
		createIdentity()
	})

	test.afterEach(() => {
		removeIdentity()
	})

	test('GET / serves the home page without redirecting to /onboarding', async ({ page }) => {
		await page.goto('/', { waitUntil: 'load' })
		expect(page.url()).not.toContain('/onboarding')
	})

	test('GET /dashboard is accessible', async ({ page }) => {
		await page.goto('/dashboard', { waitUntil: 'load' })
		expect(page.url()).not.toContain('/onboarding')
	})

	test('direct navigation to /onboarding still works after onboarding', async ({ page }) => {
		// Users should be able to re-visit /onboarding even after they are set up
		await page.goto('/onboarding', { waitUntil: 'load' })
		expect(page.url()).toContain('/onboarding')
	})
})

// ---------------------------------------------------------------------------
// Transition: not-onboarded → onboarded within same "session"
// ---------------------------------------------------------------------------
test.describe('state transition: writing IDENTITY.md makes / accessible', () => {
	test('page becomes accessible after IDENTITY.md is created', async ({ page }) => {
		// Start without identity
		removeIdentity()
		await page.goto('/', { waitUntil: 'load' })
		expect(page.url()).toContain('/onboarding')

		// Simulate the onboarding completing by writing the file
		createIdentity()

		// Next navigation to / should no longer redirect
		await page.goto('/', { waitUntil: 'load' })
		expect(page.url()).not.toContain('/onboarding')

		removeIdentity()
	})
})
