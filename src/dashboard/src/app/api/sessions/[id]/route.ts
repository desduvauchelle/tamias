import { NextRequest, NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises' // Added import for readFile

export const dynamic = 'force-dynamic'

const DB_PATH = join(homedir(), '.tamias', 'data.sqlite')
const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json') // Added DAEMON_FILE constant

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const { id: sessionId } = await params

		// Get daemon port
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) throw new Error('Daemon not running')

		const res = await fetch(`http://127.0.0.1:${info.port}/session/${sessionId}/messages`, { cache: 'no-store' })
		if (!res.ok) throw new Error(`Daemon returned ${res.status}`)

		const data = await res.json()
		return NextResponse.json({ messages: data.messages || [] })
	} catch (error) {
		console.error(`Failed to load history:`, error)
		return NextResponse.json({ messages: [], error: String(error) })
	}
}
