import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return NextResponse.json({ models: [], error: 'Daemon not running' }, { status: 503 })
		}

		const { searchParams } = new URL(request.url)
		const connection = searchParams.get('connection') ?? ''
		const qs = connection ? `?connection=${encodeURIComponent(connection)}` : ''

		const res = await fetch(`http://127.0.0.1:${info.port}/ollama/models${qs}`, {
			signal: AbortSignal.timeout(5000),
		})
		const data = await res.json()
		return NextResponse.json(data, { status: res.status })
	} catch (err) {
		return NextResponse.json({ models: [], error: String(err) }, { status: 500 })
	}
}
