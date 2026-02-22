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

	const statusLines = [
		'',
		`  ${pc.green('●')} Daemon is ${pc.green('running')}`,
		`  Port:      ${pc.bold(String(info.port))}`,
		`  Dashboard: ${pc.cyan(info.dashboardPort ? `http://localhost:${info.dashboardPort}` : 'Not running')}`,
		`  PID:       ${info.pid}`,
		`  Uptime:    ${uptime}`,
		`  Started:   ${new Date(info.startedAt).toLocaleTimeString()}`,
	]
	console.log(statusLines.join('\n'))

	try {
		const res = await fetch(`${getDaemonUrl()}/sessions`)
		const sessions = await res.json() as Array<{ id: string; name?: string; summary?: string; model: string; queueLength: number, updatedAt: string }>
		console.log(`\n  Sessions: ${pc.bold(String(sessions.length))}\n`)
		for (const s of sessions) {
			const name = s.name || s.id
			const summarySnippet = s.summary ? pc.dim(` — ${s.summary.slice(0, 50)}...`) : ''
			const updatedTime = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			console.log(`    ${pc.cyan(name.padEnd(20))} ${pc.dim(s.model.padEnd(30))} ${pc.green(updatedTime)}${summarySnippet}`)
		}
	} catch (err) {
		console.log(pc.dim('\n  Could not fetch sessions: ' + err))
	}

	// Diagnostic info from /debug — shows version and connection health
	try {
		const dbgRes = await fetch(`${getDaemonUrl()}/debug`)
		const dbg = await dbgRes.json() as {
			version: string; execPath: string; verboseMode: boolean;
			connections: string[]; defaultModels: string[];
			sessions: Array<{ id: string; connectionNickname: string; connectionExistsInConfig: boolean }>
		}
		const staleSessions = dbg.sessions.filter(s => !s.connectionExistsInConfig)
		console.log(`\n  ${pc.bold('Daemon diagnostics')}`)
		console.log(`    Version:     ${pc.cyan(`v${dbg.version}`)}`)
		console.log(`    Binary:      ${pc.dim(dbg.execPath)}`)
		console.log(`    Verbose:     ${dbg.verboseMode ? pc.green('yes (TAMIAS_DEBUG=1)') : pc.dim('no')}`)
		console.log(`    Connections: ${dbg.connections.length > 0 ? pc.green(dbg.connections.join(', ')) : pc.red('NONE')}`)
		console.log(`    Defaults:    ${dbg.defaultModels.length > 0 ? dbg.defaultModels.join(', ') : pc.yellow('not set')}`)
		if (staleSessions.length > 0) {
			console.log(pc.red(`\n  ⚠️  ${staleSessions.length} session(s) with missing connections:`))
			for (const s of staleSessions) {
				console.log(pc.red(`      ${s.id} — connection "${s.connectionNickname}" not in config`))
			}
			console.log(pc.yellow(`     Run: tamias stop && tamias start  (to heal them)`))
		}
	} catch {
		// /debug endpoint may not exist on older daemons — silent fallback
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
