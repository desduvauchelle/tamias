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
		// Kill caffeinate process if present
		if (info.caffeinatePid) {
			try { process.kill(info.caffeinatePid, 'SIGTERM') } catch { /* already gone */ }
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

		// Kill any remaining dashboard processes by port (catches orphans the PID kill above missed)
		const dashboardPort = info?.dashboardPort ?? 5678
		let dashboardPids = ''
		try {
			// macOS / BSD
			dashboardPids = execSync(`lsof -i :${dashboardPort} -t || true`, { encoding: 'utf8' }).trim()
		} catch {
			try {
				// Linux fallback
				dashboardPids = execSync(`fuser ${dashboardPort}/tcp 2>/dev/null || true`, { encoding: 'utf8' }).trim()
			} catch { /* tools not available */ }
		}
		if (dashboardPids) {
			const pids = dashboardPids.split(/\s+/).map(Number).filter(pid => pid && pid !== process.pid)
			for (const pid of pids) {
				try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
			}
			if (pids.length > 0) {
				console.log(pc.yellow(`  Killed ${pids.length} dashboard process(es) on port ${dashboardPort}`))
			}
		}
	} catch (err) {
		/* ignore errors if tools aren't available */
	}

	clearDaemonInfo()
	p.outro(pc.green('✅ All daemon and dashboard processes stopped.'))
}
