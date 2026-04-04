import { NextResponse, NextRequest } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

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

export async function GET(request: NextRequest) {
	const port = await getDaemonPort()
	if (!port) return NextResponse.json({ error: 'Daemon not running' }, { status: 503 })

	try {
		const { searchParams } = new URL(request.url)
		const params = searchParams.toString()
		const res = await fetch(`http://127.0.0.1:${port}/vectors${params ? '?' + params : ''}`)
		const data = await res.json()
		return NextResponse.json(data, { status: res.status })
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 500 })
	}
}

export async function POST(request: NextRequest) {
	const port = await getDaemonPort()
	if (!port) return NextResponse.json({ error: 'Daemon not running' }, { status: 503 })

	try {
		const body = await request.json()
		const res = await fetch(`http://127.0.0.1:${port}/vectors`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		const data = await res.json()
		return NextResponse.json(data, { status: res.status })
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 500 })
	}
}

export async function DELETE(request: NextRequest) {
	const port = await getDaemonPort()
	if (!port) return NextResponse.json({ error: 'Daemon not running' }, { status: 503 })

	try {
		const { searchParams } = new URL(request.url)
		const id = searchParams.get('id')
		const res = await fetch(`http://127.0.0.1:${port}/vectors?id=${id}`, { method: 'DELETE' })
		const data = await res.json()
		return NextResponse.json(data, { status: res.status })
	} catch (err) {
		return NextResponse.json({ error: String(err) }, { status: 500 })
	}
}
