import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

const TAMIAS_DIR = join(homedir(), '.tamias')
const DAEMON_FILE = join(TAMIAS_DIR, 'daemon.json')
const UPDATE_CACHE_FILE = join(TAMIAS_DIR, 'update-check.json')

export const dynamic = 'force-dynamic'

async function getDaemonPort(): Promise<number | null> {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		return info.port ?? null
	} catch {
		return null
	}
}

/** GET /api/update — return cached check result (daemon owns the 24h cache) */
export async function GET() {
	// If daemon is running, proxy to it (it owns the update-check.json cache)
	const port = await getDaemonPort()
	if (port) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/update`, {
				signal: AbortSignal.timeout(10000),
			})
			if (res.ok) {
				const data = await res.json()
				return NextResponse.json(data)
			}
		} catch { /* daemon unreachable, fall through to local cache */ }
	}

	// Fallback: read local cache
	if (existsSync(UPDATE_CACHE_FILE)) {
		try {
			const cached = JSON.parse(await readFile(UPDATE_CACHE_FILE, 'utf-8'))
			return NextResponse.json({ ...cached, daemonOffline: true })
		} catch { /* corrupt cache */ }
	}

	return NextResponse.json({ updateAvailable: false, daemonOffline: !port })
}

/** POST /api/update — trigger update via daemon */
export async function POST() {
	const port = await getDaemonPort()
	if (!port) {
		return NextResponse.json({ error: 'Daemon is not running' }, { status: 503 })
	}

	try {
		const res = await fetch(`http://127.0.0.1:${port}/update`, {
			method: 'POST',
			signal: AbortSignal.timeout(10000),
		})
		let data: unknown
		try {
			data = await res.json()
		} catch {
			data = { error: `Daemon returned non-JSON response (status ${res.status})` }
		}
		return NextResponse.json(data, { status: res.status })
	} catch (err) {
		return NextResponse.json({ error: `Failed to reach daemon: ${err}` }, { status: 503 })
	}
}
