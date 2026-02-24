import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export async function POST(request: Request) {
	try {
		const { cronId, target } = await request.json()

		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return new Response(JSON.stringify({ error: 'Daemon is not running' }), {
				status: 503,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		const res = await fetch(`http://127.0.0.1:${info.port}/cron-test`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cronId, target }),
		})

		const data = await res.json()
		return new Response(JSON.stringify(data), {
			status: res.status,
			headers: { 'Content-Type': 'application/json' },
		})
	} catch (err) {
		return new Response(JSON.stringify({ error: String(err) }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
