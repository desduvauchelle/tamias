import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { getDefaultWorkspacePath, loadConfig, saveConfig, TAMIAS_DIR, TAMIAS_WORKSPACE_DIR } from "./config"
import type { TamiasConfig } from "./config"
import { join } from "path"
import { homedir } from "os"
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs"

describe("Config Utils", () => {
	const configDir = TAMIAS_DIR
	const configPath = join(configDir, "config.json")
	beforeEach(() => {
		// Ensure dir exists
		if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
	})

	test("getDefaultWorkspacePath returns ~/.tamias/workspace", () => {
		expect(getDefaultWorkspacePath()).toBe(TAMIAS_WORKSPACE_DIR)
		expect(getDefaultWorkspacePath()).toBe(join(TAMIAS_DIR, "workspace"))
	})

	test("loadConfig migrates missing workspacePath to default", () => {
		const minimalConfig = {
			version: "1.0",
			connections: {},
			bridges: { terminal: { enabled: true } }
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(minimalConfig))

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
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacyConfig))

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
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacyConfig))

		const loaded = loadConfig()
		expect(Array.isArray((loaded as any).defaultModels)).toBe(true)
		expect((loaded as any).defaultModels[0]).toBe("openai/gpt-4o")
		expect((loaded as any).defaultModel).toBeUndefined()
	})

	test("loadConfig cleans up defaultModels for deleted connections", () => {
		const ghostConfig = {
			version: "1.0",
			defaultModels: ["lc-openai/gpt-4o", "other/valid"],
			connections: {
				// "lc-openai" is gone (deleted from this machine)
				"other": { nickname: "other", provider: "anthropic", selectedModels: ["claude-3-5-sonnet"] }
			}
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(ghostConfig))
		const config = loadConfig()
		// defaultModels entry for the missing connection should be pruned
		expect(config.defaultModels).not.toContain("lc-openai/gpt-4o")
		// valid entry for an existing connection should be kept
		expect(config.defaultModels).toContain("other/valid")
		expect(config.connections["other"]).toBeDefined()
	})
})
