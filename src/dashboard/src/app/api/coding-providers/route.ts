import { NextResponse } from 'next/server'
import { getTamiasConfig, saveTamiasConfig } from '../tamias'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const config = await getTamiasConfig()
		return NextResponse.json({
			codingProviders: config.codingProviders || [],
		})
	} catch {
		return NextResponse.json({ codingProviders: [] })
	}
}

export async function POST(request: Request) {
	try {
		const { codingProviders } = await request.json()
		const config = await getTamiasConfig()

		config.codingProviders = codingProviders || []

		await saveTamiasConfig(config)
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update coding providers' }, { status: 500 })
	}
}
