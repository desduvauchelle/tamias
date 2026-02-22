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

	// Step 2: kill the processes in daemon.json
	const info = readDaemonInfo()
	if (info) {
		if (info.pid) {
			try { process.kill(info.pid, 'SIGTERM') } catch { /* already gone */ }
		}
		if (info.dashboardPid) {
			try { process.kill(info.dashboardPid, 'SIGTERM') } catch { /* already gone */ }
		}
	}

	// Step 3: kill ALL other tamias --daemon processes and dashboard processes
	// This is the critical step: previous installs/restarts leave ghost processes.
	try {
		// Kill daemon processes
		const daemonResult = execSync(
			`pgrep -f 'tamias.*--daemon' || true`,
			{ encoding: 'utf8' }
		).trim()
		if (daemonResult) {
			const pids = daemonResult.split('\n').map(Number).filter(pid => pid && pid !== process.pid)
			for (const pid of pids) {
				try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
			}
			if (pids.length > 0) {
				console.log(pc.yellow(`  Killed ${pids.length} orphaned daemon process(es): ${pids.join(', ')}`))
			}
		}

		// Kill dashboard processes (Next.js/Bun running dashboard)
		// We look for 'next-router-worker' or 'server.js' or the dashboard port 5678 specifically
		const dashboardResult = execSync(
			`lsof -i :5678 -t || true`,
			{ encoding: 'utf8' }
		).trim()
		if (dashboardResult) {
			const pids = dashboardResult.split('\n').map(Number).filter(pid => pid && pid !== process.pid)
			for (const pid of pids) {
				try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
			}
			if (pids.length > 0) {
				console.log(pc.yellow(`  Killed ${pids.length} dashboard process(es) on port 5678`))
			}
		}
	} catch (err) {
		/* ignore errors if tools aren't available */
	}

	clearDaemonInfo()
	p.outro(pc.green('✅ All daemon and dashboard processes stopped.'))
}
