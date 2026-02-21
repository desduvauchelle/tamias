import { NextResponse } from 'next/server'

export async function POST(req: Request) {
	// TODO: Proxy to Tamias daemon /message or /session/:id/stream
	return NextResponse.json({ error: 'Chat API not yet migrated to Tamias HTTP daemon.' }, { status: 501 })
}
