
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

		// Extract last message text.
		// @ai-sdk/react v3 sends UIMessages with parts: [{type:'text', text:'...'}]
		// Older formats used content (string or array) or text directly.
		let lastMessage = ''
		if (Array.isArray(body.messages) && body.messages.length > 0) {
			const last = body.messages[body.messages.length - 1]
			if (Array.isArray(last?.parts)) {
				// New @ai-sdk/react v3 UIMessage format: { parts: [{type:'text', text:'...'}] }
				lastMessage = last.parts
					.filter((p: { type: string; text?: string }) => p.type === 'text' && p.text)
					.map((p: { text: string }) => p.text)
					.join('\n')
			} else if (typeof last?.content === 'string') {
				lastMessage = last.content
			} else if (Array.isArray(last?.content)) {
				// Nested content parts: [{type:'text', text:'...'}, ...]
				lastMessage = last.content
					.filter((p: { type: string; text?: string }) => p.type === 'text' && p.text)
					.map((p: { text: string }) => p.text)
					.join('\n')
			} else if (last?.text) {
				lastMessage = last.text
			}
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
		fetch(`${daemonUrl}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId, content: lastMessage, attachments })
		}).then(async r => {
			if (!r.ok) console.error('Failed to send message:', await r.text())
		}).catch(err => console.error('Failed to send message:', err))

		// 4. Transform daemon SSE events → UIMessageChunk SSE events (for @ai-sdk/react v3 DefaultChatTransport)
		//
		// DefaultChatTransport.processResponseStream uses parseJsonEventStream (EventSourceParserStream):
		//   - expects: text/event-stream with lines `data: {json}\n\n`
		//   - each JSON must match uiMessageChunkSchema
		//
		// Daemon emits:  { type: 'chunk', text }  { type: 'tool_call', name, input }
		//                { type: 'file', buffer, mimeType, name }  { type: 'done' }  { type: 'error', message }
		const reader = streamRes.body.getReader()
		const decoder = new TextDecoder()
		const encoder = new TextEncoder()

		const stream = new ReadableStream({
			async start(controller) {
				let buffer = ''
				let textPartStarted = false
				const textPartId = 'text-1'
				let timeoutId: ReturnType<typeof setTimeout> | undefined

				const enqueue = (event: object | string) => {
					const data = typeof event === 'string' ? event : JSON.stringify(event)
					controller.enqueue(encoder.encode(`data: ${data}\n\n`))
				}

				const resetTimeout = () => {
					if (timeoutId) clearTimeout(timeoutId)
					timeoutId = setTimeout(() => {
						console.error('SSE Proxy stream timed out after 60s idle')
						controller.error(new Error('Stream timeout'))
						streamRes.body?.cancel()
					}, 60000)
				}

				resetTimeout()

				// Signal start of assistant response
				enqueue({ type: 'start' })
				enqueue({ type: 'start-step' })

				try {
					while (true) {
						const { done, value } = await reader.read()
						if (done) break

						resetTimeout()

						buffer += decoder.decode(value, { stream: true })
						const lines = buffer.split('\n')
						buffer = lines.pop() || ''

						for (const line of lines) {
							if (line.startsWith('data: ')) {
								let data: DaemonSSEEvent
								try { data = JSON.parse(line.slice(6)) as DaemonSSEEvent } catch { continue }

								if (data.type === 'chunk' && data.text) {
									if (!textPartStarted) {
										enqueue({ type: 'text-start', id: textPartId })
										textPartStarted = true
									}
									// Note: field is `delta` (not `textDelta`) in uiMessageChunkSchema
									enqueue({ type: 'text-delta', id: textPartId, delta: data.text })
								} else if (data.type === 'tool_call') {
									const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
									enqueue({ type: 'tool-input-start', toolCallId, toolName: data.name })
									enqueue({ type: 'tool-input-available', toolCallId, toolName: data.name, input: data.input })
									enqueue({ type: 'tool-output-available', toolCallId, output: null })
								} else if (data.type === 'file') {
									const raw = data.buffer ?? {}
									const byteArray: number[] =
										Array.isArray(raw) ? raw :
											Array.isArray((raw as { data?: number[] }).data) ? (raw as { data: number[] }).data :
												Object.values(raw as Record<string, number>)
									const base64 = Buffer.from(byteArray).toString('base64')
									const mimeType = data.mimeType ?? 'application/octet-stream'
									const url = `data:${mimeType};base64,${base64}`
									// Use data-* type to carry file name alongside the URL
									enqueue({ type: 'data-tamias-file', data: { name: data.name, mimeType, url } })
								} else if (data.type === 'done') {
									clearTimeout(timeoutId)
									if (textPartStarted) {
										enqueue({ type: 'text-end', id: textPartId })
									}
									enqueue({ type: 'finish-step' })
									enqueue({ type: 'finish', finishReason: 'stop' })
									enqueue('[DONE]')
									controller.close()
									return
								} else if (data.type === 'error') {
									enqueue({ type: 'error', errorText: data.message ?? 'Unknown error' })
									enqueue('[DONE]')
									controller.close()
									return
								}
							}
						}
					}
				} catch (err) {
					console.error('Proxy stream error:', err)
					controller.error(err)
				} finally {
					clearTimeout(timeoutId)
					controller.close()
				}
			}
		})

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
			}
		})

	} catch (err: unknown) {
		console.error('Chat API Error:', err)
		return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
	}
}
