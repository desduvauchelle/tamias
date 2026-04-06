import { expect, test, describe, spyOn, beforeEach, afterEach } from "bun:test"
import { POST } from "../dashboard/src/app/api/chat/route"
import { join } from 'path'
import { homedir } from 'os'
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs'

describe("Chat Proxy API", () => {
	const DAEMON_DIR = join(homedir(), '.tamias')
	const DAEMON_FILE = join(DAEMON_DIR, 'daemon.json')

	beforeEach(() => {
		if (!existsSync(DAEMON_DIR)) mkdirSync(DAEMON_DIR, { recursive: true })
		writeFileSync(DAEMON_FILE, JSON.stringify({ port: 9001 }))
	})

	afterEach(() => {
		if (existsSync(DAEMON_FILE)) unlinkSync(DAEMON_FILE)
	})

	test("should handle missing sessionId or messages", async () => {
		const req = new Request("http://localhost/api/chat", {
			method: "POST",
			body: JSON.stringify({ messages: [] })
		})
		const res = await POST(req)
		expect(res.status).toBe(400)
	})

	test("should transform daemon SSE to AI SDK format", async () => {
		const sessionId = "test-sess"
		const messages = [{ role: "user", content: "hello" }]

		// Mock global fetch
		const originalFetch = global.fetch
		global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			const urlStr = url.toString()

			// Mock session creation
			if (urlStr.endsWith("/session")) {
				return new Response(JSON.stringify({ ok: true }))
			}

			// Mock message sending
			if (urlStr.endsWith("/message")) {
				return new Response(JSON.stringify({ ok: true }))
			}

			// Mock streaming
			if (urlStr.includes("/stream")) {
				const stream = new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder()
						controller.enqueue(encoder.encode('data: {"type":"chunk","text":"Hello"}\n\n'))
						controller.enqueue(encoder.encode('data: {"type":"tool_call","name":"ls","input":{}}\n\n'))
						controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
						controller.close()
					}
				})
				return new Response(stream)
			}

			return new Response("Not found", { status: 404 })
		}) as any

		const req = new Request(`http://localhost/api/chat?sessionId=${sessionId}`, {
			method: "POST",
			body: JSON.stringify({ messages })
		})

		const res = await POST(req)
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toContain("text/event-stream")

		const body = await res.text()
		const events = body
			.split("\n\n")
			.map(chunk => chunk.trim())
			.filter(Boolean)
			.map(chunk => chunk.startsWith("data: ") ? chunk.slice(6) : chunk)

		expect(events[0]).toBe('{"type":"start"}')
		expect(events[1]).toBe('{"type":"start-step"}')
		expect(events).toContain('{"type":"text-start","id":"text-1"}')
		expect(events).toContain('{"type":"text-delta","id":"text-1","delta":"Hello"}')

		const toolInputStart = events
			.map(event => event === "[DONE]" ? null : JSON.parse(event))
			.find(event => event?.type === "tool-input-start")
		expect(toolInputStart).toMatchObject({ type: "tool-input-start", toolName: "ls" })

		expect(events).toContain('{"type":"tool-input-available","toolCallId":"' + toolInputStart.toolCallId + '","toolName":"ls","input":{}}')
		expect(events).toContain('{"type":"tool-output-available","toolCallId":"' + toolInputStart.toolCallId + '","output":null}')
		expect(events).toContain('{"type":"text-end","id":"text-1"}')
		expect(events).toContain('{"type":"finish-step"}')
		expect(events).toContain('{"type":"finish","finishReason":"stop"}')
		expect(events[events.length - 1]).toBe("[DONE]")

		global.fetch = originalFetch
	})
})
