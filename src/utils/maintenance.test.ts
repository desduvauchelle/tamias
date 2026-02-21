import { expect, test, describe, beforeAll, afterAll, beforeEach } from "bun:test"
import { db } from "./db"
import { runDatabaseMaintenance } from "./maintenance"
import { join } from "path"
import { homedir } from "os"
import { existsSync, unlinkSync, readFileSync } from "fs"

/**
 * REFINED DATABASE MAINTENANCE TESTS
 * Focus: Granular validation of log pruning, 30-day archiving, and session TTL.
 */

describe("Database Maintenance: Pruning & History", () => {
	const archiveFile = join(homedir(), ".tamias", "archive", "history.json")

	beforeAll(() => {
		// Clean up environment
		if (existsSync(archiveFile)) unlinkSync(archiveFile)
	})

	beforeEach(() => {
		db.exec("DELETE FROM ai_logs")
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

	test("Case 3: Logs older than 30 days are archived to JSON and deleted from DB", async () => {
		const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
		db.prepare(`
            INSERT INTO ai_logs (timestamp, sessionId, model, provider, action, durationMs, promptTokens, completionTokens, totalTokens, requestMessagesJson, response)
            VALUES (?, 'archive_sess', 'claude-3', 'anthropic', 'chat', 500, 100, 200, 300, '["archived text"]', "archived res")
        `).run(fortyDaysAgo)

		await runDatabaseMaintenance()

		// Should be gone from DB
		const dbLog = db.query("SELECT * FROM ai_logs WHERE sessionId = 'archive_sess'").get()
		expect(dbLog).toBeNull()

		// Should be in JSON
		expect(existsSync(archiveFile)).toBe(true)
		const archive = JSON.parse(readFileSync(archiveFile, "utf-8"))
		const entry = archive.find((e: any) => e.sessionId === 'archive_sess')
		expect(entry).toBeDefined()
		expect(entry.totalTokens).toBe(300)
		expect(entry.model).toBe('claude-3')
		expect(entry.timestamp).toBe(fortyDaysAgo)
		// Ensure detailed text was NOT archived (we prune text >24h before archiving >30d)
		expect(entry.requestMessagesJson).toBeUndefined()
		expect(entry.response).toBeUndefined()
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

	test("Case 5: Archive appends to existing JSON file", async () => {
		// Run once with one old log
		const date1 = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString()
		db.prepare("INSERT INTO ai_logs (timestamp, sessionId, totalTokens) VALUES (?, 'sess_1', 10)").run(date1)
		await runDatabaseMaintenance()

		// Run again with another old log
		const date2 = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
		db.prepare("INSERT INTO ai_logs (timestamp, sessionId, totalTokens) VALUES (?, 'sess_2', 20)").run(date2)
		await runDatabaseMaintenance()

		const archive = JSON.parse(readFileSync(archiveFile, "utf-8"))
		expect(archive.length).toBeGreaterThanOrEqual(2)
		expect(archive.some((e: any) => e.sessionId === 'sess_1')).toBe(true)
		expect(archive.some((e: any) => e.sessionId === 'sess_2')).toBe(true)
	})
})
