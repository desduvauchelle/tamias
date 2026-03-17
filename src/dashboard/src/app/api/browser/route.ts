import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')
export const dynamic = 'force-dynamic'

async function getDaemonPort(): Promise<number | null> {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		return info.port || null
	} catch {
		return null
	}
}

export async function GET() {
	const port = await getDaemonPort()
	if (!port) {
		return NextResponse.json({ installed: false, headedOpen: false, daemonOffline: true })
	}
	try {
		const res = await fetch(`http://127.0.0.1:${port}/browser/status`, {
			signal: AbortSignal.timeout(3000),
		})
		if (!res.ok) {
			return NextResponse.json({ installed: false, headedOpen: false, daemonOffline: true })
		}
		return NextResponse.json(await res.json())
	} catch {
		return NextResponse.json({ installed: false, headedOpen: false, daemonOffline: true })
	}
}

export async function POST(request: Request) {
	const port = await getDaemonPort()
	if (!port) {
		return NextResponse.json({ ok: false, message: 'Daemon is offline' }, { status: 503 })
	}
	try {
		const body = await request.json() as { action: 'launch' | 'close'; url?: string }
		const { action, ...rest } = body
		if (action !== 'launch' && action !== 'close') {
			return NextResponse.json({ ok: false, message: 'Invalid action' }, { status: 400 })
		}
		const res = await fetch(`http://127.0.0.1:${port}/browser/${action}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(rest),
			signal: AbortSignal.timeout(10000),
		})
		return NextResponse.json(await res.json())
	} catch (err) {
		return NextResponse.json({ ok: false, message: String(err) }, { status: 502 })
	}
}
