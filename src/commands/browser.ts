import { chromium } from 'playwright'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { TAMIAS_DIR } from '../utils/config'
import pc from 'picocolors'

const BROWSER_DATA_DIR = join(TAMIAS_DIR, 'browser-data')

export const runBrowserCommand = async () => {
	console.log(pc.cyan('Launching browser in headful mode for manual login...'))
	console.log(pc.dim('User data directory: ' + BROWSER_DATA_DIR))
	console.log(pc.yellow('Close the browser window to return to terminal.'))

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
