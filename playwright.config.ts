import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E tests for Tamias dashboard middleware/routing behaviour.
 *
 * Run: bun run test:e2e
 *
 * These tests spin up the Next.js dev server (port 3001 to avoid collisions)
 * and verify routing behaviour based on whether IDENTITY.md exists.
 */
export default defineConfig({
	testDir: './test/e2e',
	fullyParallel: false, // tests manipulate filesystem state — run sequentially
	workers: 1, // single worker to avoid overwhelming the dev server with parallel compilations
	retries: 0,
	timeout: 15_000,
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:3001',
		// Don't follow redirects automatically — we want to assert them
		// (Playwright follows redirects by default in page.goto; we handle that per-test)
	},
	webServer: {
		command: 'cd src/dashboard && TAMIAS_TEST_MODE=1 TAMIAS_DIR=/tmp/tamias-e2e bunx next dev --port 3001 --turbopack',
		url: 'http://localhost:3001',
		timeout: 60_000,
		reuseExistingServer: !process.env.CI,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			TAMIAS_DIR: '/tmp/tamias-e2e',
		},
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
})
