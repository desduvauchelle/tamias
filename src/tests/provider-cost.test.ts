import { expect, test, describe } from "bun:test"
import { logAiRequest } from "../utils/logger.ts"
import { db } from "../utils/db.ts"

describe("Provider cost tracking", () => {
	test("providerCostUsd is stored when provided and preferred over estimate", () => {
		const logId = logAiRequest({
			timestamp: new Date().toISOString(),
			sessionId: "test-provider-cost-1",
			model: "gpt-4o",
			provider: "openrouter",
			action: "chat",
			durationMs: 200,
			tokens: { prompt: 100, completion: 50, total: 150 },
			messages: [{ role: "user", content: "hello" }],
			response: "hi",
			providerCostUsd: 0.00123,
		})

		const row = db.query<any, [number]>("SELECT estimatedCostUsd, providerCostUsd FROM ai_logs WHERE id = ?").get(logId!)
		// providerCostUsd stored as-is
		expect(row.providerCostUsd).toBe(0.00123)
		// estimatedCostUsd gets the provider cost (preferred over heuristic)
		expect(row.estimatedCostUsd).toBe(0.00123)

		db.prepare("DELETE FROM unified_logs WHERE aiLogId = ?").run(logId!)
		db.prepare("DELETE FROM ai_logs WHERE id = ?").run(logId!)
	})

	test("estimatedCostUsd falls back to pricing table when providerCostUsd is absent", () => {
		const logId = logAiRequest({
			timestamp: new Date().toISOString(),
			sessionId: "test-provider-cost-2",
			model: "gpt-4o",
			provider: "openai",
			action: "chat",
			durationMs: 200,
			tokens: { prompt: 1000, completion: 500, total: 1500 },
			messages: [{ role: "user", content: "hello" }],
			response: "hi",
			// no providerCostUsd
		})

		const row = db.query<any, [number]>("SELECT estimatedCostUsd, providerCostUsd FROM ai_logs WHERE id = ?").get(logId!)
		expect(row.providerCostUsd).toBeNull()
		// Should have a non-zero estimate from the pricing table
		expect(row.estimatedCostUsd).toBeGreaterThan(0)

		db.prepare("DELETE FROM unified_logs WHERE aiLogId = ?").run(logId!)
		db.prepare("DELETE FROM ai_logs WHERE id = ?").run(logId!)
	})

	test("OpenRouter cost extraction pattern accumulates across steps", () => {
		// Simulate the accumulation logic used in aiService.ts onStepFinish
		let accumulatedProviderCost: number | null = null

		const extractCost = (providerMetadata: unknown) => {
			const orCost = (providerMetadata as any)?.openrouter?.usage?.cost
			if (typeof orCost === "number") {
				accumulatedProviderCost = (accumulatedProviderCost ?? 0) + orCost
			}
		}

		// Step 1: model responds with tool call
		extractCost({ openrouter: { usage: { cost: 0.001, promptTokens: 100, completionTokens: 50, totalTokens: 150 } } })
		expect(accumulatedProviderCost).not.toBeNull()
		expect(accumulatedProviderCost!).toBe(0.001)

		// Step 2: model responds with another tool call
		extractCost({ openrouter: { usage: { cost: 0.002, promptTokens: 200, completionTokens: 80, totalTokens: 280 } } })
		expect(accumulatedProviderCost!).toBe(0.003)

		// Step 3: model gives final text response
		extractCost({ openrouter: { usage: { cost: 0.0005, promptTokens: 300, completionTokens: 100, totalTokens: 400 } } })
		expect(accumulatedProviderCost!).toBeCloseTo(0.0035, 10)
	})

	test("extraction handles non-OpenRouter providers gracefully", () => {
		let accumulatedProviderCost: number | null = null

		const extractCost = (providerMetadata: unknown) => {
			const orCost = (providerMetadata as any)?.openrouter?.usage?.cost
			if (typeof orCost === "number") {
				accumulatedProviderCost = (accumulatedProviderCost ?? 0) + orCost
			}
		}

		// Anthropic provider metadata
		extractCost({ anthropic: { cacheCreationInputTokens: 0, cacheReadInputTokens: 50 } })
		expect(accumulatedProviderCost).toBeNull()

		// Undefined metadata
		extractCost(undefined)
		expect(accumulatedProviderCost).toBeNull()

		// Empty object
		extractCost({})
		expect(accumulatedProviderCost).toBeNull()
	})
})
