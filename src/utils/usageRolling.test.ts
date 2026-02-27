import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { homedir } from "os"
import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs"
import { recordUsage, loadRollingUsage, buildUsageSummary } from "./usageRolling"

const USAGE_FILE = join(homedir(), ".tamias", "usage.json")

describe("UsageRolling: rolling 30-day usage tracking", () => {
	let originalUsage: string | null = null

	beforeEach(() => {
		if (existsSync(USAGE_FILE)) {
			originalUsage = readFileSync(USAGE_FILE, "utf-8")
		}
		// Start fresh
		if (existsSync(USAGE_FILE)) unlinkSync(USAGE_FILE)
	})

	afterEach(() => {
		if (originalUsage !== null) {
			writeFileSync(USAGE_FILE, originalUsage, "utf-8")
		} else if (existsSync(USAGE_FILE)) {
			unlinkSync(USAGE_FILE)
		}
	})

	test("loadRollingUsage returns empty structure when file is missing", () => {
		const data = loadRollingUsage()
		expect(data.days).toEqual({})
	})

	test("recordUsage creates the file and increments today's stats", () => {
		recordUsage({
			model: "gpt-4o",
			promptTokens: 1000,
			completionTokens: 500,
			estimatedCostUsd: 0.0075,
			channelId: "discord",
			tenantId: "t1",
			agentId: "a1",
		})

		const data = loadRollingUsage()
		const todayKey = new Date().toISOString().split("T")[0]

		expect(data.days[todayKey]).toBeDefined()
		expect(data.days[todayKey].totalRequests).toBe(1)
		expect(data.days[todayKey].totalCost).toBe(0.0075)
		expect(data.days[todayKey].models["gpt-4o"].requests).toBe(1)
		expect(data.days[todayKey].models["gpt-4o"].promptTokens).toBe(1000)
		expect(data.days[todayKey].channels["discord"].requests).toBe(1)
	})

	test("recordUsage increments existing day stats", () => {
		recordUsage({ model: "gpt-4o", promptTokens: 100, completionTokens: 50, estimatedCostUsd: 0.001 })
		recordUsage({ model: "gpt-4o", promptTokens: 200, completionTokens: 100, estimatedCostUsd: 0.002 })
		recordUsage({ model: "claude-3-5-sonnet", promptTokens: 300, completionTokens: 150, estimatedCostUsd: 0.005 })

		const data = loadRollingUsage()
		const todayKey = new Date().toISOString().split("T")[0]
		const day = data.days[todayKey]

		expect(day.totalRequests).toBe(3)
		expect(day.totalCost).toBeCloseTo(0.008, 6)
		expect(day.models["gpt-4o"].requests).toBe(2)
		expect(day.models["gpt-4o"].promptTokens).toBe(300)
		expect(day.models["claude-3-5-sonnet"].requests).toBe(1)
	})

	test("buildUsageSummary returns correct shape with today's data", () => {
		recordUsage({ model: "gpt-4o", promptTokens: 1000, completionTokens: 500, estimatedCostUsd: 0.01, channelId: "discord" })

		const summary = buildUsageSummary()

		expect(summary.today).toBe(0.01)
		expect(summary.total).toBe(0.01)
		expect(summary.totalRequests).toBe(1)
		expect(summary.totalPromptTokens).toBe(1000)
		expect(summary.dailySpend.length).toBe(14)
		expect(summary.modelDistribution.length).toBe(1)
		expect(summary.modelDistribution[0].name).toBe("gpt-4o")
	})

	test("prunes days older than 30 days on write", () => {
		// Manually seed an old day
		const data = loadRollingUsage()
		const oldDate = new Date()
		oldDate.setDate(oldDate.getDate() - 35)
		const oldKey = oldDate.toISOString().split("T")[0]
		data.days[oldKey] = {
			models: { "old-model": { requests: 1, promptTokens: 10, completionTokens: 5, cost: 0.001 } },
			channels: { "terminal": { requests: 1, cost: 0.001 } },
			tenants: { "default": { requests: 1, cost: 0.001 } },
			agents: { "main": { requests: 1, cost: 0.001 } },
			totalCost: 0.001,
			totalRequests: 1,
			totalPromptTokens: 10,
			totalCompletionTokens: 5,
		}
		writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), "utf-8")

		// Recording a new usage should prune the old day
		recordUsage({ model: "gpt-4o", promptTokens: 100, completionTokens: 50, estimatedCostUsd: 0.001 })

		const updated = loadRollingUsage()
		expect(updated.days[oldKey]).toBeUndefined()
		expect(Object.keys(updated.days).length).toBe(1) // only today
	})

	test("handles corrupt usage file gracefully", () => {
		writeFileSync(USAGE_FILE, "NOT JSON{{{", "utf-8")
		const data = loadRollingUsage()
		expect(data.days).toEqual({})
	})
})
