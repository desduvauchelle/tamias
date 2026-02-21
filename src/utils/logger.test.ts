import { expect, test, describe } from "bun:test"
import { logAiRequest } from "./logger.ts"
import { db } from "./db.ts"

describe("Logger", () => {
	test("appends AI request correctly to SQLite and handles Vercel AI SDK token extraction", () => {
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

		const initialCount = db.query<{ count: number }, [string]>('SELECT COUNT(*) as count FROM ai_logs WHERE sessionId = ?').get('test-logger-session')?.count || 0

		logAiRequest(payload)

		const afterCount = db.query<{ count: number }, [string]>('SELECT COUNT(*) as count FROM ai_logs WHERE sessionId = ?').get('test-logger-session')?.count || 0

		// Check log length increased by 1
		expect(afterCount).toBe(initialCount + 1)

		const lastLog = db.query<any, [string]>('SELECT * FROM ai_logs WHERE sessionId = ? ORDER BY id DESC LIMIT 1').get('test-logger-session')

		expect(lastLog.sessionId).toBe("test-logger-session")
		expect(lastLog.model).toBe("test-model-42")
		expect(lastLog.promptTokens).toBe(120)
		expect(lastLog.completionTokens).toBe(45)
		expect(lastLog.durationMs).toBe(150)

		// Cleanup: remove the test row we just inserted
		db.prepare('DELETE FROM ai_logs WHERE id = ?').run(lastLog.id)
	})
})
