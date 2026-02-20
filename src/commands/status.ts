import * as p from '@clack/prompts'
import pc from 'picocolors'
import { isDaemonRunning, readDaemonInfo, getDaemonUrl } from '../utils/daemon.ts'

export const runStatusCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Status ')))

	const running = await isDaemonRunning()
	const info = readDaemonInfo()

	if (!running || !info) {
		p.outro(pc.yellow('Daemon is NOT running. Start it with `tamias start`.'))
		return
	}

	const uptimeMs = Date.now() - new Date(info.startedAt).getTime()
	const uptime = formatUptime(uptimeMs)

	console.log([
		'',
		`  ${pc.green('●')} Daemon is ${pc.green('running')}`,
		`  Port:    ${pc.bold(String(info.port))}`,
		`  PID:     ${info.pid}`,
		`  Uptime:  ${uptime}`,
		`  Started: ${new Date(info.startedAt).toLocaleTimeString()}`,
	].join('\n'))

	try {
		const res = await fetch(`${getDaemonUrl()}/sessions`)
		const sessions = await res.json() as Array<{ id: string; model: string; queueLength: number }>
		console.log(`\n  Active sessions: ${pc.bold(String(sessions.length))}\n`)
		for (const s of sessions) {
			console.log(`    ${pc.cyan(s.id)}  ${pc.dim(s.model)}  queue: ${s.queueLength}`)
		}
	} catch {
		console.log(pc.dim('\n  Could not fetch sessions.'))
	}

	console.log('')
	p.outro(pc.dim(`Daemon URL: http://127.0.0.1:${info.port}`))
}

function formatUptime(ms: number): string {
	const s = Math.floor(ms / 1000)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m ${s % 60}s`
	const h = Math.floor(m / 60)
	return `${h}h ${m % 60}m`
}
