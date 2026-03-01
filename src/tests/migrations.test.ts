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

	describe('Layout Migration v004 — MEMORY.md format upgrade', () => {
		const LEGACY_MEMORY = `# MEMORY.md — Living Project Registry

## Active Projects

| Name | Description | Folder | Channel |
|------|-------------|--------|---------|
| tamias | Main codebase | ~/code/tamias | #dev |

## Recent Activity

- [2026-02-28 09] (tamias): Fixed migration runner
`
		const SETTINGS_EMPTY = `# SETTINGS.md — Project Constitution

## Projects

| Name | Description | Folder | Channel |
|------|-------------|--------|---------|

## Preferences

- (none yet)
`

		test('skips when no memory dir exists', async () => {
			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const result = await migration.up(testDir)
			expect(result.success).toBe(true)
			expect(result.message).toContain('No memory dir')
		})

		test('skips when no MEMORY.md exists', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const result = await migration.up(testDir)
			expect(result.success).toBe(true)
			expect(result.message).toContain('No MEMORY.md')
		})

		test('skips when MEMORY.md already in new format', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			writeFileSync(join(memDir, 'MEMORY.md'), '# MEMORY.md — Recent Activity & Lessons\n\n## Last Session\n\n*(nothing yet)*\n')
			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const result = await migration.up(testDir)
			expect(result.success).toBe(true)
			expect(result.message).toContain('new format')
		})

		test('detects legacy format and defers when no AI available', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			writeFileSync(join(memDir, 'MEMORY.md'), LEGACY_MEMORY)
			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			// No aiGenerate passed → should defer
			const result = await migration.up(testDir)
			expect(result.success).toBe(true)
			expect(result.deferred).toBe(true)
			// Original file should be untouched
			expect(readFileSync(join(memDir, 'MEMORY.md'), 'utf-8')).toBe(LEGACY_MEMORY)
		})

		test('rewrites legacy MEMORY.md with AI and migrates projects to SETTINGS.md', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			writeFileSync(join(memDir, 'MEMORY.md'), LEGACY_MEMORY)
			writeFileSync(join(memDir, 'SETTINGS.md'), SETTINGS_EMPTY)

			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const aiGenerate = async (_prompt: string) => JSON.stringify({
				newMemory: '# MEMORY.md — Recent Activity & Lessons\n\n## Last Session\n\nFixed migration runner.\n\n## Lessons Learned\n\n- Keep migrations small.\n\n## Pending\n\n- (none)\n',
				projectRows: '| tamias | Main codebase | ~/code/tamias | #dev |',
			})

			const result = await migration.up(testDir, aiGenerate)
			expect(result.success).toBe(true)
			expect(result.message).toContain('Reformatted MEMORY.md')

			const newMemory = readFileSync(join(memDir, 'MEMORY.md'), 'utf-8')
			expect(newMemory).toContain('## Last Session')
			expect(newMemory).not.toContain('## Active Projects')

			const newSettings = readFileSync(join(memDir, 'SETTINGS.md'), 'utf-8')
			expect(newSettings).toContain('tamias')
			expect(result.message).toContain('SETTINGS.md')
		})

		test('rewrites MEMORY.md even when SETTINGS.md is absent', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			writeFileSync(join(memDir, 'MEMORY.md'), LEGACY_MEMORY)

			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const aiGenerate = async (_prompt: string) => JSON.stringify({
				newMemory: '# MEMORY.md — Recent Activity & Lessons\n\n## Last Session\n\n*(migrated)*\n\n## Lessons Learned\n\n- (none)\n\n## Pending\n\n- (none)\n',
				projectRows: '',
			})

			const result = await migration.up(testDir, aiGenerate)
			expect(result.success).toBe(true)
			const newMemory = readFileSync(join(memDir, 'MEMORY.md'), 'utf-8')
			expect(newMemory).toContain('## Last Session')
		})

		test('falls back gracefully when AI returns invalid JSON', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			writeFileSync(join(memDir, 'MEMORY.md'), LEGACY_MEMORY)

			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const aiGenerate = async (_prompt: string) => 'oops not json at all'

			const result = await migration.up(testDir, aiGenerate)
			expect(result.success).toBe(true)
			const newMemory = readFileSync(join(memDir, 'MEMORY.md'), 'utf-8')
			// Fallback: original content preserved under a new heading
			expect(newMemory).toContain('# MEMORY.md')
			expect(newMemory).toContain(LEGACY_MEMORY.trim())
		})

		test('archives legacy SYSTEM.md alongside MEMORY.md migration', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			writeFileSync(join(memDir, 'MEMORY.md'), LEGACY_MEMORY)
			writeFileSync(join(memDir, 'SYSTEM.md'), '# old system stuff')

			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const aiGenerate = async (_prompt: string) => JSON.stringify({
				newMemory: '# MEMORY.md — Recent Activity & Lessons\n\n## Last Session\n\n*(done)*\n\n## Lessons Learned\n\n## Pending\n',
				projectRows: '',
			})

			await migration.up(testDir, aiGenerate)
			expect(existsSync(join(memDir, 'SYSTEM.md'))).toBe(false)
			expect(existsSync(join(memDir, 'legacy-SYSTEM.md.bak'))).toBe(true)
		})

		test('archives SYSTEM.md even when MEMORY.md is already in new format', async () => {
			const memDir = join(testDir, 'memory')
			mkdirSync(memDir, { recursive: true })
			writeFileSync(join(memDir, 'MEMORY.md'), '# MEMORY.md — Recent Activity & Lessons\n\n## Last Session\n\n*(none)*\n')
			writeFileSync(join(memDir, 'SYSTEM.md'), '# old system')

			const { migration } = await import('../utils/migrations/layout/v004_memory_format_upgrade')
			const result = await migration.up(testDir)
			expect(result.success).toBe(true)
			expect(result.message).toContain('legacy-SYSTEM.md.bak')
			expect(existsSync(join(memDir, 'SYSTEM.md'))).toBe(false)
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
