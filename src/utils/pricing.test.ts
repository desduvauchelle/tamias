import { expect, test, describe } from "bun:test"
import { getEstimatedCost, formatCurrency, getImageCost } from "./pricing.ts"

describe("Pricing Utils", () => {
	// --- Happy path: known models ---
	test("calculates cost correctly for known model (gpt-4o)", () => {
		// 2.50 per 1M input, 10.00 per 1M output
		const cost = getEstimatedCost("gpt-4o", 1000000, 1000000)
		expect(cost).toBe(12.50)
	})

	test("calculates cost correctly for gpt-4o-mini", () => {
		const cost = getEstimatedCost("gpt-4o-mini", 2000000, 500000)
		expect(cost).toBe(0.60) // 0.15 * 2 + 0.60 * 0.5
	})

	test("handles provider prefixes correctly (e.g. lc-openai/gpt-4o)", () => {
		const cost = getEstimatedCost("lc-openai/gpt-4o", 1000000, 1000000)
		expect(cost).toBe(12.50)
	})

	// --- Newly added models ---
	test("calculates cost for o3-mini", () => {
		const cost = getEstimatedCost("o3-mini", 1000000, 1000000)
		expect(cost).toBe(5.50) // 1.10 + 4.40
	})

	test("calculates cost for o4-mini", () => {
		const cost = getEstimatedCost("o4-mini", 1000000, 1000000)
		expect(cost).toBe(5.50) // 1.10 + 4.40
	})

	test("calculates cost for gpt-4.1", () => {
		const cost = getEstimatedCost("gpt-4.1", 1000000, 1000000)
		expect(cost).toBe(10.00) // 2.00 + 8.00
	})

	test("calculates cost for gpt-4.1-mini", () => {
		const cost = getEstimatedCost("gpt-4.1-mini", 1000000, 1000000)
		expect(cost).toBe(2.00) // 0.40 + 1.60
	})

	test("calculates cost for gpt-4.1-nano", () => {
		const cost = getEstimatedCost("gpt-4.1-nano", 1000000, 1000000)
		expect(cost).toBe(0.50) // 0.10 + 0.40
	})

	test("calculates cost for claude-sonnet-4", () => {
		const cost = getEstimatedCost("claude-sonnet-4", 1000000, 1000000)
		expect(cost).toBe(18.00) // 3.00 + 15.00
	})

	test("calculates cost for claude-opus-4", () => {
		const cost = getEstimatedCost("claude-opus-4", 1000000, 1000000)
		expect(cost).toBe(90.00) // 15.00 + 75.00
	})

	test("calculates cost for claude-3-5-haiku (corrected price)", () => {
		const cost = getEstimatedCost("claude-3-5-haiku", 1000000, 1000000)
		expect(cost).toBe(4.80) // 0.80 + 4.00
	})

	test("calculates cost for gemini-2.5-pro (corrected price)", () => {
		const cost = getEstimatedCost("gemini-2.5-pro", 1000000, 1000000)
		expect(cost).toBe(11.25) // 1.25 + 10.00
	})

	test("calculates cost for deepseek-chat (corrected price)", () => {
		const cost = getEstimatedCost("deepseek-chat", 1000000, 1000000)
		expect(cost).toBe(0.97) // 0.20 + 0.77
	})

	test("calculates cost for minimax-m1", () => {
		const cost = getEstimatedCost("minimax-m1", 1000000, 1000000)
		expect(cost).toBe(2.60) // 0.40 + 2.20
	})

	test("calculates cost for kimi-k2", () => {
		const cost = getEstimatedCost("kimi-k2", 1000000, 1000000)
		expect(cost).toBe(2.75) // 0.55 + 2.20
	})

	// --- Heuristic fallbacks ---
	test("unknown mini-like model uses cheap tier fallback", () => {
		const cost = getEstimatedCost("random-mini-model", 1000000, 1000000)
		expect(cost).toBe(1.00) // 0.20 + 0.80
	})

	test("unknown pro-like model uses mid tier fallback", () => {
		const cost = getEstimatedCost("some-pro-v2", 1000000, 1000000)
		expect(cost).toBe(25.00) // 5.00 + 20.00
	})

	test("unknown opus-like model uses expensive tier fallback", () => {
		const cost = getEstimatedCost("mega-opus-xl", 1000000, 1000000)
		expect(cost).toBe(100.00) // 20.00 + 80.00
	})

	// --- Catch-all: completely unknown model returns mid-tier (not $0) ---
	test("completely unknown model returns mid-tier fallback, not zero", () => {
		const cost = getEstimatedCost("totally-unknown-xyz", 1000000, 1000000)
		expect(cost).toBe(10.00) // 2.00 + 8.00 (mid-tier catch-all)
		expect(cost).toBeGreaterThan(0)
	})

	// --- Zero tokens ---
	test("zero tokens returns 0 cost regardless of model", () => {
		const cost = getEstimatedCost("gpt-4o", 0, 0)
		expect(cost).toBe(0)
	})

	// --- Edge case: dots normalized to dashes ---
	test("dots in model names are normalized to dashes", () => {
		// "gemini-2.5-flash" → "gemini-2-5-flash" which matches the key
		const cost = getEstimatedCost("gemini-2.5-flash", 1000000, 1000000)
		expect(cost).toBe(2.80) // 0.30 + 2.50
	})

	// --- formatCurrency ---
	test("formats currency correctly", () => {
		expect(formatCurrency(12.50)).toBe("$12.50")
		expect(formatCurrency(0)).toBe("$0.00")
		expect(formatCurrency(0.001)).toBe("$0.001")
		expect(formatCurrency(0.0001)).toBe("$0.0001")
	})
})

describe("Image Pricing", () => {
	test("returns DALL-E 3 cost for 1024x1024", () => {
		expect(getImageCost("dall-e-3", "1024x1024")).toBe(0.04)
	})

	test("returns DALL-E 3 cost for 1024x1792 (HD wide)", () => {
		expect(getImageCost("dall-e-3", "1024x1792")).toBe(0.08)
	})

	test("returns DALL-E 2 cost for 512x512", () => {
		expect(getImageCost("dall-e-2", "512x512")).toBe(0.018)
	})

	test("returns gpt-image-1 cost for 1024x1024", () => {
		expect(getImageCost("gpt-image-1", "1024x1024")).toBe(0.04)
	})

	test("defaults to 1024x1024 price when size not recognized", () => {
		expect(getImageCost("dall-e-3", "999x999")).toBe(0.04)
	})

	test("defaults to DEFAULT_IMAGE_COST when model not recognized", () => {
		expect(getImageCost("unknown-image-model", "1024x1024")).toBe(0.04)
	})

	test("defaults to 1024x1024 when no size provided", () => {
		expect(getImageCost("dall-e-3")).toBe(0.04)
	})

	test("strips provider prefix from model ID", () => {
		expect(getImageCost("openai/dall-e-3", "1024x1024")).toBe(0.04)
	})
})
