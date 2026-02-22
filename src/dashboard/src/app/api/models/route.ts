import { NextResponse } from 'next/server'
import { getTamiasConfig, saveTamiasConfig, getTamiasEnv, setTamiasEnvVar } from '../tamias'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const config = await getTamiasConfig()
		const env = await getTamiasEnv()

		const connections = Object.entries(config.connections || {}).map(([nickname, conn]: [string, any]) => {
			const hasKey = conn.envKeyName && !!env[conn.envKeyName]
			return {
				...conn,
				apiKey: hasKey ? "[REDACTED]" : ""
			}
		})

		return NextResponse.json({
			connections,
			defaultModels: config.defaultModels || [],
			defaultConnection: config.defaultConnection || ''
		})
	} catch (error) {
		return NextResponse.json({ connections: [], defaultModel: '', defaultConnection: '' })
	}
}

export async function POST(request: Request) {
	try {
		const { connections, defaultModels, defaultConnection } = await request.json()
		const config = await getTamiasConfig()

		if (!config.connections) config.connections = {}

		for (const conn of connections) {
			const { nickname, apiKey, ...connData } = conn

			// Save or update key
			if (apiKey && apiKey !== "[REDACTED]") {
				const envKey = `TAMIAS_CONN_${nickname.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
				await setTamiasEnvVar(envKey, apiKey)
				connData.envKeyName = envKey
			} else if (config.connections[nickname]?.envKeyName) {
				// Keep existing key name if redacted
				connData.envKeyName = config.connections[nickname].envKeyName
			}

			config.connections[nickname] = { nickname, ...connData }
		}

		// Handle deletions
		const newNicknames = new Set(connections.map((c: any) => c.nickname))
		for (const oldNick of Object.keys(config.connections)) {
			if (!newNicknames.has(oldNick)) {
				const oldKey = config.connections[oldNick].envKeyName
				if (oldKey) await setTamiasEnvVar(oldKey, '') // delete from env
				delete config.connections[oldNick]
			}
		}

		if (defaultModels !== undefined) config.defaultModels = defaultModels
		if (defaultConnection !== undefined) config.defaultConnection = defaultConnection

		await saveTamiasConfig(config)
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update models configuration' }, { status: 500 })
	}
}
