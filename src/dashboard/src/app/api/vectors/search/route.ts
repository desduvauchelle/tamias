import { NextResponse, NextRequest } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) return NextResponse.json({ results: [] })

		const { searchParams } = new URL(request.url)
		const params = searchParams.toString()
		const res = await fetch(`http://127.0.0.1:${info.port}/vectors/search?${params}`)
		const data = await res.json()
		return NextResponse.json(data, { status: res.status })
	} catch {
		return NextResponse.json({ results: [] })
	}
}
