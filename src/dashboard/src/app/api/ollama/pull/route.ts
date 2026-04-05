import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return NextResponse.json({ error: 'Daemon not running' }, { status: 503 })
		}

		const body = await request.json()
		const res = await fetch(`http://127.0.0.1:${info.port}/ollama/pull`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})

		if (!res.ok) {
			const data = await res.json().catch(() => ({ error: 'Pull failed' }))
			return NextResponse.json(data, { status: res.status })
		}

		// Forward NDJSON stream
		return new Response(res.body, {
			status: 200,
			headers: {
				'Content-Type': 'application/x-ndjson',
				'Cache-Control': 'no-cache',
			},
		})
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 500 })
	}
}
