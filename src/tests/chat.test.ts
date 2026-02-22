import { expect, test, describe, spyOn, beforeEach } from "bun:test"
import { AIService } from "../services/aiService"
import { BridgeManager } from "../bridge"

describe("AIService", () => {
	let aiService: AIService
	let bridgeManager: BridgeManager

	beforeEach(() => {
		bridgeManager = new BridgeManager()
		aiService = new AIService(bridgeManager)
	})

	test("should create a session with custom ID", () => {
		const sessionId = "custom-test-session"
		const session = aiService.createSession({ id: sessionId })

		expect(session.id).toBe(sessionId)
		expect(aiService.getSession(sessionId)).toBeDefined()
	})

	test("should generate unique session IDs if none provided", () => {
		const s1 = aiService.createSession({})
		const s2 = aiService.createSession({})

		expect(s1.id).not.toBe(s2.id)
		expect(s1.id.startsWith("sess_")).toBe(true)
	})

	test("should list all sessions", () => {
		aiService.createSession({ id: "s1" })
		aiService.createSession({ id: "s2" })

		const sessions = aiService.getAllSessions()
		expect(sessions.length).toBe(2)
		expect(sessions.map(s => s.id)).toContain("s1")
		expect(sessions.map(s => s.id)).toContain("s2")
	})

	test("should delete a session", () => {
		aiService.createSession({ id: "delete-me" })
		expect(aiService.getSession("delete-me")).toBeDefined()

		aiService.deleteSession("delete-me")
		expect(aiService.getSession("delete-me")).toBeUndefined()
	})

	test("should reuse sessions for bridge identifiers", () => {
		const channelId = "discord"
		const channelUserId = "user123"

		const s1 = aiService.createSession({ channelId, channelUserId })
		const s2 = aiService.getSessionForBridge(channelId, channelUserId)

		expect(s1.id).toBe(s2!.id)
	})
})
