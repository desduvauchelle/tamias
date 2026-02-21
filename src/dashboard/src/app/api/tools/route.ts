import { NextResponse } from 'next/server'
import { getTamiasConfig, saveTamiasConfig } from '../tamias'

export async function GET() {
	try {
		const config = await getTamiasConfig()
		return NextResponse.json({
			internalTools: config.internalTools || {},
			mcpServers: config.mcpServers || {},
		})
	} catch (error) {
		return NextResponse.json({ internalTools: {}, mcpServers: {} })
	}
}

export async function POST(request: Request) {
	try {
		const { internalTools, mcpServers } = await request.json()
		const config = await getTamiasConfig()

		if (internalTools) config.internalTools = internalTools
		if (mcpServers) config.mcpServers = mcpServers

		await saveTamiasConfig(config)
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update tools configuration' }, { status: 500 })
	}
}
