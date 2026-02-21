import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { getDefaultWorkspacePath, loadConfig, saveConfig, TamiasConfig } from "./config"
import { join } from "path"
import { homedir } from "os"
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync } from "fs"

describe("Config Utils", () => {
	const configDir = join(homedir(), '.tamias')
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

	test("getDefaultWorkspacePath returns ~/Documents/Tamias", () => {
		const expected = join(homedir(), "Documents", "Tamias")
		expect(getDefaultWorkspacePath()).toBe(expected)
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
})
