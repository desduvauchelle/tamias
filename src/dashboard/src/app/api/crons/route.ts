import { NextResponse } from 'next/server'
import { getTamiasCrons, saveTamiasCrons } from '../tamias'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const crons = await getTamiasCrons()
		return NextResponse.json({ crons: Array.isArray(crons) ? crons : [] })
	} catch (error) {
		return NextResponse.json({ crons: [] })
	}
}

export async function POST(request: Request) {
	try {
		const { crons } = await request.json()
		await saveTamiasCrons(crons || [])
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update crons' }, { status: 500 })
	}
}
