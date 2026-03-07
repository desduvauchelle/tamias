
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export async function POST(req: Request) {
	try {
		const body = await req.json()

		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return new Response(JSON.stringify({ error: 'Daemon not running' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
		}

		const daemonUrl = `http://127.0.0.1:${info.port}`

		// 1. Ensure the project session exists (idempotent)
		if (body.projectId) {
			await fetch(`${daemonUrl}/session`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: `project-${body.projectId}` })
			}).catch(() => {/* ignore — daemon might not have this endpoint */ })
		}

		// 2. Forward the project event to daemon
		const res = await fetch(`${daemonUrl}/project-event`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})

		if (!res.ok) {
			const text = await res.text()
			return new Response(JSON.stringify({ error: `Daemon error: ${text}` }), { status: res.status, headers: { 'Content-Type': 'application/json' } })
		}

		return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
	} catch (err: unknown) {
		console.error('Project-event API Error:', err)
		return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
	}
}
