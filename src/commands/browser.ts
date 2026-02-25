import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { TAMIAS_DIR } from '../utils/config'
import pc from 'picocolors'

const BROWSER_DATA_DIR = join(TAMIAS_DIR, 'browser-data')
const PLAYWRIGHT_PATH = join(TAMIAS_DIR, 'node_modules', 'playwright')
const PLAYWRIGHT_BIN = join(TAMIAS_DIR, 'node_modules', '.bin', 'playwright')

async function ensurePlaywright() {
	if (!existsSync(PLAYWRIGHT_PATH)) {
		console.log(pc.yellow('Playwright not found. Installing Chromium (~150 MB)...'))
		const pkgJson = join(TAMIAS_DIR, 'package.json')
		if (!existsSync(pkgJson)) {
			writeFileSync(pkgJson, JSON.stringify({ name: 'tamias-data', version: '1.0.0', private: true }, null, 2))
		}
		const bunPath = Bun.which('bun') ?? join(homedir(), '.bun', 'bin', 'bun')
		const addProc = Bun.spawn([bunPath, 'add', 'playwright', '--cwd', TAMIAS_DIR], { stdout: 'inherit', stderr: 'inherit' })
		if (await addProc.exited !== 0) throw new Error('Failed to install playwright')
		const installProc = Bun.spawn([PLAYWRIGHT_BIN, 'install', 'chromium'], { stdout: 'inherit', stderr: 'inherit' })
		if (await installProc.exited !== 0) throw new Error('Failed to install Chromium')
		console.log(pc.green('Chromium installed.'))
	}
}

export const runBrowserCommand = async () => {
	console.log(pc.cyan('Launching browser in headful mode for manual login...'))
	console.log(pc.dim('User data directory: ' + BROWSER_DATA_DIR))
	console.log(pc.yellow('Close the browser window to return to terminal.'))

	await ensurePlaywright()

	const { chromium } = await import(PLAYWRIGHT_PATH) as typeof import('playwright')

	if (!existsSync(BROWSER_DATA_DIR)) {
		mkdirSync(BROWSER_DATA_DIR, { recursive: true })
	}

	const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
		headless: false,
		viewport: { width: 1280, height: 720 },
	})

	const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage()
	await page.goto('https://www.google.com')

	await new Promise<void>((resolve) => {
		context.on('close', () => resolve())
	})

	console.log(pc.green('Browser session closed.'))
}
