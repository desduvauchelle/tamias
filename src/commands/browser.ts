import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDaemonUrl, isDaemonRunning, readDaemonInfo } from '../utils/daemon.ts'

type BrowserStatusPayload = { installed: boolean; headedOpen: boolean }
type BrowserLaunchPayload = { ok: boolean; message?: string }
type BrowserClosePayload = { ok: boolean }
type BrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface BrowserPrompts {
	intro: (message: string) => void
	outro: (message?: string) => void
	log: {
		error: (message: string) => void
		success: (message: string) => void
		info: (message: string) => void
		warn: (message: string) => void
	}
	spinner: () => {
		start: (message: string) => void
		stop: (message: string) => void
	}
}

export interface BrowserCommandDeps {
	getDaemonUrl: () => string
	isDaemonRunning: () => Promise<boolean>
	readDaemonInfo: () => { token?: string } | undefined
	fetch: BrowserFetch
	prompts: BrowserPrompts
}

function daemonFetchUrl(path: string, deps: BrowserCommandDeps): string {
	const base = deps.getDaemonUrl()
	const token = deps.readDaemonInfo()?.token
	return token ? `${base}${path}?token=${token}` : `${base}${path}`
}

function getBrowserCommandDeps(overrides: Partial<BrowserCommandDeps>): BrowserCommandDeps {
	return {
		getDaemonUrl,
		isDaemonRunning,
		readDaemonInfo: () => readDaemonInfo() ?? undefined,
		fetch,
		prompts: p,
		...overrides,
	}
}

export function createBrowserCommand(overrides: Partial<BrowserCommandDeps> = {}): Command {
	const deps = getBrowserCommandDeps(overrides)
	const browserCommand = new Command('browser')
		.description('Manage the authentication browser for accessing gated content')

	browserCommand
		.command('open [url]')
		.description('Open a browser window to authenticate on websites (session cookies are saved)')
		.action(async (url?: string) => {
			deps.prompts.intro(pc.bold('Browser — Open'))

			const running = await deps.isDaemonRunning()
			if (!running) {
				deps.prompts.log.error('Daemon is not running. Start it with `tamias start`.')
				deps.prompts.outro('')
				return
			}

			const spinner = deps.prompts.spinner()
			spinner.start('Launching browser')

			try {
				const body: Record<string, string> = {}
				if (url) body.url = url

				const res = await deps.fetch(daemonFetchUrl('/browser/launch', deps), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				})

				const data = await res.json() as BrowserLaunchPayload

				if (data.ok) {
					spinner.stop('Browser launched')
					deps.prompts.log.success(data.message || 'Browser is open. Log in to any sites you need, then run `tamias browser close`.')
				} else {
					spinner.stop('Failed')
					deps.prompts.log.error(data.message || 'Failed to launch browser.')
				}
			} catch (err) {
				spinner.stop('Failed')
				deps.prompts.log.error(`Could not reach the daemon: ${String(err)}`)
			}

			deps.prompts.outro('')
		})

	browserCommand
		.command('close')
		.description('Close the authentication browser and save session cookies')
		.action(async () => {
			deps.prompts.intro(pc.bold('Browser — Close'))

			const running = await deps.isDaemonRunning()
			if (!running) {
				deps.prompts.log.error('Daemon is not running. Start it with `tamias start`.')
				deps.prompts.outro('')
				return
			}

			const spinner = deps.prompts.spinner()
			spinner.start('Closing browser')

			try {
				const res = await deps.fetch(daemonFetchUrl('/browser/close', deps), {
					method: 'POST',
				})

				const data = await res.json() as BrowserClosePayload

				if (data.ok) {
					spinner.stop('Browser closed')
					deps.prompts.log.success('Session cookies saved. The AI browser will now use your authenticated sessions.')
				} else {
					spinner.stop('Failed')
					deps.prompts.log.error('Failed to close browser.')
				}
			} catch (err) {
				spinner.stop('Failed')
				deps.prompts.log.error(`Could not reach the daemon: ${String(err)}`)
			}

			deps.prompts.outro('')
		})

	browserCommand
		.command('status')
		.description('Check browser installation and auth session status')
		.action(async () => {
			deps.prompts.intro(pc.bold('Browser — Status'))

			const running = await deps.isDaemonRunning()
			if (!running) {
				deps.prompts.log.error('Daemon is not running. Start it with `tamias start`.')
				deps.prompts.outro('')
				return
			}

			try {
				const res = await deps.fetch(daemonFetchUrl('/browser/status', deps))
				const data = await res.json() as BrowserStatusPayload

				deps.prompts.log.info(`Playwright: ${data.installed ? pc.green('installed') : pc.red('not installed')}`)
				deps.prompts.log.info(`Auth browser: ${data.headedOpen ? pc.yellow('open') : pc.dim('closed')}`)

				if (!data.installed) {
					deps.prompts.log.warn('Install Playwright by asking the AI to run browser_install, or use the dashboard Tools page.')
				}
			} catch (err) {
				deps.prompts.log.error(`Could not reach the daemon: ${String(err)}`)
			}

			deps.prompts.outro('')
		})

	return browserCommand
}

export const browserCommand = createBrowserCommand()
