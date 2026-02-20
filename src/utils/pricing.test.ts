import { expect, test, describe } from "bun:test"
import { getEstimatedCost, formatCurrency } from "./pricing.ts"

describe("Pricing Utils", () => {
	test("calculates cost correctly for known model (gpt-4o)", () => {
		// 2.50 per 1M input, 10.00 per 1M output
		const cost = getEstimatedCost("gpt-4o", 1000000, 1000000)
		expect(cost).toBe(12.50)
	})

	test("calculates cost correctly for gpt-4o-mini", () => {
		const cost = getEstimatedCost("gpt-4o-mini", 2000000, 500000) // 0.15 * 2 + 0.60 * 0.5 = 0.30 + 0.30 = 0.60
		expect(cost).toBe(0.60)
	})

	test("handles provider prefixes correctly (e.g. lc-openai/gpt-4o)", () => {
		const cost = getEstimatedCost("lc-openai/gpt-4o", 1000000, 1000000)
		expect(cost).toBe(12.50)
	})

	test("returns 0 for unknown models", () => {
		const cost = getEstimatedCost("unknown-model", 1000000, 1000000)
		expect(cost).toBe(0)
	})

	test("formats currency correctly", () => {
		expect(formatCurrency(12.50)).toBe("$12.50")
		expect(formatCurrency(0)).toBe("$0.00")
		expect(formatCurrency(0.001)).toBe("$0.001") // checks extra precision logic
		expect(formatCurrency(0.0001)).toBe("$0.0001")
	})
})
