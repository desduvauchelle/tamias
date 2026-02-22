import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

export async function POST(req: Request) {
	try {
		const { searchParams } = new URL(req.url)
		const sessionId = searchParams.get('sessionId')
		const { messages } = await req.json()
		const lastMessage = messages[messages.length - 1]?.content

		if (!sessionId || !lastMessage) {
			return NextResponse.json({ error: 'Missing sessionId or message content' }, { status: 400 })
		}

		// Get daemon port
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) {
			return NextResponse.json({ error: 'Daemon not running' }, { status: 503 })
		}

		const daemonUrl = `http://127.0.0.1:${info.port}`

		// Helper to send message
		const sendMessageToDaemon = async () => {
			return fetch(`${daemonUrl}/message`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, content: lastMessage })
			})
		}

		// 1. Send message to daemon
		let msgRes = await sendMessageToDaemon()

		// If session not found, create it and retry
		if (msgRes.status === 404 || (msgRes.status === 500)) {
			// Try to create session with this ID
			await fetch(`${daemonUrl}/session`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sessionId })
			})
			// Retry sending message
			msgRes = await sendMessageToDaemon()
		}

		if (!msgRes.ok) {
			const error = await msgRes.text()
			return NextResponse.json({ error: `Daemon error: ${error}` }, { status: msgRes.status })
		}

		// 2. Connect to stream
		const streamRes = await fetch(`${daemonUrl}/session/${sessionId}/stream`)
		if (!streamRes.ok || !streamRes.body) {
			return NextResponse.json({ error: 'Failed to connect to daemon stream' }, { status: 500 })
		}

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
		return NextResponse.json({ error: err.message }, { status: 500 })
	}
}
