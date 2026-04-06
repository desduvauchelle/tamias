import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

async function getDaemonUrl(): Promise<string | null> {
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str) as { port?: number }
		return info.port ? `http://127.0.0.1:${info.port}` : null
	} catch { return null }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
	const { id, taskId } = await context.params
	const daemonUrl = await getDaemonUrl()
	if (!daemonUrl) return NextResponse.json({ error: 'Daemon not running' }, { status: 503 })

	try {
		const body = await req.json()
		const res = await fetch(`${daemonUrl}/kanban/${id}/tasks/${taskId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		if (!res.ok) return NextResponse.json({ error: 'Failed to update task' }, { status: res.status })
		const data = await res.json()
		return NextResponse.json(data)
	} catch (err: unknown) {
		return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
	}
}
