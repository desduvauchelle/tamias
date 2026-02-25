import * as p from '@clack/prompts'
import pc from 'picocolors'
import { VERSION } from '../utils/version.ts'
import { checkForUpdate, performUpdate, type UpdateProgress } from '../utils/update.ts'
import { isDaemonRunning } from '../utils/daemon.ts'
import { runRestartCommand } from './restart.ts'
import { readDaemonInfo } from '../utils/daemon.ts'

export const runUpdateCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias CLI Update ')))

	try {
		const currentVersion = VERSION
		p.note(`Current version: v${currentVersion}`)

		const s = p.spinner()
		s.start('Checking for updates...')

		const updateInfo = await checkForUpdate().catch((err) => {
			s.stop('Failed to check for updates.')
			p.cancel(pc.red(String(err)))
			process.exit(1)
			return null as any
		})

		const { latestVersion } = updateInfo

		let forceReinstall = false
		if (currentVersion === latestVersion) {
			s.stop(`Already up to date. (v${currentVersion})`)
			const shouldForce = await p.confirm({
				message: 'Re-install current version (includes dashboard update)?',
				initialValue: false
			})
			if (!shouldForce || p.isCancel(shouldForce)) {
				p.outro(pc.green('No update required.'))
				process.exit(0)
			}
			forceReinstall = true
			s.start('Re-installing...')
		} else {
			s.message(`New version found: v${latestVersion}.`)
		}

		const result = await performUpdate((progress: UpdateProgress) => {
			if (progress.type === 'error') {
				p.log.error(progress.message)
			} else if (progress.type === 'warn') {
				p.log.warn(progress.message)
			} else {
				s.message(progress.message)
			}
		}, { force: forceReinstall })

		if (result.success) {
			s.stop(`Successfully updated to v${result.latestVersion || result.currentVersion}!`)

			// Restart the daemon so the new binary and dashboard take effect immediately.
			if (await isDaemonRunning()) {
				p.log.info('Restarting daemon to apply update...')
				await runRestartCommand()
			}

			// Print dashboard URL with token if available
			const info = readDaemonInfo()
			if (info && info.dashboardPort && info.token) {
				const url = `http://localhost:${info.dashboardPort}/configs?token=${info.token}`
				p.outro(pc.green(`Dashboard URL: ${pc.bold(url)}\nPaste the token in the dashboard if prompted.`))
			}

			p.outro(pc.green('Update complete.'))
		} else {
			s.stop('Update failed.')
			p.cancel(pc.red(`Update failed: ${result.error}`))
		}

	} catch (err) {
		p.cancel(pc.red(`Update failed: ${String(err)}`))
	}
}
