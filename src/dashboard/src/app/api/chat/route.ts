
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

interface DaemonSSEEvent {
	type: string
	text?: string
	name?: string
	input?: unknown
	buffer?: { data?: number[] } | number[] | Record<string, number>
	mimeType?: string
	message?: string
}

export async function POST(req: Request) {
	try {
		const { searchParams } = new URL(req.url)
		const sessionId = searchParams.get('sessionId')
		const body = await req.json()
		console.log('Chat API Request Body:', JSON.stringify({ ...body, data: body.data ? '[present]' : undefined }, null, 2))

		// Extract last message text
		let lastMessage = ''
		if (Array.isArray(body.messages)) {
			const last = body.messages[body.messages.length - 1]
			lastMessage = last?.content ?? last?.text ?? ''
		} else if (body.text) {
			lastMessage = body.text
		} else if (body.content) {
			lastMessage = body.content
		}

		// Attachments forwarded via the `data` field of sendMessage({ text, data: { attachments: [...] } })
		const attachments: Array<{ type: string; base64: string; mimeType: string; name: string }> =
			body.data?.attachments ?? []

		if (!sessionId || !lastMessage) {
			console.error('Missing sessionId or lastMessage. sessionId:', sessionId, 'lastMessage:', lastMessage)
			return new Response(JSON.stringify({ error: 'Missing sessionId or message content' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
		}

		// Get daemon port
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return new Response(JSON.stringify({ error: 'Daemon not running' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
		}

		const daemonUrl = `http://127.0.0.1:${info.port}`

		// 1. Ensure session exists (idempotent)
		const sessionResponse = await fetch(`${daemonUrl}/session`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: sessionId })
		})

		if (!sessionResponse.ok) {
			const error = await sessionResponse.text()
			return new Response(JSON.stringify({ error: `Failed to ensure session: ${error}` }), { status: sessionResponse.status, headers: { 'Content-Type': 'application/json' } })
		}

		// 2. Connect to stream FIRST so we don't miss any chunks
		const streamRes = await fetch(`${daemonUrl}/session/${sessionId}/stream`)
		if (!streamRes.ok || !streamRes.body) {
			return new Response(JSON.stringify({ error: 'Failed to connect to daemon stream' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
		}

		// 3. Send message (with optional attachments) asynchronously
		const sendMessagePromise = fetch(`${daemonUrl}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId, content: lastMessage, attachments })
		}).then(async r => {
			if (!r.ok) console.error('Failed to send message:', await r.text())
			return r
		})

		// 4. Transform SSE stream to AI SDK Data Stream format
		const reader = streamRes.body.getReader()
		const decoder = new TextDecoder()
		const encoder = new TextEncoder()

		const stream = new ReadableStream({
			async start(controller) {
				let buffer = ''
				try {
					while (true) {
						const { done, value } = await reader.read()
						if (done) break

						buffer += decoder.decode(value, { stream: true })
						const lines = buffer.split('\n')
						buffer = lines.pop() || ''

						for (const line of lines) {
							if (line.startsWith('data: ')) {
let data: DaemonSSEEvent
						try { data = JSON.parse(line.slice(6)) as DaemonSSEEvent } catch { continue }

								if (data.type === 'chunk') {
									// Text delta: 0:"text"\n
									controller.enqueue(encoder.encode(`0:${JSON.stringify(data.text)}\n`))
								} else if (data.type === 'tool_call') {
									// Tool invocation part (b:)
									const toolPart = {
										type: 'tool-invocation',
										toolCallId: `tc-${Date.now()}`,
										toolName: data.name,
										args: data.input,
										state: 'call'
									}
									controller.enqueue(encoder.encode(`b:${JSON.stringify(toolPart)}\n`))
								} else if (data.type === 'file') {
									// File from AI — send as data part (2:) with __tamias_file__ marker.
									// Buffer serialised over SSE JSON becomes { type:'Buffer', data:[...] }
									// in Node/Bun – extract the byte array from either format.
									const raw = data.buffer ?? {}
									const byteArray: number[] =
										Array.isArray(raw) ? raw :
											Array.isArray(raw.data) ? raw.data :
												Object.values(raw)
									const base64 = Buffer.from(byteArray).toString('base64')
									const filePart = {
										__tamias_file__: true,
										name: data.name,
										mimeType: data.mimeType ?? 'application/octet-stream',
										base64,
									}
									controller.enqueue(encoder.encode(`2:${JSON.stringify([filePart])}\n`))
								} else if (data.type === 'done') {
									controller.close()
									return
								} else if (data.type === 'error') {
									controller.enqueue(encoder.encode(`3:${JSON.stringify(data.message)}\n`))
								}
							}
						}
					}
				} catch (err) {
					console.error('Proxy stream error:', err)
					controller.error(err)
				} finally {
					controller.close()
				}
			}
		})

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
			}
		})

	} catch (err: unknown) {
		console.error('Chat API Error:', err)
		return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
	}
}
