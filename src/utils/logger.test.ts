import { expect, test, describe } from "bun:test"
import { logAiRequest, LOGS_ROOT } from "./logger.ts"
import { join } from "path"
import { existsSync, readFileSync, writeFileSync } from "fs"

describe("Logger", () => {
	const currentMonth = new Date().toISOString().slice(0, 7)
	const expectedFile = join(LOGS_ROOT, `${currentMonth}.jsonl`)

	test("appends AI request correctly and handles Vercel AI SDK token extraction", () => {
		// Mock the Vercel AI SDK usage object
		const mockVercelUsage = {
			inputTokens: 120,
			outputTokens: 45,
			totalTokens: 165
		}

		const payload = {
			timestamp: new Date().toISOString(),
			sessionId: "test-logger-session",
			model: "test-model-42",
			provider: "test-provider",
			action: "chat" as const,
			durationMs: 150,
			tokens: {
				prompt: mockVercelUsage.inputTokens,
				completion: mockVercelUsage.outputTokens,
				total: mockVercelUsage.totalTokens
			},
			messages: [],
			response: "test response"
		}

		const initialLength = existsSync(expectedFile) ? readFileSync(expectedFile, 'utf-8').trim().split('\n').filter(Boolean).length : 0

		logAiRequest(payload)

		expect(existsSync(expectedFile)).toBe(true)

		const content = readFileSync(expectedFile, 'utf-8')
		const lines = content.trim().split('\n').filter(Boolean)

		// Check log length increased by 1
		expect(lines.length).toBe(initialLength + 1)

		const lastLine = lines[lines.length - 1]
		const parsed = JSON.parse(lastLine!)

		expect(parsed.sessionId).toBe("test-logger-session")
		expect(parsed.model).toBe("test-model-42")
		expect(parsed.tokens.prompt).toBe(120)
		expect(parsed.tokens.completion).toBe(45)
		expect(parsed.durationMs).toBe(150)

		// Cleanup: remove the test line we just appended
		const cleaned = lines.filter(l => !l.includes('"sessionId":"test-logger-session"'))
		writeFileSync(expectedFile, cleaned.join('\n') + (cleaned.length ? '\n' : ''), 'utf-8')
	})
})
