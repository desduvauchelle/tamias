import * as p from '@clack/prompts'
import pc from 'picocolors'
import { runStopCommand } from './stop.ts'
import { runStartCommand } from './start.ts'
import { isDaemonRunning } from '../utils/daemon.ts'

export const runRestartCommand = async (opts: { verbose?: boolean } = {}) => {
	p.intro(pc.bgCyan(pc.black(' Tamias — Restarting Daemon ')))

	if (await isDaemonRunning()) {
		await runStopCommand()
		// Wait a bit for processes to fully release ports
		await new Promise(r => setTimeout(r, 1000))
	} else {
		p.note('Daemon was not running, starting it now...', 'Status')
	}

	await runStartCommand({ daemon: false, verbose: opts.verbose })
}
