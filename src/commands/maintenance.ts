import * as p from '@clack/prompts'
import pc from 'picocolors'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, rmSync, readdirSync, chmodSync } from 'fs'
import { execSync } from 'child_process'
import { isDaemonRunning, readDaemonInfo } from '../utils/daemon.ts'
import { runStopCommand } from './stop.ts'
import { TAMIAS_DIR } from '../utils/config.ts'

export const runUninstallCommand = async () => {
	p.intro(pc.bgRed(pc.white(' Tamias CLI — Uninstall ')))

	const confirmed = await p.confirm({
		message: pc.red('Are you sure you want to completely uninstall Tamias and delete ALL data?'),
		initialValue: false,
	})

	if (!confirmed || p.isCancel(confirmed)) {
		p.cancel('Uninstall cancelled.')
		return
	}

	const s = p.spinner()
	s.start('Stopping daemon...')
	if (await isDaemonRunning()) {
		await runStopCommand()
	}
	s.stop('Daemon stopped (if it was running).')

	s.start('Deleting Tamias data directory (~/.tamias)...')
	if (existsSync(TAMIAS_DIR)) {
		rmSync(TAMIAS_DIR, { recursive: true, force: true })
	}
	s.stop('Data directory deleted.')

	s.start('Deleting Tamias binary...')
	const possibleBinPaths = [
		join(homedir(), '.bun', 'bin', 'tamias'),
		join(homedir(), '.local', 'bin', 'tamias'),
		'/usr/local/bin/tamias'
	]

	let deletedBin = false
	for (const binPath of possibleBinPaths) {
		if (existsSync(binPath)) {
			try {
				rmSync(binPath, { force: true })
				deletedBin = true
			} catch (e) {
				// Might need sudo
			}
		}
	}
	s.stop(deletedBin ? 'Binary deleted.' : 'Binary not found or could not be deleted (check permissions).')

	p.note(
		`Tamias has been uninstalled.

Manual cleanup might be needed for:
1. Your shell profile (${pc.dim('~/.zshrc')} or ${pc.dim('~/.bashrc')}) - remove the TAMIAS PATH export.
2. The dashboard source directory if you installed it elsewhere.`,
		'Uninstall Complete'
	)

	p.outro(pc.green('Goodbye! 🐿️'))
}

export const runBackupCommand = async (options: { file?: string }) => {
	p.intro(pc.bgBlue(pc.white(' Tamias CLI — Backup ')))

	const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)
	const defaultFilename = `tamias-backup-${dateStr}.tar.gz`
	const targetFile = options.file || defaultFilename
	const targetPath = join(process.cwd(), targetFile)

	if (!existsSync(TAMIAS_DIR)) {
		p.cancel(`Tamias data directory not found at ${TAMIAS_DIR}`)
		return
	}

	const s = p.spinner()
	s.start(`Creating backup at ${pc.cyan(targetFile)}...`)

	try {
		// Use tar to archive ~/.tamias
		// We use relative paths for excludes and patterns that don't cause 'stat' errors in BSD tar if possible
		// Or just ignore errors from tar if they are just about missing files
		const cmd = `tar -czf "${targetPath}" -C "${homedir()}" .tamias \
			--exclude=".tamias/daemon.json" \
			--exclude=".tamias/daemon.log" \
			--exclude=".tamias/src/dashboard/node_modules"`

		try {
			execSync(cmd, { stdio: 'pipe' })
		} catch (e: any) {
			// If it's just a warning about missing files (stat errors), we might still have a valid backup
			if (existsSync(targetPath)) {
				s.stop(`Backup created (with some warnings): ${pc.green(targetFile)}`)
			} else {
				throw e
			}
		}
		if (existsSync(targetPath)) {
			s.stop(`Backup created: ${pc.green(targetFile)}`)
		}
	} catch (err) {
		s.stop(pc.red('Backup failed.'))
		console.error(err)
		return
	}

	p.outro(pc.dim(`You can restore this backup later with 'tamias restore ${targetFile}'`))
}

export const runRestoreCommand = async (file: string) => {
	p.intro(pc.bgBlue(pc.white(' Tamias CLI — Restore ')))

	if (!file) {
		p.cancel('Please specify a backup file to restore.')
		return
	}

	const backupPath = join(process.cwd(), file)
	if (!existsSync(backupPath)) {
		p.cancel(`Backup file not found: ${file}`)
		return
	}

	const confirmed = await p.confirm({
		message: pc.yellow('Restoring will overwrite your current Tamias configuration. Continue?'),
		initialValue: false,
	})

	if (!confirmed || p.isCancel(confirmed)) {
		p.cancel('Restore cancelled.')
		return
	}

	const s = p.spinner()
	s.start('Stopping daemon...')
	if (await isDaemonRunning()) {
		await runStopCommand()
	}
	s.stop('Daemon stopped.')

	s.start('Restoring data...')
	try {
		// Ensure ~/.tamias exists or extract might fail depending on tar version
		if (!existsSync(TAMIAS_DIR)) {
			execSync(`mkdir -p "${TAMIAS_DIR}"`)
		}
		execSync(`tar -xzf "${backupPath}" -C "${homedir()}"`)
		s.stop('Data restored successfully.')
	} catch (err) {
		s.stop(pc.red('Restore failed.'))
		console.error(err)
		return
	}

	p.note('Backup has been restored. You can now start Tamias.', 'Restore Complete')
	p.outro(pc.green('Run `tamias start` to resume.'))
}
