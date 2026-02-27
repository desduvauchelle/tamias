import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { getTamiasConfig, saveTamiasConfig, getTamiasEnv, setTamiasEnvVar } from '../tamias'

export const dynamic = 'force-dynamic'
const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

async function restartDaemonIfRunning(): Promise<boolean> {
	try {
		const daemonRaw = await readFile(DAEMON_FILE, 'utf-8')
		const daemonInfo = JSON.parse(daemonRaw) as { port?: number }
		if (!daemonInfo.port) return false

		const health = await fetch(`http://127.0.0.1:${daemonInfo.port}/health`, {
			signal: AbortSignal.timeout(1000),
		})
		if (!health.ok) return false

		await fetch(`http://127.0.0.1:${daemonInfo.port}/daemon`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(3000),
		}).catch(() => { })

		const projectRoot = join(process.cwd(), '..', '..', '..')
		const cliEntry = join(projectRoot, 'src', 'index.ts')
		if (existsSync(cliEntry)) {
			const proc = spawn('bun', ['run', cliEntry, 'start'], {
				cwd: projectRoot,
				detached: true,
				stdio: 'ignore',
				env: process.env,
			})
			proc.unref()
		} else {
			const proc = spawn('tamias', ['start'], {
				detached: true,
				stdio: 'ignore',
				env: process.env,
			})
			proc.unref()
		}

		return true
	} catch {
		return false
	}
}

/** Migrate legacy single-instance config to multi-instance on read */
function migrateToMulti(bridges: any) {
	const out = { ...bridges }
	if (out.discord) {
		out.discords = { ...(out.discords ?? {}), default: out.discord }
		delete out.discord
	}
	if (out.telegram) {
		out.telegrams = { ...(out.telegrams ?? {}), default: out.telegram }
		delete out.telegram
	}
	return out
}

export async function GET() {
	try {
		const config = await getTamiasConfig()
		const env = await getTamiasEnv()
		const bridges = migrateToMulti(config.bridges || { terminal: { enabled: true } })

		// Hydrate discord instances — redact actual token value
		for (const [, cfg] of Object.entries(bridges.discords ?? {} as Record<string, any>)) {
			const c = cfg as any
			c.botToken = (c.envKeyName && env[c.envKeyName]) ? '[REDACTED]' : ''
		}
		// Hydrate telegram instances
		for (const [, cfg] of Object.entries(bridges.telegrams ?? {} as Record<string, any>)) {
			const c = cfg as any
			c.botToken = (c.envKeyName && env[c.envKeyName]) ? '[REDACTED]' : ''
		}

		return NextResponse.json({ bridges })
	} catch (error) {
		return NextResponse.json({ bridges: { terminal: { enabled: true }, discords: {}, telegrams: {} } })
	}
}

export async function POST(request: Request) {
	try {
		const { bridges } = await request.json()
		const config = await getTamiasConfig()

		if (!config.bridges) config.bridges = { terminal: { enabled: true } }

		// Persist terminal setting
		if (bridges.terminal !== undefined) {
			config.bridges.terminal = bridges.terminal
		}

		// Handle Discord instances
		if (bridges.discords !== undefined) {
			if (!config.bridges.discords) config.bridges.discords = {}
			for (const [key, instanceData] of Object.entries(bridges.discords as Record<string, any>)) {
				const { botToken, ...rest } = instanceData
				const existing = config.bridges.discords[key] ?? {}
				rest.mode = rest.mode ?? existing.mode ?? 'full'
				if (botToken && botToken !== '[REDACTED]') {
					const envKey = `TAMIAS_DISCORD_BOT_TOKEN_${key.toUpperCase()}`
					await setTamiasEnvVar(envKey, botToken)
					rest.envKeyName = envKey
				} else if (existing.envKeyName) {
					rest.envKeyName = existing.envKeyName
				}
				config.bridges.discords[key] = rest
			}
			// Remove instances that are no longer in the payload
			for (const key of Object.keys(config.bridges.discords)) {
				if (!(key in bridges.discords)) {
					delete config.bridges.discords[key]
				}
			}
		}

		// Handle Telegram instances
		if (bridges.telegrams !== undefined) {
			if (!config.bridges.telegrams) config.bridges.telegrams = {}
			for (const [key, instanceData] of Object.entries(bridges.telegrams as Record<string, any>)) {
				const { botToken, ...rest } = instanceData
				const existing = config.bridges.telegrams[key] ?? {}
				rest.mode = rest.mode ?? existing.mode ?? 'full'
				if (botToken && botToken !== '[REDACTED]') {
					const envKey = `TAMIAS_TELEGRAM_BOT_TOKEN_${key.toUpperCase()}`
					await setTamiasEnvVar(envKey, botToken)
					rest.envKeyName = envKey
				} else if (existing.envKeyName) {
					rest.envKeyName = existing.envKeyName
				}
				config.bridges.telegrams[key] = rest
			}
			// Remove instances that are no longer in the payload
			for (const key of Object.keys(config.bridges.telegrams)) {
				if (!(key in bridges.telegrams)) {
					delete config.bridges.telegrams[key]
				}
			}
		}

		// Clean up legacy single-instance fields if present
		delete config.bridges.discord
		delete config.bridges.telegram

		await saveTamiasConfig(config)
		const restartTriggered = await restartDaemonIfRunning()
		return NextResponse.json({ success: true, restartTriggered })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update channels configuration' }, { status: 500 })
	}
}
