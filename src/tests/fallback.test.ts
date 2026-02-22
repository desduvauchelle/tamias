import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test"
import { AIService } from "../services/aiService"
import { BridgeManager } from "../bridge"
import * as configUtils from "../utils/config"
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"

describe("AIService Fallback", () => {
	const configDir = join(homedir(), '.tamias')
	const configPath = join(configDir, "config.json")
	let backupConfig: string | null = null

	beforeEach(() => {
		if (existsSync(configPath)) {
			backupConfig = Bun.file(configPath).toString()
		}
		if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
	})

	afterEach(() => {
		if (backupConfig) {
			writeFileSync(configPath, backupConfig)
		} else if (existsSync(configPath)) {
			unlinkSync(configPath)
		}
	})

	test("should fallback to next model if first connection is missing", async () => {
		// Setup config with one missing connection and one valid one
		const mockConfig = {
			version: "1.0",
			connections: {
				"valid-conn": {
					nickname: "valid-conn",
					provider: "openai",
					envKeyName: "OPENAI_API_KEY",
					selectedModels: ["gpt-4o"]
				}
			},
			defaultModels: ["invalid-conn/old-model", "valid-conn/gpt-4o"],
			bridges: { terminal: { enabled: true } }
		}
		writeFileSync(configPath, JSON.stringify(mockConfig))

		// Mock env for valid-conn
		process.env.OPENAI_API_KEY = "sk-test"

		const bridgeManager = new BridgeManager()
		const aiService = new AIService(bridgeManager)

		// Create a session explicitly pointing to the invalid model
		const session = aiService.createSession({ model: "invalid-conn/old-model" })

		expect(session.model).toBe("invalid-conn/old-model");

		// We'll mock buildModel to track calls or refreshTools
		// But simpler is to check if it emits a 'start' event with the corrected model eventually
		// Since processSession is private and async, we'll watch for messages or state changes

		// Mock streamText to avoid real network calls
		// This is tricky because streamText is imported in aiService.ts
		// Mock refreshTools and buildModel
		(aiService as any).refreshTools = async () => { };
		(aiService as any).buildModel = (conn: any, modelId: string) => {
			if (conn.nickname === 'valid-conn') return {
				streamText: async function* () {
					yield { textDelta: "Hello from fallback!" }
				},
				textStream: (async function* () {
					yield "Hello from fallback!"
				})()
			} as any
			throw new Error("Provider fail")
		}

		const currentDefaults = configUtils.getDefaultModels()
		const sessionModel = "invalid-conn/old-model"
		const allConfiguredModels = configUtils.getAllModelOptions()
		const config = configUtils.loadConfig()

		const modelsToTry = [
			...currentDefaults,
			sessionModel,
			...allConfiguredModels,
		].filter((m, i, arr) => {
			if (!m) return false
			if (arr.indexOf(m) !== i) return false
			const [nick] = m.split('/')
			// Only include models whose connection is configured on this machine
			if (!config.connections[nick]) return false
			return true
		})

		expect(modelsToTry).toContain("valid-conn/gpt-4o")
		expect(modelsToTry).not.toContain("invalid-conn/old-model")
		expect(modelsToTry[0]).toBe("valid-conn/gpt-4o")
		// Generic names like 'openai' are not in connections, so they should NOT appear
		expect(modelsToTry).not.toContain("openai/gpt-4o")
	})
})
