import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { getDefaultWorkspacePath, loadConfig, saveConfig, invalidateConfigCache, TAMIAS_DIR, TAMIAS_WORKSPACE_DIR } from "./config"
import type { TamiasConfig } from "./config"
import { getEnv, removeEnv } from "./env"
import { join } from "path"
import { homedir } from "os"
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs"

// - Note: these tests rely on the test setup in src/tests/setup.ts to provide an isolated config path for each test run. Do not modify or remove that setup without adjusting these tests accordingly.
describe("Config Utils", () => {
	const configDir = TAMIAS_DIR
	const configPath = join(configDir, "config.json")
	beforeEach(() => {
		// Ensure dir exists and bust the mtime-based config cache so a fast
		// CI machine can't return stale config when two writes land in the same ms
		if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
		invalidateConfigCache()
	})

	test("getDefaultWorkspacePath returns ~/.tamias/workspace", () => {
		expect(getDefaultWorkspacePath()).toBe(TAMIAS_WORKSPACE_DIR)
		expect(getDefaultWorkspacePath()).toBe(join(TAMIAS_DIR, "workspace"))
	})

	test("loadConfig defaults ngrok to disabled when config file is missing", () => {
		if (existsSync(configPath)) unlinkSync(configPath)
		invalidateConfigCache()
		const cfg = loadConfig()
		expect(cfg.ngrok?.enabled ?? false).toBe(false)
	})

	test("saveConfig and loadConfig persist ngrok enabled setting", () => {
		const cfg = loadConfig()
		const next: TamiasConfig = { ...cfg, ngrok: { enabled: true } }
		saveConfig(next)
		invalidateConfigCache()
		const reloaded = loadConfig()
		expect(reloaded.ngrok?.enabled).toBe(true)
	})

})
