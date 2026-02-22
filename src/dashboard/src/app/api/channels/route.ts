import { NextResponse } from 'next/server'
import { getTamiasConfig, saveTamiasConfig, getTamiasEnv, setTamiasEnvVar } from '../tamias'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const config = await getTamiasConfig()
		const env = await getTamiasEnv()
		const bridges = config.bridges || { terminal: { enabled: true } }

		// Hydrate with API keys if present
		if (bridges.discord && bridges.discord.envKeyName) {
			bridges.discord.botToken = env[bridges.discord.envKeyName] ? "[REDACTED]" : ""
		}
		if (bridges.telegram && bridges.telegram.envKeyName) {
			bridges.telegram.botToken = env[bridges.telegram.envKeyName] ? "[REDACTED]" : ""
		}

		return NextResponse.json({ bridges })
	} catch (error) {
		return NextResponse.json({ bridges: { terminal: { enabled: true } } })
	}
}

export async function POST(request: Request) {
	try {
		const { bridges } = await request.json()
		const config = await getTamiasConfig()

		if (!config.bridges) config.bridges = { terminal: { enabled: true } }

		// Handle Discord update
		if (bridges.discord) {
			const { botToken, ...discordData } = bridges.discord
			if (botToken && botToken !== "[REDACTED]") {
				const envKey = 'TAMIAS_DISCORD_BOT_TOKEN'
				await setTamiasEnvVar(envKey, botToken)
				discordData.envKeyName = envKey
			} else if (config.bridges.discord?.envKeyName) {
				discordData.envKeyName = config.bridges.discord.envKeyName
			}
			config.bridges.discord = discordData
		} else {
			delete config.bridges.discord
		}

		// Handle Telegram update
		if (bridges.telegram) {
			const { botToken, ...telegramData } = bridges.telegram
			if (botToken && botToken !== "[REDACTED]") {
				const envKey = 'TAMIAS_TELEGRAM_BOT_TOKEN'
				await setTamiasEnvVar(envKey, botToken)
				telegramData.envKeyName = envKey
			} else if (config.bridges.telegram?.envKeyName) {
				telegramData.envKeyName = config.bridges.telegram.envKeyName
			}
			config.bridges.telegram = telegramData
		} else {
			delete config.bridges.telegram
		}

		await saveTamiasConfig(config)
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update channels configuration' }, { status: 500 })
	}
}
