import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { getDefaultWorkspacePath, loadConfig, saveConfig, TAMIAS_DIR, TAMIAS_WORKSPACE_DIR } from "./config"
import type { TamiasConfig } from "./config"
import { getEnv, removeEnv } from "./env"
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
			bridges: { terminal: { enabled: true } },
			debug: false
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
			workspacePath: legacyPath,
			debug: false
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
			defaultModel: "openai/gpt-4o",
			debug: false
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
			},
			debug: false
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

// ─── Bridge Migration Tests ──────────────────────────────────────────────────

describe("Bridge migration: legacy → multi-instance", () => {
	// Track env keys created during tests so we can clean them up
	const createdEnvKeys: string[] = []

	afterEach(() => {
		for (const key of createdEnvKeys.splice(0)) {
			removeEnv(key)
		}
	})

	test("legacy bridges.discord (envKeyName) migrates to bridges.discords.default", () => {
		const legacy = {
			version: "1.0",
			connections: {},
			bridges: {
				terminal: { enabled: true },
				discord: { enabled: true, envKeyName: "MY_DC_KEY", allowedChannels: ["111", "222"] },
			},
			debug: false,
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacy))
		const config = loadConfig()

		// New key exists under discords.default
		expect(config.bridges.discords?.default).toBeDefined()
		expect(config.bridges.discords!.default.enabled).toBe(true)
		expect(config.bridges.discords!.default.envKeyName).toBe("MY_DC_KEY")
		expect(config.bridges.discords!.default.allowedChannels).toEqual(["111", "222"])

		// Old top-level key is gone
		expect((config.bridges as any).discord).toBeUndefined()
	})

	test("legacy bridges.telegram (envKeyName) migrates to bridges.telegrams.default", () => {
		const legacy = {
			version: "1.0",
			connections: {},
			bridges: {
				terminal: { enabled: true },
				telegram: { enabled: false, envKeyName: "MY_TG_KEY", allowedChats: ["-100123"] },
			},
			debug: false,
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacy))
		const config = loadConfig()

		expect(config.bridges.telegrams?.default).toBeDefined()
		expect(config.bridges.telegrams!.default.enabled).toBe(false)
		expect(config.bridges.telegrams!.default.envKeyName).toBe("MY_TG_KEY")
		expect(config.bridges.telegrams!.default.allowedChats).toEqual(["-100123"])
		expect((config.bridges as any).telegram).toBeUndefined()
	})

	test("legacy discord with plaintext botToken migrates token to env and moves to discords.default", () => {
		const legacy = {
			version: "1.0",
			connections: {},
			bridges: {
				terminal: { enabled: true },
				discord: { enabled: true, botToken: "secret-discord-token" },
			},
			debug: false,
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacy))
		const config = loadConfig()

		const instance = config.bridges.discords?.default
		expect(instance).toBeDefined()
		expect(instance!.enabled).toBe(true)

		// Token must NOT remain in config file
		expect(instance!.botToken).toBeUndefined()

		// envKeyName must have been generated and the token stored there
		expect(instance!.envKeyName).toBeTypeOf("string")
		expect(instance!.envKeyName!.length).toBeGreaterThan(0)
		createdEnvKeys.push(instance!.envKeyName!)

		const storedToken = getEnv(instance!.envKeyName!)
		expect(storedToken).toBe("secret-discord-token")

		// Old top-level key gone
		expect((config.bridges as any).discord).toBeUndefined()
	})

	test("legacy telegram with plaintext botToken migrates token to env and moves to telegrams.default", () => {
		const legacy = {
			version: "1.0",
			connections: {},
			bridges: {
				terminal: { enabled: true },
				telegram: { enabled: true, botToken: "secret-telegram-token" },
			},
			debug: false,
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacy))
		const config = loadConfig()

		const instance = config.bridges.telegrams?.default
		expect(instance).toBeDefined()
		expect(instance!.enabled).toBe(true)
		expect(instance!.botToken).toBeUndefined()
		expect(instance!.envKeyName).toBeTypeOf("string")
		createdEnvKeys.push(instance!.envKeyName!)

		expect(getEnv(instance!.envKeyName!)).toBe("secret-telegram-token")
		expect((config.bridges as any).telegram).toBeUndefined()
	})

	test("both legacy discord and telegram migrate together", () => {
		const legacy = {
			version: "1.0",
			connections: {},
			bridges: {
				terminal: { enabled: true },
				discord: { enabled: true, envKeyName: "DC_KEY" },
				telegram: { enabled: true, envKeyName: "TG_KEY", allowedChats: ["-999"] },
			},
			debug: false,
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacy))
		const config = loadConfig()

		expect(config.bridges.discords?.default?.envKeyName).toBe("DC_KEY")
		expect(config.bridges.telegrams?.default?.envKeyName).toBe("TG_KEY")
		expect(config.bridges.telegrams?.default?.allowedChats).toEqual(["-999"])
		expect((config.bridges as any).discord).toBeUndefined()
		expect((config.bridges as any).telegram).toBeUndefined()
	})

	test("already-migrated multi-instance config loads unchanged", () => {
		const modern = {
			version: "1.0",
			connections: {},
			bridges: {
				terminal: { enabled: true },
				discords: {
					default: { enabled: true, envKeyName: "DC_DEFAULT" },
					community: { enabled: false, envKeyName: "DC_COMMUNITY", allowedChannels: ["555"] },
				},
				telegrams: {
					personal: { enabled: true, envKeyName: "TG_PERSONAL" },
				},
			},
			debug: false,
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(modern))
		const config = loadConfig()

		// No spurious migration should have happened
		expect(Object.keys(config.bridges.discords!)).toEqual(["default", "community"])
		expect(config.bridges.discords!.community.allowedChannels).toEqual(["555"])
		expect(Object.keys(config.bridges.telegrams!)).toEqual(["personal"])
		expect((config.bridges as any).discord).toBeUndefined()
		expect((config.bridges as any).telegram).toBeUndefined()
	})

	test("migration is persisted — saved config no longer has legacy keys", () => {
		const legacy = {
			version: "1.0",
			connections: {},
			bridges: {
				terminal: { enabled: true },
				discord: { enabled: true, envKeyName: "DC_PERSIST" },
			},
			debug: false,
		}
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(legacy))
		loadConfig() // triggers migration + save

		// Re-read raw file and confirm old key is gone
		const raw = JSON.parse(readFileSync(process.env.TAMIAS_CONFIG_PATH!, "utf-8"))
		expect(raw.bridges.discord).toBeUndefined()
		expect(raw.bridges.discords?.default?.envKeyName).toBe("DC_PERSIST")
	})
})
