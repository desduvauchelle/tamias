import * as p from '@clack/prompts'
import pc from 'picocolors'
import { readDaemonInfo, clearDaemonInfo, isDaemonRunning, getDaemonUrl } from '../utils/daemon.ts'

export const runStopCommand = async () => {
	p.intro(pc.bgRed(pc.white(' Tamias — Stop Daemon ')))

	const running = await isDaemonRunning()
	if (!running) {
		p.cancel(pc.yellow('Daemon is not running.'))
		process.exit(0)
	}

	try {
		await fetch(`${getDaemonUrl()}/daemon`, { method: 'DELETE' })
		clearDaemonInfo()
		p.outro(pc.green('✅ Daemon stopped.'))
	} catch {
		// Possibly already dying — clean up the file anyway
		const info = readDaemonInfo()
		if (info) {
			try { process.kill(info.pid, 'SIGTERM') } catch { /* ignore */ }
			clearDaemonInfo()
		}
		p.outro(pc.yellow('Daemon stopped (killed by PID).'))
	}
}
