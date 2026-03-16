#!/usr/bin/env bun
/**
 * Local dev runner — starts the Tamias daemon and Next.js dashboard from this
 * repo's source, with full hot-reload. No GitHub push or re-install needed.
 *
 * Usage:  bun run dev:local
 *
 * What it does:
 *   1. Stops any running Tamias daemon (the installed one or a previous dev run)
 *   2. Starts `bun --watch src/index.ts start --daemon` — daemon restarts on any .ts change
 *   3. Waits for daemon.json to appear (daemon is up), reads port + auth token
 *   4. Starts `next dev` in src/dashboard — instant UI hot-reload via HMR
 *   5. Ctrl+C cleanly kills both
 */

import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const DASHBOARD_DIR = join(ROOT, 'src', 'dashboard')
const DAEMON_JSON = join(homedir(), '.tamias', 'daemon.json')

const c = {
	cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
	green: (s: string) => `\x1b[32m${s}\x1b[0m`,
	yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
	dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
	bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

console.log(c.cyan('\n🐿️  Tamias — local dev mode'))
console.log(c.dim('   Daemon: bun --watch  |  Dashboard: next dev\n'))

// ── 1. Stop any running daemon ────────────────────────────────────────────────
console.log(c.dim('→ Stopping any existing Tamias daemon...'))
Bun.spawnSync(
	['bun', 'run', 'src/index.ts', 'stop'],
	{ cwd: ROOT, stdout: 'pipe', stderr: 'pipe' }
)
await Bun.sleep(800)

// ── 2. Start daemon with file watching ────────────────────────────────────────
console.log(c.dim('→ Starting daemon from local source (bun --watch)...'))
const daemon = Bun.spawn(
	['bun', '--watch', 'src/index.ts', 'start', '--daemon'],
	{
		cwd: ROOT,
		// TAMIAS_NO_DASHBOARD: skip Next.js spawn inside the daemon — we manage it here
		// TAMIAS_DEV: keeps any dev-mode code paths active
		env: { ...process.env as Record<string, string>, TAMIAS_NO_DASHBOARD: 'true', TAMIAS_DEV: 'true' },
		stdout: 'inherit',
		stderr: 'inherit',
	}
)

// ── 3. Wait for daemon.json (daemon is ready) ─────────────────────────────────
console.log(c.dim('→ Waiting for daemon to come up...'))
let dashboardPort = 5678
let dashboardToken = ''

for (let i = 0; i < 40; i++) {
	await Bun.sleep(500)
	if (existsSync(DAEMON_JSON)) {
		try {
			const info = JSON.parse(readFileSync(DAEMON_JSON, 'utf8')) as {
				dashboardPort?: number
				token?: string
				port?: number
			}
			if (info.dashboardPort && info.port) {
				dashboardPort = info.dashboardPort
				dashboardToken = info.token ?? ''
				console.log(c.dim(`→ Daemon ready on port ${info.port}`))
				break
			}
		} catch { /* keep waiting */ }
	}
}

// ── 4. Start Next.js dashboard dev server ────────────────────────────────────
console.log(c.dim(`→ Starting Next.js dashboard on port ${dashboardPort}...`))
const dashboard = Bun.spawn(
	['bun', 'run', 'dev', '-p', String(dashboardPort)],
	{
		cwd: DASHBOARD_DIR,
		env: {
			...process.env as Record<string, string>,
			TAMIAS_DASHBOARD_TOKEN: dashboardToken,
			TAMIAS_DEV: 'true',
		},
		stdout: 'inherit',
		stderr: 'inherit',
	}
)

const dashboardUrl = `http://localhost:${dashboardPort}${dashboardToken ? `?token=${dashboardToken}` : ''}`
console.log(c.green(`\n✅ Dev servers running!\n`))
console.log(`   ${c.bold('Dashboard:')} ${c.cyan(dashboardUrl)}`)
console.log(`   ${c.bold('Daemon:')}    watching src/**/*.ts — restarts on change`)
console.log(`   ${c.bold('Dashboard:')} Next.js HMR — instant UI hot-reload`)
console.log(c.dim('\n   Press Ctrl+C to stop both servers\n'))

// ── 5. Graceful shutdown on Ctrl+C ───────────────────────────────────────────
const shutdown = () => {
	process.stdout.write(c.yellow('\n→ Shutting down dev servers...\n'))
	try { daemon.kill() } catch { }
	try { dashboard.kill() } catch { }
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Block main thread until something exits (then clean up the other)
await Promise.race([daemon.exited, dashboard.exited])
shutdown()
