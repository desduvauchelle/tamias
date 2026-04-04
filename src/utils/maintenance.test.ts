import { expect, test, describe, beforeEach } from "bun:test"
import { db } from "./db"
import { runDatabaseMaintenance } from "./maintenance"

/**
 * REFINED DATABASE MAINTENANCE TESTS
 * Focus: Granular validation of log pruning, 30-day archiving to SQLite, and session TTL.
 */

describe("Database Maintenance: Pruning & Archive", () => {
	beforeEach(() => {
		db.exec("DELETE FROM ai_logs")
		db.exec("DELETE FROM ai_logs_archive")
		db.exec("DELETE FROM sessions")
	})

	test("Case 1: Logs from 'Today' remain fully detailed", async () => {
		const today = new Date().toISOString()
		db.prepare(`
            INSERT INTO ai_logs (timestamp, sessionId, model, provider, action, durationMs, promptTokens, completionTokens, totalTokens, requestMessagesJson, response)
            VALUES (?, 'today_sess', 'gpt-4o', 'openai', 'chat', 100, 10, 20, 30, '["hello"]', "hi today")
        `).run(today)

		await runDatabaseMaintenance()

		const log = db.query("SELECT * FROM ai_logs WHERE sessionId = 'today_sess'").get() as any
		expect(log.requestMessagesJson).toBe('["hello"]')
		expect(log.response).toBe('hi today')
		expect(log.totalTokens).toBe(30)
	})

	test("Case 2: Logs older than 24 hours lose text but keep tokens", async () => {
		const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
		db.prepare(`
            INSERT INTO ai_logs (timestamp, sessionId, model, provider, action, durationMs, promptTokens, completionTokens, totalTokens, requestMessagesJson, response)
            VALUES (?, 'old_sess', 'gpt-4o', 'openai', 'chat', 100, 50, 50, 100, '["yesterday content"]', "yesterday response")
        `).run(yesterday)

		await runDatabaseMaintenance()

		const log = db.query("SELECT * FROM ai_logs WHERE sessionId = 'old_sess'").get() as any
		expect(log.requestMessagesJson).toBeNull()
		expect(log.response).toBe('Detailed log pruned')
		expect(log.totalTokens).toBe(100)
		expect(log.model).toBe('gpt-4o')
	})

	test("Case 3: Logs older than 30 days are archived to ai_logs_archive and deleted from ai_logs", async () => {
		const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
		db.prepare(`
            INSERT INTO ai_logs (timestamp, sessionId, model, provider, action, durationMs, promptTokens, completionTokens, totalTokens, requestMessagesJson, response, estimatedCostUsd, tenantId, agentId, channelId)
            VALUES (?, 'archive_sess', 'claude-3', 'anthropic', 'chat', 500, 100, 200, 300, '["archived text"]', "archived res", 0.0045, 'tenant1', 'agent1', 'discord')
        `).run(fortyDaysAgo)

		await runDatabaseMaintenance()

		// Should be gone from ai_logs
		const dbLog = db.query("SELECT * FROM ai_logs WHERE sessionId = 'archive_sess'").get()
		expect(dbLog).toBeNull()

		// Should be in ai_logs_archive
		const entry = db.query("SELECT * FROM ai_logs_archive WHERE sessionId = 'archive_sess'").get() as any
		expect(entry).toBeDefined()
		expect(entry.totalTokens).toBe(300)
		expect(entry.model).toBe('claude-3')
		expect(entry.timestamp).toBe(fortyDaysAgo)
		expect(entry.estimatedCostUsd).toBe(0.0045)
		expect(entry.tenantId).toBe('tenant1')
		expect(entry.agentId).toBe('agent1')
		expect(entry.channelId).toBe('discord')
	})

	test("Case 4: Inactive sessions older than 90 days are deleted", async () => {
		const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
		db.prepare(`
            INSERT INTO sessions (id, name, model, connectionNickname, modelId, createdAt, updatedAt)
            VALUES ('dead_session', 'Old Session', 'gpt-4', 'openai', 'gpt-4', ?, ?)
        `).run(hundredDaysAgo, hundredDaysAgo)

		await runDatabaseMaintenance()

		const session = db.query("SELECT * FROM sessions WHERE id = 'dead_session'").get()
		expect(session).toBeNull()
	})

	test("Case 5: Archive accumulates across multiple maintenance runs", async () => {
		// Run once with one old log
		const date1 = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()
		db.prepare("INSERT INTO ai_logs (timestamp, sessionId, totalTokens) VALUES (?, 'sess_1', 10)").run(date1)
		await runDatabaseMaintenance()

		// Run again with another old log
		const date2 = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
		db.prepare("INSERT INTO ai_logs (timestamp, sessionId, totalTokens) VALUES (?, 'sess_2', 20)").run(date2)
		await runDatabaseMaintenance()

		const count = db.query("SELECT COUNT(*) as cnt FROM ai_logs_archive").get() as any
		expect(count.cnt).toBeGreaterThanOrEqual(2)

		const sess1 = db.query("SELECT * FROM ai_logs_archive WHERE sessionId = 'sess_1'").get()
		const sess2 = db.query("SELECT * FROM ai_logs_archive WHERE sessionId = 'sess_2'").get()
		expect(sess1).toBeDefined()
		expect(sess2).toBeDefined()
	})
})
