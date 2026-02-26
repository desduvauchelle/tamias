import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import {
	existsSync,
	mkdirSync,
	rmSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
} from 'fs'
import { loadConfig, saveConfig } from '../utils/config'
import { getEnv, removeEnv, setEnv } from '../utils/env'
import { runMigrations, getMigrationStatus } from '../utils/migrations/index'
import { Database } from 'bun:sqlite'

// ─── helpers ─────────────────────────────────────────────────────────────────

const envKeysCreated: string[] = []

function writeTestConfig(cfg: Record<string, unknown>) {
	writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(cfg))
}

function readRawConfig(): Record<string, any> {
	return JSON.parse(readFileSync(process.env.TAMIAS_CONFIG_PATH!, 'utf-8'))
}

afterEach(() => {
	for (const k of envKeysCreated.splice(0)) removeEnv(k)
})

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Connection secret migrations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: connection secret migration', () => {
	test('apiKey is moved to .env and replaced with envKeyName', () => {
		writeTestConfig({
			version: '1.0',
			connections: {
				myopenai: {
					nickname: 'myopenai',
					provider: 'openai',
					apiKey: 'sk-test-secret-12345',
				},
			},
			bridges: { terminal: { enabled: true } },
			debug: false,
		})

		const config = loadConfig()
		const conn = config.connections.myopenai

		// apiKey must be gone
		expect(conn.apiKey).toBeUndefined()
		// envKeyName must exist
		expect(conn.envKeyName).toBeTypeOf('string')
		expect(conn.envKeyName!.length).toBeGreaterThan(0)
		envKeysCreated.push(conn.envKeyName!)

		// Secret must be stored in env
		expect(getEnv(conn.envKeyName!)).toBe('sk-test-secret-12345')

		// Persisted file must NOT contain the plaintext key
		const raw = readRawConfig()
		expect(raw.connections.myopenai.apiKey).toBeUndefined()
		expect(raw.connections.myopenai.envKeyName).toBe(conn.envKeyName)
	})

	test('accessToken is moved to .env and replaced with envKeyName', () => {
		writeTestConfig({
			version: '1.0',
			connections: {
				myanthropic: {
					nickname: 'myanthropic',
					provider: 'anthropic',
					accessToken: 'ant-secret-token-xyz',
				},
			},
			bridges: { terminal: { enabled: true } },
			debug: false,
		})

		const config = loadConfig()
		const conn = config.connections.myanthropic

		expect(conn.accessToken).toBeUndefined()
		expect(conn.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(conn.envKeyName!)
		expect(getEnv(conn.envKeyName!)).toBe('ant-secret-token-xyz')
	})

	test('multiple connections with mixed legacy fields all migrate', () => {
		writeTestConfig({
			version: '1.0',
			connections: {
				a: { nickname: 'a', provider: 'openai', apiKey: 'key-a' },
				b: { nickname: 'b', provider: 'google', accessToken: 'token-b' },
				c: { nickname: 'c', provider: 'ollama', envKeyName: 'ALREADY_MIGRATED' },
			},
			bridges: { terminal: { enabled: true } },
			debug: false,
		})

		const config = loadConfig()

		expect(config.connections.a.apiKey).toBeUndefined()
		expect(config.connections.a.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(config.connections.a.envKeyName!)
		expect(getEnv(config.connections.a.envKeyName!)).toBe('key-a')

		expect(config.connections.b.accessToken).toBeUndefined()
		expect(config.connections.b.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(config.connections.b.envKeyName!)
		expect(getEnv(config.connections.b.envKeyName!)).toBe('token-b')

		// Already-migrated connection untouched
		expect(config.connections.c.envKeyName).toBe('ALREADY_MIGRATED')
	})

	test('connection with no secret fields is left unchanged', () => {
		writeTestConfig({
			version: '1.0',
			connections: {
				local: { nickname: 'local', provider: 'ollama' },
			},
			bridges: { terminal: { enabled: true } },
			debug: false,
		})

		const config = loadConfig()
		expect(config.connections.local.apiKey).toBeUndefined()
		expect(config.connections.local.accessToken).toBeUndefined()
		expect(config.connections.local.envKeyName).toBeUndefined()
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Email migration
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: email migration', () => {
	test('singular email → emails.default', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			email: {
				nickname: 'work',
				service: 'gmail',
				email: 'test@gmail.com',
				envKeyName: 'EMAIL_PASS',
			},
			debug: false,
		})

		const config = loadConfig()

		// Old top-level key gone
		expect((config as any).email).toBeUndefined()

		// New multi-instance key exists
		expect(config.emails).toBeDefined()
		expect(config.emails!.default).toBeDefined()
		expect(config.emails!.default.email).toBe('test@gmail.com')
		expect(config.emails!.default.isDefault).toBe(true)

		// Persisted
		const raw = readRawConfig()
		expect(raw.email).toBeUndefined()
		expect(raw.emails?.default).toBeDefined()
	})

	test('email appPassword plaintext → env migration', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			emails: {
				work: {
					nickname: 'work',
					service: 'gmail',
					email: 'test@gmail.com',
					appPassword: 'super-secret-app-password',
				},
			},
			debug: false,
		})

		const config = loadConfig()
		const emailCfg = config.emails!.work as any

		// plaintext password gone
		expect(emailCfg.appPassword).toBeUndefined()

		// envKeyName assigned
		expect(emailCfg.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(emailCfg.envKeyName!)
		expect(getEnv(emailCfg.envKeyName!)).toBe('super-secret-app-password')

		// Persisted correctly
		const raw = readRawConfig()
		expect(raw.emails.work.appPassword).toBeUndefined()
		expect(raw.emails.work.envKeyName).toBe(emailCfg.envKeyName)
	})

	test('singular email with appPassword does both migrations', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			email: {
				nickname: 'personal',
				service: 'icloud',
				email: 'me@icloud.com',
				appPassword: 'icloud-pwd',
			},
			debug: false,
		})

		const config = loadConfig()

		// Moved to emails.default
		expect((config as any).email).toBeUndefined()
		expect(config.emails!.default).toBeDefined()
		expect(config.emails!.default.email).toBe('me@icloud.com')

		// Password migrated to env
		const emailCfg = config.emails!.default as any
		expect(emailCfg.appPassword).toBeUndefined()
		expect(emailCfg.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(emailCfg.envKeyName!)
		expect(getEnv(emailCfg.envKeyName!)).toBe('icloud-pwd')
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Multi-instance bridge migrations (token inside discords/telegrams)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: multi-instance bridge plaintext tokens', () => {
	test('discords[key].botToken → env', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: {
				terminal: { enabled: true },
				discords: {
					community: { enabled: true, botToken: 'dc-token-community' },
					support: { enabled: false, botToken: 'dc-token-support' },
				},
			},
			debug: false,
		})

		const config = loadConfig()

		for (const key of ['community', 'support']) {
			const inst = config.bridges.discords![key]
			expect(inst.botToken).toBeUndefined()
			expect(inst.envKeyName).toBeTypeOf('string')
			envKeysCreated.push(inst.envKeyName!)
		}

		expect(getEnv(config.bridges.discords!.community.envKeyName!)).toBe('dc-token-community')
		expect(getEnv(config.bridges.discords!.support.envKeyName!)).toBe('dc-token-support')
	})

	test('telegrams[key].botToken → env', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: {
				terminal: { enabled: true },
				telegrams: {
					alerts: { enabled: true, botToken: 'tg-token-alerts' },
				},
			},
			debug: false,
		})

		const config = loadConfig()
		const inst = config.bridges.telegrams!.alerts
		expect(inst.botToken).toBeUndefined()
		expect(inst.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(inst.envKeyName!)
		expect(getEnv(inst.envKeyName!)).toBe('tg-token-alerts')
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Config migration v002 channel mode backfill
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: config migration v002 channel modes', () => {
	test('v002 sets mode on existing Discord entries', async () => {
		const testDir = join(tmpdir(), `tamias-v002-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })

		const configPath = join(testDir, 'config.json')
		writeFileSync(
			configPath,
			JSON.stringify({
				version: '1.0',
				connections: {},
				bridges: {
					terminal: { enabled: true },
					discords: {
						main: { enabled: true, envKeyName: 'DC_MAIN' },
					},
				},
				_configVersion: 1,
			}),
		)

		const { migration } = await import('../utils/migrations/config/v002_channel_modes')
		await migration.up(testDir)

		const config = JSON.parse(readFileSync(configPath, 'utf-8'))
		expect(config.bridges.discords.main.mode).toBe('mention-only')
		expect(config.bridges.whatsapps).toBeDefined()

		rmSync(testDir, { recursive: true, force: true })
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Migration runner (end-to-end)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: migration runner end-to-end', () => {
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `tamias-runner-e2e-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	test('all layout + config migrations run on a blank directory', async () => {
		// Simulate a completely fresh install (no meta.json, no projects/, etc.)
		const configPath = join(testDir, 'config.json')
		writeFileSync(
			configPath,
			JSON.stringify({ version: '1.0', connections: {}, bridges: { terminal: { enabled: true } } }),
		)

		const report = await runMigrations(testDir)

		// All layout migrations should apply
		const layoutApplied = report.applied.filter(r => r.domain === 'layout')
		expect(layoutApplied.length).toBeGreaterThanOrEqual(3) // v001, v002, v003

		// Filesystem results
		expect(existsSync(join(testDir, 'projects'))).toBe(true)
		expect(existsSync(join(testDir, 'meta.json'))).toBe(true)
		expect(existsSync(join(testDir, 'tenants'))).toBe(true)

		// Config v001 should apply (stamping _configVersion)
		const configApplied = report.applied.filter(r => r.domain === 'config')
		expect(configApplied.length).toBeGreaterThanOrEqual(1)

		// No failures
		expect(report.failed.length).toBe(0)
	})

	test('running migrations a second time skips already-applied ones', async () => {
		const configPath = join(testDir, 'config.json')
		writeFileSync(
			configPath,
			JSON.stringify({ version: '1.0', connections: {}, bridges: { terminal: { enabled: true } } }),
		)

		// First run
		const firstReport = await runMigrations(testDir)
		const firstApplied = firstReport.applied.length

		// Second run
		const secondReport = await runMigrations(testDir)

		// Everything should be skipped now
		expect(secondReport.applied.length).toBe(0)
		expect(secondReport.skipped.length).toBeGreaterThanOrEqual(firstApplied)
		expect(secondReport.failed.length).toBe(0)
	})

	test('getMigrationStatus after full migration shows current versions', () => {
		// Create the artifacts that migrations produce
		mkdirSync(join(testDir, 'projects'), { recursive: true })
		mkdirSync(join(testDir, 'tenants'), { recursive: true })
		writeFileSync(
			join(testDir, 'meta.json'),
			JSON.stringify({ _layoutVersion: 3 }),
		)
		writeFileSync(
			join(testDir, 'config.json'),
			JSON.stringify({ version: '1.0', connections: {}, _configVersion: 2 }),
		)

		const status = getMigrationStatus(testDir)
		expect(status.layout.current).toBe(3)
		expect(status.config.current).toBe(2)
		expect(status.db).toBeDefined()
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DB migrations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: DB migrations', () => {
	test('DB schema is created from scratch with all migrations', () => {
		const dbPath = join(tmpdir(), `tamias-db-integ-${Date.now()}.sqlite`)
		const db = new Database(dbPath)

		// Apply all migrations (mimicking db.ts logic)
		const migrations = [
			`CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				title TEXT DEFAULT 'New conversation',
				projectSlug TEXT,
				summary TEXT,
				createdAt TEXT DEFAULT (datetime('now')),
				updatedAt TEXT DEFAULT (datetime('now'))
			);
			CREATE TABLE IF NOT EXISTS messages (
				id TEXT PRIMARY KEY,
				sessionId TEXT NOT NULL,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				timestamp TEXT DEFAULT (datetime('now'))
			);
			CREATE TABLE IF NOT EXISTS ai_logs (
				id TEXT PRIMARY KEY,
				sessionId TEXT,
				model TEXT,
				provider TEXT,
				promptTokens INTEGER,
				completionTokens INTEGER,
				totalTokens INTEGER,
				durationMs REAL,
				timestamp TEXT DEFAULT (datetime('now'))
			);`,
			`ALTER TABLE sessions ADD COLUMN channelId TEXT;
			ALTER TABLE sessions ADD COLUMN channelUserId TEXT;`,
			`ALTER TABLE sessions ADD COLUMN channelName TEXT;`,
			`CREATE INDEX IF NOT EXISTS idx_ai_logs_timestamp ON ai_logs(timestamp);
			CREATE INDEX IF NOT EXISTS idx_ai_logs_sessionId ON ai_logs(sessionId);
			CREATE INDEX IF NOT EXISTS idx_sessions_updatedAt ON sessions(updatedAt);
			CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channelId, channelUserId);`,
			`ALTER TABLE ai_logs ADD COLUMN tenantId TEXT;
			ALTER TABLE ai_logs ADD COLUMN agentId TEXT;
			ALTER TABLE ai_logs ADD COLUMN channelId TEXT;
			ALTER TABLE ai_logs ADD COLUMN cachedPromptTokens INTEGER;
			ALTER TABLE ai_logs ADD COLUMN systemTokens INTEGER;
			ALTER TABLE ai_logs ADD COLUMN conversationTokens INTEGER;
			ALTER TABLE ai_logs ADD COLUMN toolTokens INTEGER;
			ALTER TABLE ai_logs ADD COLUMN estimatedCostUsd REAL;
			ALTER TABLE sessions ADD COLUMN agentId TEXT;
			ALTER TABLE sessions ADD COLUMN projectSlug TEXT;
			ALTER TABLE sessions ADD COLUMN tenantId TEXT;
			CREATE INDEX IF NOT EXISTS idx_ai_logs_tenantId ON ai_logs(tenantId);
			CREATE INDEX IF NOT EXISTS idx_ai_logs_agentId ON ai_logs(agentId);
			CREATE INDEX IF NOT EXISTS idx_sessions_agentId ON sessions(agentId);
			CREATE INDEX IF NOT EXISTS idx_sessions_tenantId ON sessions(tenantId);`,
		]

		db.transaction(() => {
			for (let i = 0; i < migrations.length; i++) {
				const stmts = migrations[i].split(';').map(s => s.trim()).filter(s => s.length > 0)
				for (const stmt of stmts) {
					try { db.exec(stmt) } catch (err: any) {
						if (err.message.includes('duplicate column name')) continue
						throw err
					}
				}
			}
			db.exec(`PRAGMA user_version = ${migrations.length}`)
		})()

		// Verify final schema
		const ver = db.query<{ user_version: number }, []>('PRAGMA user_version').get()
		expect(ver!.user_version).toBe(5)

		// Verify all expected columns exist
		const sessionCols = db.query<{ name: string }, []>('PRAGMA table_info(sessions)').all().map(r => r.name)
		expect(sessionCols).toContain('id')
		expect(sessionCols).toContain('channelId')
		expect(sessionCols).toContain('channelUserId')
		expect(sessionCols).toContain('channelName')
		expect(sessionCols).toContain('agentId')
		expect(sessionCols).toContain('projectSlug')
		expect(sessionCols).toContain('tenantId')

		const logCols = db.query<{ name: string }, []>('PRAGMA table_info(ai_logs)').all().map(r => r.name)
		expect(logCols).toContain('tenantId')
		expect(logCols).toContain('agentId')
		expect(logCols).toContain('cachedPromptTokens')
		expect(logCols).toContain('systemTokens')
		expect(logCols).toContain('estimatedCostUsd')

		db.close()
		rmSync(dbPath, { force: true })
	})

	test('running DB migrations twice is idempotent (duplicate column swallowed)', () => {
		const dbPath = join(tmpdir(), `tamias-db-idem-${Date.now()}.sqlite`)
		const db = new Database(dbPath)

		const applyAll = () => {
			const migrations = [
				`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS ai_logs (id TEXT PRIMARY KEY);`,
				`ALTER TABLE sessions ADD COLUMN channelId TEXT;`,
				`ALTER TABLE sessions ADD COLUMN channelName TEXT;`,
				`CREATE INDEX IF NOT EXISTS idx_sessions_updatedAt ON sessions(id);`,
				`ALTER TABLE ai_logs ADD COLUMN tenantId TEXT; ALTER TABLE sessions ADD COLUMN agentId TEXT;`,
			]
			const result = db.query<{ user_version: number }, []>('PRAGMA user_version').get()
			const cv = result?.user_version || 0
			for (let i = cv; i < migrations.length; i++) {
				const stmts = migrations[i].split(';').map(s => s.trim()).filter(s => s.length > 0)
				for (const stmt of stmts) {
					try { db.exec(stmt) } catch (err: any) {
						if (err.message.includes('duplicate column name')) continue
						throw err
					}
				}
			}
			db.exec(`PRAGMA user_version = ${migrations.length}`)
		}

		// Run twice — should not throw
		applyAll()
		applyAll()

		const ver = db.query<{ user_version: number }, []>('PRAGMA user_version').get()
		expect(ver!.user_version).toBe(5)

		db.close()
		rmSync(dbPath, { force: true })
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Edge case: completely empty or minimal config
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: edge cases', () => {
	test('minimal config loads with sensible defaults', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
		})

		const config = loadConfig()
		expect(config.version).toBe('1.0')
		expect(config.bridges.terminal.enabled).toBe(true)
		expect(config.debug).toBe(false)
		expect(config.workspacePath).toBe(join(homedir(), '.tamias', 'workspace'))
	})

	test('config with no bridges field loads (Zod defaults)', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			debug: false,
		})

		const config = loadConfig()
		expect(config.bridges).toBeDefined()
		expect(config.bridges.terminal.enabled).toBe(true)
	})

	test('config with unknown extra top-level keys is accepted (Zod strips them)', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			futureFeature: true,
			someRandomField: 'value',
			debug: false,
		})

		// Should load without process.exit
		const config = loadConfig()
		expect(config.version).toBe('1.0')
		// Unknown keys should be stripped
		expect((config as any).futureFeature).toBeUndefined()
		expect((config as any).someRandomField).toBeUndefined()
	})

	test('config when file does not exist returns safe defaults', () => {
		// Point to a path that definitely doesn't exist
		const old = process.env.TAMIAS_CONFIG_PATH
		process.env.TAMIAS_CONFIG_PATH = join(tmpdir(), `nonexistent-${Date.now()}`, 'config.json')

		const config = loadConfig()
		expect(config.version).toBe('1.0')
		expect(config.connections).toEqual({})
		expect(config.bridges.terminal.enabled).toBe(true)
		expect(config.workspacePath).toBeDefined()

		process.env.TAMIAS_CONFIG_PATH = old
	})

	test('sandbox field defaults work when not present in legacy config', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			debug: false,
		})

		const config = loadConfig()
		// sandbox should either be undefined or have defaults
		if (config.sandbox) {
			expect(config.sandbox.engine).toBe('none')
			expect(config.sandbox.image).toBe('ubuntu:22.04')
			expect(config.sandbox.memoryLimit).toBe('512m')
			expect(config.sandbox.networkEnabled).toBe(false)
		}
	})

	test('config with legacy defaultModel but also defaultModels keeps defaultModels', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			defaultModel: 'openai/gpt-4o',
			defaultModels: ['anthropic/claude-3-5-sonnet'],
			debug: false,
		})

		const config = loadConfig()
		// If defaultModels already exists, it should not be replaced
		expect(config.defaultModels).toContain('anthropic/claude-3-5-sonnet')
	})

	test('empty connections does not prune defaultModels', () => {
		writeTestConfig({
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			defaultModels: ['openai/gpt-4o'],
			debug: false,
		})

		const config = loadConfig()
		// With no connections we can't distinguish "just set up" from "all deleted"
		// so defaultModels should be preserved
		expect(config.defaultModels).toContain('openai/gpt-4o')
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Composite: realistic legacy config (all migrations at once)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Legacy: composite realistic config', () => {
	test('a v0 config with all legacy fields migrates cleanly in one load', () => {
		writeTestConfig({
			version: '1.0',
			connections: {
				oai: { nickname: 'oai', provider: 'openai', apiKey: 'sk-live-key' },
				claude: { nickname: 'claude', provider: 'anthropic', accessToken: 'ant-token' },
				local: { nickname: 'local', provider: 'ollama' },
			},
			defaultModel: 'oai/gpt-4o',
			bridges: {
				terminal: { enabled: true },
				discord: { enabled: true, botToken: 'discord-secret' },
				telegram: { enabled: true, botToken: 'telegram-secret', allowedChats: ['-100'] },
			},
			email: {
				nickname: 'gmail',
				service: 'gmail',
				email: 'me@gmail.com',
				appPassword: 'gmail-app-pwd',
			},
			debug: false,
		})

		const config = loadConfig()

		// 1. Connection secrets migrated
		expect(config.connections.oai.apiKey).toBeUndefined()
		expect(config.connections.oai.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(config.connections.oai.envKeyName!)
		expect(getEnv(config.connections.oai.envKeyName!)).toBe('sk-live-key')

		expect(config.connections.claude.accessToken).toBeUndefined()
		expect(config.connections.claude.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(config.connections.claude.envKeyName!)
		expect(getEnv(config.connections.claude.envKeyName!)).toBe('ant-token')

		expect(config.connections.local.envKeyName).toBeUndefined()

		// 2. defaultModel → defaultModels
		expect(config.defaultModels).toEqual(['oai/gpt-4o'])

		// 3. Discord migrated: singular → discords.default, token → env
		expect((config.bridges as any).discord).toBeUndefined()
		expect(config.bridges.discords?.default).toBeDefined()
		expect(config.bridges.discords!.default.botToken).toBeUndefined()
		expect(config.bridges.discords!.default.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(config.bridges.discords!.default.envKeyName!)
		expect(getEnv(config.bridges.discords!.default.envKeyName!)).toBe('discord-secret')

		// 4. Telegram migrated
		expect((config.bridges as any).telegram).toBeUndefined()
		expect(config.bridges.telegrams?.default).toBeDefined()
		expect(config.bridges.telegrams!.default.allowedChats).toEqual(['-100'])
		envKeysCreated.push(config.bridges.telegrams!.default.envKeyName!)
		expect(getEnv(config.bridges.telegrams!.default.envKeyName!)).toBe('telegram-secret')

		// 5. Email migrated: singular → emails.default, appPassword → env
		expect((config as any).email).toBeUndefined()
		expect(config.emails?.default).toBeDefined()
		expect(config.emails!.default.email).toBe('me@gmail.com')
		const emailCfg = config.emails!.default as any
		expect(emailCfg.appPassword).toBeUndefined()
		expect(emailCfg.envKeyName).toBeTypeOf('string')
		envKeysCreated.push(emailCfg.envKeyName!)
		expect(getEnv(emailCfg.envKeyName!)).toBe('gmail-app-pwd')

		// 6. workspacePath added
		expect(config.workspacePath).toBeDefined()

		// 7. Persisted file is fully migrated
		const raw = readRawConfig()
		expect(raw.connections.oai.apiKey).toBeUndefined()
		expect(raw.connections.claude.accessToken).toBeUndefined()
		expect(raw.bridges.discord).toBeUndefined()
		expect(raw.bridges.telegram).toBeUndefined()
		expect(raw.email).toBeUndefined()
		expect(raw.defaultModel).toBeUndefined()
	})
})
