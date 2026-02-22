import { execSync } from 'child_process'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { readDaemonInfo, clearDaemonInfo, isDaemonRunning, getDaemonUrl } from '../utils/daemon.ts'

export const runStopCommand = async () => {
	p.intro(pc.bgRed(pc.white(' Tamias — Stop Daemon ')))

	// Step 1: graceful shutdown via HTTP (only works for the active daemon)
	const running = await isDaemonRunning()
	if (running) {
		try {
			await fetch(`${getDaemonUrl()}/daemon`, { method: 'DELETE' })
		} catch { /* already dying */ }
	}

	// Step 2: kill the PID in daemon.json (covers the active instance)
	const info = readDaemonInfo()
	if (info?.pid) {
		try { process.kill(info.pid, 'SIGTERM') } catch { /* already gone */ }
	}
	clearDaemonInfo()

	// Step 3: kill ALL other tamias --daemon processes (orphaned instances)
	// This is the critical step: previous installs/restarts leave ghost processes
	// that daemon.json no longer tracks.
	try {
		const result = execSync(
			`pgrep -f 'tamias.*--daemon' || true`,
			{ encoding: 'utf8' }
		).trim()
		if (result) {
			const pids = result.split('\n').map(Number).filter(pid => pid && pid !== process.pid)
			for (const pid of pids) {
				try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
			}
			if (pids.length > 0) {
				console.log(pc.yellow(`  Killed ${pids.length} orphaned daemon process(es): ${pids.join(', ')}`))
			}
		}
	} catch { /* pgrep not available or no matches */ }

	p.outro(pc.green('✅ All daemon processes stopped.'))
}
