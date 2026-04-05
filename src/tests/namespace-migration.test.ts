import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateToolNamespaces, type TamiasConfig } from '../utils/config.ts'

/** Helper: build a minimal valid config with optional internalTools */
function makeConfig(internalTools: Record<string, { enabled: boolean; functions?: Record<string, { enabled: boolean }> }>): TamiasConfig {
	return {
		version: '1.0',
		connections: {},
		bridges: { terminal: { enabled: true } },
		debug: false,
		ngrok: { enabled: false },
		internalTools,
	}
}

describe('migrateToolNamespaces', () => {
	test('returns false when no internalTools present', () => {
		const config: TamiasConfig = {
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			debug: false,
			ngrok: { enabled: false },
		}
		expect(migrateToolNamespaces(config)).toBe(false)
	})

	test('returns false when no old keys present', () => {
		const config = makeConfig({
			files: { enabled: true },
			agents: { enabled: true },
		})
		expect(migrateToolNamespaces(config)).toBe(false)
	})

	// --- Simple 1:1 renames ---

	test('migrates terminal → files', () => {
		const config = makeConfig({ terminal: { enabled: true } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['terminal']).toBeUndefined()
		expect(config.internalTools!['files']).toEqual({ enabled: true })
	})

	test('migrates workspace → files', () => {
		const config = makeConfig({ workspace: { enabled: false } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['workspace']).toBeUndefined()
		expect(config.internalTools!['files']).toEqual({ enabled: false })
	})

	test('migrates browser → web', () => {
		const config = makeConfig({ browser: { enabled: true } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['browser']).toBeUndefined()
		expect(config.internalTools!['web']).toEqual({ enabled: true })
	})

	test('migrates subagent → agents', () => {
		const config = makeConfig({ subagent: { enabled: true } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['subagent']).toBeUndefined()
		expect(config.internalTools!['agents']).toEqual({ enabled: true })
	})

	test('migrates image → media', () => {
		const config = makeConfig({ image: { enabled: true } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['image']).toBeUndefined()
		expect(config.internalTools!['media']).toEqual({ enabled: true })
	})

	test('migrates coding_cli → files', () => {
		const config = makeConfig({ coding_cli: { enabled: true } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['coding_cli']).toBeUndefined()
		expect(config.internalTools!['files']).toEqual({ enabled: true })
	})

	test('migrates gemini → files', () => {
		const config = makeConfig({ gemini: { enabled: false } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['gemini']).toBeUndefined()
		expect(config.internalTools!['files']).toEqual({ enabled: false })
	})

	// --- Conflict resolution: old key disabled, new key already exists enabled ---

	test('disabled old key propagates to enabled new key', () => {
		const config = makeConfig({
			terminal: { enabled: false },
			files: { enabled: true },
		})
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['terminal']).toBeUndefined()
		expect(config.internalTools!['files']!.enabled).toBe(false)
	})

	test('does not overwrite new key when old key is enabled and new key already exists', () => {
		const config = makeConfig({
			terminal: { enabled: true },
			files: { enabled: true, functions: { run_command: { enabled: false } } },
		})
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['terminal']).toBeUndefined()
		// Existing new key config should be preserved (not overwritten by old key)
		expect(config.internalTools!['files']!.functions!['run_command']).toEqual({ enabled: false })
	})

	// --- Multiple old keys mapping to same new key ---

	test('handles multiple old keys mapping to the same new key (terminal + workspace → files)', () => {
		const config = makeConfig({
			terminal: { enabled: true },
			workspace: { enabled: true },
		})
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['terminal']).toBeUndefined()
		expect(config.internalTools!['workspace']).toBeUndefined()
		expect(config.internalTools!['files']).toBeDefined()
	})

	// --- Tamias split ---

	test('disabled tamias disables all successor namespaces', () => {
		const config = makeConfig({ tamias: { enabled: false } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['tamias']).toBeUndefined()
		expect(config.internalTools!['config']!.enabled).toBe(false)
		expect(config.internalTools!['daemon']!.enabled).toBe(false)
		expect(config.internalTools!['channels']!.enabled).toBe(false)
	})

	test('enabled tamias is removed without disabling successors', () => {
		const config = makeConfig({ tamias: { enabled: true } })
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['tamias']).toBeUndefined()
		// Successors should NOT be created (they default to enabled)
		expect(config.internalTools!['config']).toBeUndefined()
		expect(config.internalTools!['daemon']).toBeUndefined()
		expect(config.internalTools!['channels']).toBeUndefined()
	})

	test('disabled tamias does not override explicit successor config', () => {
		const config = makeConfig({
			tamias: { enabled: false },
			config: { enabled: true }, // user explicitly enabled config
		})
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['tamias']).toBeUndefined()
		// Explicitly set successor should not be overridden
		expect(config.internalTools!['config']!.enabled).toBe(true)
		// Others should be disabled
		expect(config.internalTools!['daemon']!.enabled).toBe(false)
		expect(config.internalTools!['channels']!.enabled).toBe(false)
	})

	// --- Function-level config preservation ---

	test('preserves function-level config through migration', () => {
		const config = makeConfig({
			terminal: {
				enabled: true,
				functions: {
					run_command: { enabled: false },
					read_file: { enabled: true },
				},
			},
		})
		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)
		expect(config.internalTools!['files']!.functions!['run_command']).toEqual({ enabled: false })
		expect(config.internalTools!['files']!.functions!['read_file']).toEqual({ enabled: true })
	})

	// --- Full migration scenario ---

	test('migrates a realistic config with multiple old keys', () => {
		const config = makeConfig({
			terminal: { enabled: true },
			workspace: { enabled: true },
			tamias: { enabled: true },
			browser: { enabled: true },
			websearch: { enabled: false },
			subagent: { enabled: true },
			session: { enabled: true },
			swarm: { enabled: true },
			image: { enabled: true },
			pdf: { enabled: true },
			coding_cli: { enabled: true },
			gemini: { enabled: true },
			// These should be untouched:
			memory: { enabled: true },
			github: { enabled: true },
			cron: { enabled: true },
			email: { enabled: true },
			projects: { enabled: true },
		})

		const changed = migrateToolNamespaces(config)
		expect(changed).toBe(true)

		// All old keys gone
		for (const oldKey of ['terminal', 'workspace', 'tamias', 'browser', 'websearch', 'subagent', 'session', 'swarm', 'image', 'pdf', 'coding_cli', 'gemini']) {
			expect(config.internalTools![oldKey]).toBeUndefined()
		}

		// New keys exist
		expect(config.internalTools!['files']).toBeDefined()
		expect(config.internalTools!['web']).toBeDefined()
		expect(config.internalTools!['agents']).toBeDefined()
		expect(config.internalTools!['media']).toBeDefined()

		// Untouched keys remain
		expect(config.internalTools!['memory']!.enabled).toBe(true)
		expect(config.internalTools!['github']!.enabled).toBe(true)
		expect(config.internalTools!['cron']!.enabled).toBe(true)
		expect(config.internalTools!['email']!.enabled).toBe(true)
		expect(config.internalTools!['projects']!.enabled).toBe(true)
	})
})
