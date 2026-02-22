import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { getDefaultWorkspacePath, loadConfig, saveConfig, TAMIAS_DIR } from "./config"
import type { TamiasConfig } from "./config"
import { join } from "path"
import { homedir } from "os"
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync } from "fs"

describe("Config Utils", () => {
	const configDir = TAMIAS_DIR
	const configPath = join(configDir, "config.json")
	let backupConfig: string | null = null

	beforeEach(() => {
		if (existsSync(configPath)) {
			backupConfig = Bun.file(configPath).toString()
		}
		// Ensure dir exists
		if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
	})

	afterEach(() => {
		if (backupConfig) {
			writeFileSync(configPath, backupConfig)
		} else if (existsSync(configPath)) {
			unlinkSync(configPath)
		}
	})

	test("getDefaultWorkspacePath returns ~/.tamias", () => {
		expect(getDefaultWorkspacePath()).toBe(TAMIAS_DIR)
	})

	test("loadConfig migrates missing workspacePath to default", () => {
		const minimalConfig = {
			version: "1.0",
			connections: {},
			bridges: { terminal: { enabled: true } }
		}
		writeFileSync(configPath, JSON.stringify(minimalConfig))

		const loaded = loadConfig()
		expect(loaded.workspacePath).toBe(getDefaultWorkspacePath())
	})

	test("loadConfig preserves existing legacy workspacePath", () => {
		const legacyPath = join(homedir(), "Documents", "tamias-workspace")
		const legacyConfig = {
			version: "1.0",
			connections: {},
			bridges: { terminal: { enabled: true } },
			workspacePath: legacyPath
		}
		writeFileSync(configPath, JSON.stringify(legacyConfig))

		const loaded = loadConfig()
		expect(loaded.workspacePath).toBe(legacyPath)
	})

	test("loadConfig migrates defaultModel to defaultModels array", () => {
		const legacyConfig = {
			version: "1.0",
			connections: {},
			bridges: { terminal: { enabled: true } },
			defaultModel: "openai/gpt-4o"
		}
		writeFileSync(configPath, JSON.stringify(legacyConfig))

		const loaded = loadConfig()
		expect(Array.isArray((loaded as any).defaultModels)).toBe(true)
		expect((loaded as any).defaultModels[0]).toBe("openai/gpt-4o")
		expect((loaded as any).defaultModel).toBeUndefined()
	})

	test("loadConfig cleans up dead lc-openai connections", () => {
		const ghostConfig = {
			version: "1.0",
			defaultModels: ["lc-openai/gpt-4o", "other/valid"],
			connections: {
				"lc-openai": { nickname: "lc-openai", provider: "openai" },
				"other": { nickname: "other", provider: "anthropic" }
			}
		}
		writeFileSync(configPath, JSON.stringify(ghostConfig))
		const config = loadConfig()
		expect(config.defaultModels).not.toContain("lc-openai/gpt-4o")
		expect(config.connections["lc-openai"]).toBeUndefined()
		expect(config.connections["other"]).toBeDefined()
	})
})
