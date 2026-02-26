/**
 * Types for the Tamias migration system.
 *
 * Three versioned domains:
 *   - config: `config.json` schema changes
 *   - layout: filesystem directory/file structure changes
 *   - db: SQLite schema changes
 */

export type MigrationDomain = 'config' | 'layout' | 'db'

export interface MigrationResult {
	success: boolean
	message: string
	/** If AI-assisted and no model was available, defer for later */
	deferred?: boolean
}

export interface Migration {
	/** Sequential version number within its domain (1-based) */
	version: number
	domain: MigrationDomain
	description: string
	/**
	 * If true, this migration uses an AI call to transform content.
	 * The runner will use the cheapest available model.
	 * If no model is configured, the migration is deferred.
	 */
	aiAssisted?: boolean
	/**
	 * Execute the migration. Receives the tamias data directory path.
	 * For AI-assisted migrations, also receives a generateText function.
	 */
	up: (tamiasDirPath: string, aiGenerate?: AiGenerateFn) => Promise<MigrationResult>
}

/** Minimal AI text generation function passed to AI-assisted migrations */
export type AiGenerateFn = (prompt: string) => Promise<string>

export interface MigrationMeta {
	/** Version of the config.json schema */
	_configVersion: number
	/** Version of the filesystem layout */
	_layoutVersion: number
	/** Tenant identifier — "default" for root install */
	tenantId: string
	createdAt: string
	lastMigratedAt: string
	/** Migrations that were deferred (AI-assisted, no model available) */
	deferredMigrations?: Array<{ domain: MigrationDomain; version: number; description: string }>
}

export const DEFAULT_META: MigrationMeta = {
	_configVersion: 0,
	_layoutVersion: 0,
	tenantId: 'default',
	createdAt: new Date().toISOString(),
	lastMigratedAt: new Date().toISOString(),
	deferredMigrations: [],
}
