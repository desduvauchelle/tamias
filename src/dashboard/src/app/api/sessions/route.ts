import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		// Get daemon port
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return NextResponse.json({ sessions: [] })
		}

		// Proxy sessions from daemon
		const res = await fetch(`http://127.0.0.1:${info.port}/sessions`)
		if (!res.ok) {
			return NextResponse.json({ sessions: [] })
		}

		const sessions = await res.json()
		// Wrap in object as expected by dashboard page.tsx
		return NextResponse.json({ sessions })
	} catch (err) {
		console.error('Failed to fetch sessions:', err)
		return NextResponse.json({ sessions: [] })
	}
}
