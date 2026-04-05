import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDaemonUrl, isDaemonRunning, readDaemonInfo } from '../utils/daemon.ts'

function daemonFetchUrl(path: string): string {
	const base = getDaemonUrl()
	const token = readDaemonInfo()?.token
	return token ? `${base}${path}?token=${token}` : `${base}${path}`
}

export const browserCommand = new Command('browser')
	.description('Manage the authentication browser for accessing gated content')

browserCommand
	.command('open [url]')
	.description('Open a browser window to authenticate on websites (session cookies are saved)')
	.action(async (url?: string) => {
		p.intro(pc.bold('Browser — Open'))

		const running = await isDaemonRunning()
		if (!running) {
			p.log.error('Daemon is not running. Start it with `tamias start`.')
			p.outro('')
			return
		}

		const spinner = p.spinner()
		spinner.start('Launching browser')

		try {
			const body: Record<string, string> = {}
			if (url) body.url = url

			const res = await fetch(daemonFetchUrl('/browser/launch'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			})

			const data = await res.json() as { ok: boolean; message?: string }

			if (data.ok) {
				spinner.stop('Browser launched')
				p.log.success(data.message || 'Browser is open. Log in to any sites you need, then run `tamias browser close`.')
			} else {
				spinner.stop('Failed')
				p.log.error(data.message || 'Failed to launch browser.')
			}
		} catch (err) {
			spinner.stop('Failed')
			p.log.error(`Could not reach the daemon: ${String(err)}`)
		}

		p.outro('')
	})

browserCommand
	.command('close')
	.description('Close the authentication browser and save session cookies')
	.action(async () => {
		p.intro(pc.bold('Browser — Close'))

		const running = await isDaemonRunning()
		if (!running) {
			p.log.error('Daemon is not running. Start it with `tamias start`.')
			p.outro('')
			return
		}

		const spinner = p.spinner()
		spinner.start('Closing browser')

		try {
			const res = await fetch(daemonFetchUrl('/browser/close'), {
				method: 'POST',
			})

			const data = await res.json() as { ok: boolean }

			if (data.ok) {
				spinner.stop('Browser closed')
				p.log.success('Session cookies saved. The AI browser will now use your authenticated sessions.')
			} else {
				spinner.stop('Failed')
				p.log.error('Failed to close browser.')
			}
		} catch (err) {
			spinner.stop('Failed')
			p.log.error(`Could not reach the daemon: ${String(err)}`)
		}

		p.outro('')
	})

browserCommand
	.command('status')
	.description('Check browser installation and auth session status')
	.action(async () => {
		p.intro(pc.bold('Browser — Status'))

		const running = await isDaemonRunning()
		if (!running) {
			p.log.error('Daemon is not running. Start it with `tamias start`.')
			p.outro('')
			return
		}

		try {
			const res = await fetch(daemonFetchUrl('/browser/status'))
			const data = await res.json() as { installed: boolean; headedOpen: boolean }

			p.log.info(`Playwright: ${data.installed ? pc.green('installed') : pc.red('not installed')}`)
			p.log.info(`Auth browser: ${data.headedOpen ? pc.yellow('open') : pc.dim('closed')}`)

			if (!data.installed) {
				p.log.warn('Install Playwright by asking the AI to run browser_install, or use the dashboard Tools page.')
			}
		} catch (err) {
			p.log.error(`Could not reach the daemon: ${String(err)}`)
		}

		p.outro('')
	})
