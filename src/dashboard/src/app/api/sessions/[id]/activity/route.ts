import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export const dynamic = 'force-dynamic'

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params
	try {
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return new Response(`data: ${JSON.stringify({ type: 'error', message: 'Daemon not running' })}\n\n`, {
				headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
			})
		}

		const daemonUrl = `http://127.0.0.1:${info.port}`
		const streamRes = await fetch(`${daemonUrl}/session/${id}/stream`)
		if (!streamRes.ok || !streamRes.body) {
			return new Response(`data: ${JSON.stringify({ type: 'error', message: 'Stream unavailable' })}\n\n`, {
				headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
			})
		}

		// Pass the raw daemon SSE stream through unchanged
		return new Response(streamRes.body, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'X-Accel-Buffering': 'no',
			}
		})
	} catch (err) {
		return new Response(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`, {
			headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
		})
	}
}
