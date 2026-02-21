import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile, unlink } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')
export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)

		if (!info.port) {
			return NextResponse.json({ running: false, pid: null, uptimeSec: null })
		}

		// Ping the daemon to be absolutely sure it's responsive
		try {
			const res = await fetch(`http://127.0.0.1:${info.port}/health`, {
				signal: AbortSignal.timeout(1000)
			})
			if (res.ok) {
				const uptimeSec = Math.floor((Date.now() - new Date(info.startedAt).getTime()) / 1000)
				return NextResponse.json({ running: true, pid: info.pid, uptimeSec })
			}
		} catch { }

		// If ping failed, clean up stale file
		await unlink(DAEMON_FILE).catch(() => { })
		return NextResponse.json({ running: false, pid: null, uptimeSec: null })
	} catch {
		return NextResponse.json({ running: false, pid: null, uptimeSec: null })
	}
}
