import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

// We need to test the migration runner with a temporary directory
describe('Migration System', () => {
	const testDir = join(tmpdir(), `tamias-test-migrations-${Date.now()}`)

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	describe('Layout Migrations', () => {
		test('v001: creates projects directory', async () => {
			const { migration } = await import('../utils/migrations/layout/v001_projects_dir')
			await migration.up(testDir)
			expect(existsSync(join(testDir, 'projects'))).toBe(true)
		})

		test('v002: creates meta.json', async () => {
			const { migration } = await import('../utils/migrations/layout/v002_meta_json')
			await migration.up(testDir)
			const metaPath = join(testDir, 'meta.json')
			expect(existsSync(metaPath)).toBe(true)
			const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
			expect(meta._layoutVersion).toBeDefined()
		})

		test('v003: creates tenants directory', async () => {
			const { migration } = await import('../utils/migrations/layout/v003_tenants_dir')
			await migration.up(testDir)
			expect(existsSync(join(testDir, 'tenants'))).toBe(true)
		})
	})

	describe('Config Migrations', () => {
		test('v001: adds _configVersion to config.json', async () => {
			const configPath = join(testDir, 'config.json')
			writeFileSync(configPath, JSON.stringify({ version: '1.0', connections: {} }))

			const { migration } = await import('../utils/migrations/config/v001_config_version')
			await migration.up(testDir)

			const config = JSON.parse(readFileSync(configPath, 'utf-8'))
			expect(config._configVersion).toBeDefined()
		})

		test('v002: adds whatsapps to bridges and channel modes', async () => {
			const configPath = join(testDir, 'config.json')
			writeFileSync(configPath, JSON.stringify({
				version: '1.0',
				connections: {},
				bridges: {
					terminal: { enabled: true },
					discords: { default: { enabled: true } }
				},
				_configVersion: 1
			}))

			const { migration } = await import('../utils/migrations/config/v002_channel_modes')
			await migration.up(testDir)

			const config = JSON.parse(readFileSync(configPath, 'utf-8'))
			expect(config.bridges.whatsapps).toBeDefined()
		})
	})

	describe('Migration Runner', () => {
		test('getMigrationStatus returns correct status', async () => {
			const { getMigrationStatus } = await import('../utils/migrations/index')
			mkdirSync(join(testDir, 'projects'), { recursive: true })
			mkdirSync(join(testDir, 'tenants'), { recursive: true })
			writeFileSync(join(testDir, 'meta.json'), JSON.stringify({ layoutVersion: 3 }))

			const status = getMigrationStatus(testDir)
			expect(status.layout).toBeDefined()
			expect(status.config).toBeDefined()
			expect(status.db).toBeDefined()
		})
	})
})
