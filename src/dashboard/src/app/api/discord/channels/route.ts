import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export async function GET() {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return NextResponse.json({ channels: [], daemonRunning: false })
		}

		const res = await fetch(`http://127.0.0.1:${info.port}/discord-channels`)
		const data = await res.json()
		return NextResponse.json({
			channels: Array.isArray(data.channels) ? data.channels : [],
			daemonRunning: true,
		}, { status: res.status })
	} catch (e) {
		return NextResponse.json({ channels: [], daemonRunning: false })
	}
}
