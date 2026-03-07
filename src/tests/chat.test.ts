import { expect, test, describe } from "bun:test"

// Simulating the extraction logic from src/dashboard/src/app/api/chat/route.ts
function extractLastMessage(body: any): string {
	let lastMessage = ''
	if (Array.isArray(body.messages) && body.messages.length > 0) {
		const last = body.messages[body.messages.length - 1]
		if (typeof last?.content === 'string') {
			lastMessage = last.content
		} else if (Array.isArray(last?.content)) {
			// Nested parts: [{type:'text', text:'...'}, ...]
			lastMessage = last.content
				.filter((p: any) => p.type === 'text' && p.text)
				.map((p: any) => p.text)
				.join('\n')
		} else if (last?.text) {
			lastMessage = last.text
		}
	} else if (body.text) {
		lastMessage = body.text
	} else if (body.content) {
		lastMessage = body.content
	}
	return lastMessage
}

describe("Chat API Text Extraction", () => {
	test("extracts from simple string content array", () => {
		const body = {
			messages: [
				{ role: "user", content: "Hello there" }
			]
		}
		expect(extractLastMessage(body)).toBe("Hello there")
	})

	test("extracts from nested part array (@ai-sdk/react format)", () => {
		const body = {
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "This is part 1" },
						{ type: "image", url: "http://example.com/img.png" },
						{ type: "text", text: "This is part 2" }
					]
				}
			]
		}
		expect(extractLastMessage(body)).toBe("This is part 1\nThis is part 2")
	})

	test("extracts from plain text body", () => {
		const body = { text: "Direct message" }
		expect(extractLastMessage(body)).toBe("Direct message")
	})

	test("extracts from older SDK format with text property", () => {
		const body = {
			messages: [
				{ role: "user", text: "Old format message" }
			]
		}
		expect(extractLastMessage(body)).toBe("Old format message")
	})

	test("returns empty string if nothing matches", () => {
		const body = {
			messages: [
				{ role: "user", content: [{ type: "image", url: "foo.png" }] }
			]
		}
		expect(extractLastMessage(body)).toBe("")
	})
})
