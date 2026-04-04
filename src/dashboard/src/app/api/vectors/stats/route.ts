import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) return NextResponse.json({ error: 'Daemon not running' }, { status: 503 })

		const res = await fetch(`http://127.0.0.1:${info.port}/vectors/stats`)
		const data = await res.json()
		return NextResponse.json(data, { status: res.status })
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 500 })
	}
}
