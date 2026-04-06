import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

async function getDaemonUrl(): Promise<string | null> {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str) as { port?: number }
		return info.port ? `http://127.0.0.1:${info.port}` : null
	} catch { return null }
}

export async function GET(_req: Request, context: { params: Promise<{ id: string; execId: string }> }) {
	const { id, execId } = await context.params
	const daemonUrl = await getDaemonUrl()
	if (!daemonUrl) return new Response('Daemon not running', { status: 503 })

	const upstream = await fetch(`${daemonUrl}/kanban/${id}/executions/${execId}/stream`)
	if (!upstream.ok || !upstream.body) return new Response('Stream not available', { status: 404 })

	return new Response(upstream.body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
		},
	})
}
