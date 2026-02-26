/**
 * Migration runner for Tamias.
 *
 * Reads current versions from meta.json (layout), config.json (_configVersion),
 * and SQLite (user_version pragma), then applies pending migrations in order.
 *
 * Called automatically on every daemon start.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Migration, MigrationMeta, MigrationDomain, MigrationResult, AiGenerateFn } from './types'
import { DEFAULT_META } from './types'

// ─── Layout Migrations (filesystem) ──────────────────────────────────────────
import { migration as layout_v001 } from './layout/v001_projects_dir'
import { migration as layout_v002 } from './layout/v002_meta_json'
import { migration as layout_v003 } from './layout/v003_tenants_dir'

// ─── Config Migrations (config.json) ─────────────────────────────────────────
import { migration as config_v001 } from './config/v001_config_version'
import { migration as config_v002 } from './config/v002_channel_modes'

const LAYOUT_MIGRATIONS: Migration[] = [layout_v001, layout_v002, layout_v003]
const CONFIG_MIGRATIONS: Migration[] = [config_v001, config_v002]

// DB migrations are handled separately by src/utils/db.ts's inline migration array.
// We track them here for status reporting only.
const DB_MIGRATION_COUNT = 5 // current max version in db.ts

export interface MigrationReport {
	applied: Array<{ domain: MigrationDomain; version: number; description: string; result: MigrationResult }>
	skipped: Array<{ domain: MigrationDomain; version: number; description: string; reason: string }>
	failed: Array<{ domain: MigrationDomain; version: number; description: string; error: string }>
	deferred: Array<{ domain: MigrationDomain; version: number; description: string }>
}

/** Read meta.json or return defaults if it doesn't exist */
function readMeta(tamiasDirPath: string): MigrationMeta {
	const metaPath = join(tamiasDirPath, 'meta.json')
	if (!existsSync(metaPath)) {
		return { ...DEFAULT_META }
	}
	try {
		return JSON.parse(readFileSync(metaPath, 'utf-8'))
	} catch {
		return { ...DEFAULT_META }
	}
}

/** Write meta.json */
function writeMeta(tamiasDirPath: string, meta: MigrationMeta): void {
	const metaPath = join(tamiasDirPath, 'meta.json')
	writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
}

/** Get current config version from config.json */
function getConfigVersion(tamiasDirPath: string): number {
	const configPath = join(tamiasDirPath, 'config.json')
	if (!existsSync(configPath)) return 0
	try {
		const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
		return raw._configVersion ?? 0
	} catch {
		return 0
	}
}

/**
 * Run all pending migrations for a tamias data directory.
 * Returns a detailed report of what was applied, skipped, failed, or deferred.
 */
export async function runMigrations(
	tamiasDirPath: string,
	aiGenerate?: AiGenerateFn,
	dryRun = false,
): Promise<MigrationReport> {
	// Ensure base directory exists
	if (!existsSync(tamiasDirPath)) {
		mkdirSync(tamiasDirPath, { recursive: true })
	}

	const report: MigrationReport = { applied: [], skipped: [], failed: [], deferred: [] }

	// ── Layout Migrations ──
	const meta = readMeta(tamiasDirPath)
	const currentLayoutVersion = meta._layoutVersion ?? 0

	for (const migration of LAYOUT_MIGRATIONS) {
		if (migration.version <= currentLayoutVersion) {
			report.skipped.push({
				domain: 'layout',
				version: migration.version,
				description: migration.description,
				reason: 'Already applied',
			})
			continue
		}

		if (migration.aiAssisted && !aiGenerate) {
			report.deferred.push({
				domain: 'layout',
				version: migration.version,
				description: migration.description,
			})
			// Track deferred
			if (!meta.deferredMigrations) meta.deferredMigrations = []
			meta.deferredMigrations.push({ domain: 'layout', version: migration.version, description: migration.description })
			continue
		}

		if (dryRun) {
			report.applied.push({
				domain: 'layout',
				version: migration.version,
				description: migration.description,
				result: { success: true, message: '[DRY RUN] Would apply' },
			})
			continue
		}

		try {
			const result = await migration.up(tamiasDirPath, aiGenerate)
			report.applied.push({ domain: 'layout', version: migration.version, description: migration.description, result })
			meta._layoutVersion = migration.version
			meta.lastMigratedAt = new Date().toISOString()
		} catch (err: any) {
			report.failed.push({
				domain: 'layout',
				version: migration.version,
				description: migration.description,
				error: err.message || String(err),
			})
			// Layout migrations are non-fatal — continue
			console.error(`[Migration] Layout v${migration.version} failed: ${err.message}`)
		}
	}

	// ── Config Migrations ──
	const currentConfigVersion = getConfigVersion(tamiasDirPath)

	for (const migration of CONFIG_MIGRATIONS) {
		if (migration.version <= currentConfigVersion) {
			report.skipped.push({
				domain: 'config',
				version: migration.version,
				description: migration.description,
				reason: 'Already applied',
			})
			continue
		}

		if (migration.aiAssisted && !aiGenerate) {
			report.deferred.push({ domain: 'config', version: migration.version, description: migration.description })
			if (!meta.deferredMigrations) meta.deferredMigrations = []
			meta.deferredMigrations.push({ domain: 'config', version: migration.version, description: migration.description })
			continue
		}

		if (dryRun) {
			report.applied.push({
				domain: 'config',
				version: migration.version,
				description: migration.description,
				result: { success: true, message: '[DRY RUN] Would apply' },
			})
			continue
		}

		try {
			const result = await migration.up(tamiasDirPath, aiGenerate)
			report.applied.push({ domain: 'config', version: migration.version, description: migration.description, result })
			meta._configVersion = migration.version
			meta.lastMigratedAt = new Date().toISOString()
		} catch (err: any) {
			report.failed.push({
				domain: 'config',
				version: migration.version,
				description: migration.description,
				error: err.message || String(err),
			})
			console.error(`[Migration] Config v${migration.version} failed: ${err.message}`)
		}
	}

	// Write updated meta
	if (!dryRun) {
		writeMeta(tamiasDirPath, meta)
	}

	return report
}

/** Get a summary of current migration state */
export function getMigrationStatus(tamiasDirPath: string): {
	config: { current: number; latest: number; pending: number }
	layout: { current: number; latest: number; pending: number }
	db: { latest: number }
	deferred: Array<{ domain: MigrationDomain; version: number; description: string }>
} {
	const meta = readMeta(tamiasDirPath)
	const configVersion = getConfigVersion(tamiasDirPath)

	return {
		config: {
			current: configVersion,
			latest: CONFIG_MIGRATIONS.length > 0 ? CONFIG_MIGRATIONS[CONFIG_MIGRATIONS.length - 1].version : 0,
			pending: Math.max(0, (CONFIG_MIGRATIONS.length > 0 ? CONFIG_MIGRATIONS[CONFIG_MIGRATIONS.length - 1].version : 0) - configVersion),
		},
		layout: {
			current: meta._layoutVersion ?? 0,
			latest: LAYOUT_MIGRATIONS.length > 0 ? LAYOUT_MIGRATIONS[LAYOUT_MIGRATIONS.length - 1].version : 0,
			pending: Math.max(0, (LAYOUT_MIGRATIONS.length > 0 ? LAYOUT_MIGRATIONS[LAYOUT_MIGRATIONS.length - 1].version : 0) - (meta._layoutVersion ?? 0)),
		},
		db: {
			latest: DB_MIGRATION_COUNT,
		},
		deferred: meta.deferredMigrations ?? [],
	}
}

/** Re-export for convenience */
export { readMeta, writeMeta }
