import { NextResponse } from 'next/server'
import { getTamiasConfig, saveTamiasConfig, getTamiasEnv, setTamiasEnvVar } from '../tamias'

export const dynamic = 'force-dynamic'

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
				if (botToken && botToken !== '[REDACTED]') {
					const envKey = `TAMIAS_DISCORD_BOT_TOKEN_${key.toUpperCase()}`
					await setTamiasEnvVar(envKey, botToken)
					rest.envKeyName = envKey
				} else if (config.bridges.discords[key]?.envKeyName) {
					rest.envKeyName = config.bridges.discords[key].envKeyName
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
				if (botToken && botToken !== '[REDACTED]') {
					const envKey = `TAMIAS_TELEGRAM_BOT_TOKEN_${key.toUpperCase()}`
					await setTamiasEnvVar(envKey, botToken)
					rest.envKeyName = envKey
				} else if (config.bridges.telegrams[key]?.envKeyName) {
					rest.envKeyName = config.bridges.telegrams[key].envKeyName
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
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update channels configuration' }, { status: 500 })
	}
}
