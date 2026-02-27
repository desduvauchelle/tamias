import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export async function GET() {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return new Response(JSON.stringify({ targets: [], daemonRunning: false }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		const res = await fetch(`http://127.0.0.1:${info.port}/cron-targets`)
		const data = await res.json()
		return new Response(JSON.stringify({
			targets: Array.isArray(data.targets) ? data.targets : [],
			daemonRunning: true,
		}), {
			status: res.status,
			headers: { 'Content-Type': 'application/json' },
		})
	} catch {
		return new Response(JSON.stringify({ targets: [], daemonRunning: false }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
