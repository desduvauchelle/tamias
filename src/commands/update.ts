import * as p from '@clack/prompts'
import pc from 'picocolors'
import { checkForUpdate, performUpdate } from '../utils/update.ts'
import { VERSION } from '../utils/version.ts'

export const runUpdateCommand = async (opts: { force?: boolean; check?: boolean } = {}) => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Update ')))

	// ── Check mode ────────────────────────────────────────────────────────────
	if (opts.check) {
		const spinner = p.spinner()
		spinner.start('Checking for updates…')
		try {
			const result = await checkForUpdate()
			if (!result) {
				spinner.stop(pc.yellow('Could not check for updates.'))
				process.exit(1)
			}
			const { currentVersion, latestVersion } = result
			if (currentVersion === latestVersion) {
				spinner.stop(pc.green(`✅ Already up to date (v${currentVersion})`))
			} else {
				spinner.stop(pc.yellow(`📦 Update available: v${currentVersion} → v${latestVersion}`))
			}
		} catch (err) {
			spinner.stop(pc.red(`Failed to check: ${err}`))
			process.exit(1)
		}
		process.exit(0)
	}

	// ── Pre-flight: show current version and check what's available ───────────
	const spinner = p.spinner()
	spinner.start('Checking for latest version…')

	let updateInfo: Awaited<ReturnType<typeof checkForUpdate>>
	try {
		updateInfo = await checkForUpdate()
	} catch (err) {
		spinner.stop(pc.red(`Failed to check for updates: ${err}`))
		process.exit(1)
	}

	if (!updateInfo) {
		spinner.stop(pc.red('Could not reach GitHub releases.'))
		process.exit(1)
	}

	const { currentVersion, latestVersion } = updateInfo

	if (currentVersion === latestVersion && !opts.force) {
		spinner.stop(pc.green(`✅ Already up to date (v${currentVersion})`))
		p.outro('Nothing to do.')
		process.exit(0)
	}

	spinner.stop(
		opts.force && currentVersion === latestVersion
			? pc.blue(`Re-installing v${currentVersion} (--force)`)
			: pc.yellow(`📦 New version available: v${currentVersion} → v${latestVersion}`)
	)

	// ── Warn about restart ────────────────────────────────────────────────────
	p.note(
		`This will:\n  • Download and install v${latestVersion}\n  • Stop the running daemon (if any)\n  • Restart all processes`,
		pc.yellow('⚠️  Warning')
	)

	const confirmed = await p.confirm({
		message: 'Proceed with update?',
		initialValue: false,
	})

	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Update cancelled.')
		process.exit(0)
	}

	// ── Stop running daemon first ─────────────────────────────────────────────
	try {
		const { isDaemonRunning, readDaemonInfo } = await import('../utils/daemon.ts')
		if (await isDaemonRunning()) {
			const info = readDaemonInfo()
			if (info?.port) {
				p.log.step('Stopping running daemon…')
				await fetch(`http://127.0.0.1:${info.port}/daemon`, { method: 'DELETE' }).catch(() => { })
				await new Promise(r => setTimeout(r, 1500))
			}
		}
	} catch { /* daemon not running, that's fine */ }

	// ── Perform update ────────────────────────────────────────────────────────
	const updateSpinner = p.spinner()
	updateSpinner.start('Downloading update…')

	const result = await performUpdate(
		(progress) => {
			if (progress.type === 'error') {
				updateSpinner.stop(pc.red(progress.message))
				updateSpinner.start('Continuing…')
			} else {
				updateSpinner.message(progress.message)
			}
		},
		{ force: opts.force ?? false }
	)

	if (result.success) {
		updateSpinner.stop(pc.green(`✅ Updated to v${result.latestVersion ?? result.currentVersion}`))
		p.outro(pc.green(`Done! Run ${pc.bold('tamias start')} to restart the daemon.`))
	} else {
		updateSpinner.stop(pc.red(`Update failed: ${result.error}`))
		process.exit(1)
	}
}
