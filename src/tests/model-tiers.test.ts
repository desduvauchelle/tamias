import { expect, test, describe, beforeEach } from "bun:test"
import {
	loadConfig,
	saveConfig,
	invalidateConfigCache,
	getSmartModels,
	setSmartModels,
	getModelsForTier,
	getDefaultModels,
	setDefaultModels,
	getAllModelOptions,
	type TamiasConfig,
} from "../utils/config"

describe("Model Tiers", () => {
	beforeEach(() => {
		invalidateConfigCache()
	})

	// ── getSmartModels ────────────────────────────────────────────────────

	describe("getSmartModels", () => {
		test("returns empty array when no smart models configured", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getSmartModels()).toEqual([])
		})

		test("returns configured smart models", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				smartModels: ["openrouter/anthropic/claude-3-opus", "openai/o3"],
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getSmartModels()).toEqual([
				"openrouter/anthropic/claude-3-opus",
				"openai/o3",
			])
		})
	})

	// ── setSmartModels ────────────────────────────────────────────────────

	describe("setSmartModels", () => {
		test("saves smart models to config", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
			} as TamiasConfig)
			invalidateConfigCache()

			setSmartModels(["openai/o3", "anthropic/claude-3-opus"])
			invalidateConfigCache()

			const config = loadConfig()
			expect(config.smartModels).toEqual(["openai/o3", "anthropic/claude-3-opus"])
		})

		test("overwrites existing smart models", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				smartModels: ["old/model"],
			} as TamiasConfig)
			invalidateConfigCache()

			setSmartModels(["new/model"])
			invalidateConfigCache()

			expect(getSmartModels()).toEqual(["new/model"])
		})

		test("allows setting empty array", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				smartModels: ["some/model"],
			} as TamiasConfig)
			invalidateConfigCache()

			setSmartModels([])
			invalidateConfigCache()

			expect(getSmartModels()).toEqual([])
		})
	})

	// ── getModelsForTier ──────────────────────────────────────────────────

	describe("getModelsForTier", () => {
		test("'normal' tier returns defaultModels", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				defaultModels: ["openai/gpt-4o", "openai/gpt-4o-mini"],
				smartModels: ["openai/o3"],
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getModelsForTier("normal")).toEqual([
				"openai/gpt-4o",
				"openai/gpt-4o-mini",
			])
		})

		test("'smart' tier returns smartModels when configured", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				defaultModels: ["openai/gpt-4o"],
				smartModels: ["openai/o3", "anthropic/claude-3-opus"],
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getModelsForTier("smart")).toEqual([
				"openai/o3",
				"anthropic/claude-3-opus",
			])
		})

		test("'smart' tier falls back to defaultModels when smartModels is empty", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				defaultModels: ["openai/gpt-4o"],
				smartModels: [],
				debug: false,
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getModelsForTier("smart")).toEqual(["openai/gpt-4o"])
		})

		test("'smart' tier falls back to defaultModels when smartModels not set", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				defaultModels: ["openai/gpt-4o-mini"],
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getModelsForTier("smart")).toEqual(["openai/gpt-4o-mini"])
		})

		test("'normal' returns empty array when no defaultModels", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getModelsForTier("normal")).toEqual([])
		})

		test("'smart' returns empty array when neither smartModels nor defaultModels set", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getModelsForTier("smart")).toEqual([])
		})
	})

	// ── Schema validation ─────────────────────────────────────────────────

	describe("smartModels in config schema", () => {
		test("config with smartModels loads and saves correctly", () => {
			const original: TamiasConfig = {
				version: "1.0",
				connections: {
					"my-openai": {
						nickname: "my-openai",
						provider: "openai",
						selectedModels: ["gpt-4o", "o3"],
					},
				},
				bridges: { terminal: { enabled: true } },
				defaultModels: ["my-openai/gpt-4o"],
				smartModels: ["my-openai/o3"],
				debug: false,
			}

			saveConfig(original)
			invalidateConfigCache()

			const loaded = loadConfig()
			expect(loaded.smartModels).toEqual(["my-openai/o3"])
			expect(loaded.defaultModels).toEqual(["my-openai/gpt-4o"])
		})

		test("config without smartModels still loads fine", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				defaultModels: ["openai/gpt-4o"],
			} as TamiasConfig)
			invalidateConfigCache()

			const loaded = loadConfig()
			expect(loaded.smartModels).toBeUndefined()
			expect(loaded.defaultModels).toEqual(["openai/gpt-4o"])
		})

		test("smartModels and defaultModels can have overlapping entries", () => {
			saveConfig({
				version: "1.0",
				connections: {},
				bridges: { terminal: { enabled: true } },
				defaultModels: ["openai/gpt-4o", "openai/gpt-4o-mini"],
				smartModels: ["openai/gpt-4o", "openai/o3"],
			} as TamiasConfig)
			invalidateConfigCache()

			expect(getModelsForTier("normal")).toEqual(["openai/gpt-4o", "openai/gpt-4o-mini"])
			expect(getModelsForTier("smart")).toEqual(["openai/gpt-4o", "openai/o3"])
		})
	})
})
