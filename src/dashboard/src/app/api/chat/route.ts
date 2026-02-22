
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export async function POST(req: Request) {
	try {
		const { searchParams } = new URL(req.url)
		const sessionId = searchParams.get('sessionId')
		const body = await req.json()
		console.log('Chat API Request Body:', JSON.stringify(body, null, 2))

		let lastMessage = ''
		if (Array.isArray(body.messages)) {
			lastMessage = body.messages[body.messages.length - 1]?.content || body.messages[body.messages.length - 1]?.text || ''
		} else if (body.text) {
			lastMessage = body.text
		} else if (body.content) {
			lastMessage = body.content
		}

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

		// 3. Send message asynchronously (start it and then consume the stream)
		const sendMessagePromise = fetch(`${daemonUrl}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId, content: lastMessage })
		}).then(async r => {
			if (!r.ok) {
				const error = await r.text()
				console.error(`Failed to send message: ${error}`)
			}
			return r
		})

		// 3. Transform SSE stream to AI SDK "Data Stream" format
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
							if (line.startsWith('event: ')) {
								const eventType = line.slice(7).trim()
								continue
							}
							if (line.startsWith('data: ')) {
								const data = JSON.parse(line.slice(6))

								// Map Tamias daemon events to AI SDK protocol parts
								// Protocol Spec: https://sdk.vercel.ai/docs/reference/ai-sdk-core/data-stream-protocol
								if (data.type === 'chunk') {
									// Text part: 0:"text"\n
									controller.enqueue(encoder.encode(`0:${JSON.stringify(data.text)}\n`))
								} else if (data.type === 'tool_call') {
									// Data part for the UI to show execution status
									// We use the custom "parts" expectations from page.tsx
									// We can send this as "data" (2:) or "other" if we want it to be a part.
									// Actually, to make it show up in message.parts, we might need a specific format.
									// The dashboard page.tsx expects parts with type 'tool-' or 'dynamic-tool'.
									// Let's use 8: which is for "other" parts in some versions, or just use 2: (data).
									// Wait, AI SDK handles parts automatically if we use the right markers.
									// For now, let's use the 'data' part (2:) which is often accessible.
									// But UI wants it in 'parts'.
									// Let's use 9: (tool call) or 0: (text).
									// Actually, if we want to mimic the daemon's internal 'parts', we can send a
									// custom part if the SDK version supports it.
									// Let's try sending it as a tool call part (9: or b:)
									// Actually 9: is "tool call" in the newer protocol.
									const toolPart = {
										type: 'tool-invocation', // Standard AI SDK type
										toolCallId: `tc-${Date.now()}`,
										toolName: data.name,
										args: data.input,
										state: 'call'
									}
									controller.enqueue(encoder.encode(`b:${JSON.stringify(toolPart)}\n`))
								} else if (data.type === 'done') {
									// Optional: send message completion
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

	} catch (err: any) {
		console.error('Chat API Error:', err)
		return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
	}
}
