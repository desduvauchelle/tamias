import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync } from 'fs'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const daemonFile = join(homedir(), '.tamias', 'daemon.json')
		if (!existsSync(daemonFile)) throw new Error('No daemon file')

		const info = JSON.parse(readFileSync(daemonFile, 'utf-8'))
		const port = info.port || 9001

		const res = await fetch(`http://127.0.0.1:${port}/usage`, { cache: 'no-store' })
		if (!res.ok) throw new Error('Daemon returned ' + res.status)

		const data = await res.json()
		return NextResponse.json(data)
	} catch (error) {
		console.error('API /costs proxy error:', error)
		return NextResponse.json({ today: 0, yesterday: 0, thisWeek: 0, thisMonth: 0, total: 0 })
	}
}
