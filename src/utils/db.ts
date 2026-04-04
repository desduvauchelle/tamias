import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, existsSync, readFileSync, renameSync } from 'fs'
import { TAMIAS_DIR } from './config.ts'

mkdirSync(TAMIAS_DIR, { recursive: true })
export const db = new Database(join(TAMIAS_DIR, 'data.sqlite'))

// Enable Write-Ahead Logging (WAL) for better concurrency
// between the daemon and CLI tools.
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

const migrations = [
	// Version 1: Initial schema for sessions, messages, and ai_logs
	`
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		name TEXT,
		model TEXT,
		connectionNickname TEXT,
		modelId TEXT,
		createdAt TEXT,
		updatedAt TEXT,
		summary TEXT
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sessionId TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS ai_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT,
		sessionId TEXT,
		model TEXT,
		provider TEXT,
		action TEXT,
		durationMs INTEGER,
		promptTokens INTEGER,
		completionTokens INTEGER,
		totalTokens INTEGER,
		requestMessagesJson TEXT,
		systemPromptText TEXT,
		requestInputMessagesJson TEXT,
		toolCallsJson TEXT,
		toolResultsJson TEXT,
		usageJson TEXT,
		response TEXT
	);
	`,
	// Version 2: Add bridge metadata to sessions for persistence across restarts
	`
	ALTER TABLE sessions ADD COLUMN channelId TEXT;
	ALTER TABLE sessions ADD COLUMN channelUserId TEXT;
	`,
	// Version 3: Add sub-channel name to sessions
	`
	ALTER TABLE sessions ADD COLUMN channelName TEXT;
	`,
	// Version 4: Add indices for performance
	`
	CREATE INDEX IF NOT EXISTS idx_ai_logs_timestamp ON ai_logs(timestamp);
	CREATE INDEX IF NOT EXISTS idx_ai_logs_sessionId ON ai_logs(sessionId);
	CREATE INDEX IF NOT EXISTS idx_sessions_updatedAt ON sessions(updatedAt);
	CREATE INDEX IF NOT EXISTS idx_sessions_bridge ON sessions(channelId, channelUserId);
	`,
	// Version 5: Enrich ai_logs with tenant/agent/cost breakdown + agent on sessions
	`
	ALTER TABLE ai_logs ADD COLUMN tenantId TEXT;
	ALTER TABLE ai_logs ADD COLUMN agentId TEXT;
	ALTER TABLE ai_logs ADD COLUMN channelId TEXT;
	ALTER TABLE ai_logs ADD COLUMN cachedPromptTokens INTEGER;
	ALTER TABLE ai_logs ADD COLUMN systemTokens INTEGER;
	ALTER TABLE ai_logs ADD COLUMN conversationTokens INTEGER;
	ALTER TABLE ai_logs ADD COLUMN toolTokens INTEGER;
	ALTER TABLE ai_logs ADD COLUMN estimatedCostUsd REAL;
	ALTER TABLE ai_logs ADD COLUMN providerCostUsd REAL;
	ALTER TABLE ai_logs ADD COLUMN systemPromptText TEXT;
	ALTER TABLE ai_logs ADD COLUMN requestInputMessagesJson TEXT;
	ALTER TABLE ai_logs ADD COLUMN toolCallsJson TEXT;
	ALTER TABLE ai_logs ADD COLUMN toolResultsJson TEXT;
	ALTER TABLE ai_logs ADD COLUMN usageJson TEXT;
	ALTER TABLE sessions ADD COLUMN agentId TEXT;
	ALTER TABLE sessions ADD COLUMN projectSlug TEXT;
	ALTER TABLE sessions ADD COLUMN tenantId TEXT;
	CREATE INDEX IF NOT EXISTS idx_ai_logs_tenantId ON ai_logs(tenantId);
	CREATE INDEX IF NOT EXISTS idx_ai_logs_agentId ON ai_logs(agentId);
	CREATE INDEX IF NOT EXISTS idx_sessions_agentId ON sessions(agentId);
	CREATE INDEX IF NOT EXISTS idx_sessions_projectSlug ON sessions(projectSlug);
	`,
	// Version 6: Add explicit rich tracing fields to ai_logs for dashboard/audit views
	`
	ALTER TABLE ai_logs ADD COLUMN providerCostUsd REAL;
	ALTER TABLE ai_logs ADD COLUMN systemPromptText TEXT;
	ALTER TABLE ai_logs ADD COLUMN requestInputMessagesJson TEXT;
	ALTER TABLE ai_logs ADD COLUMN toolCallsJson TEXT;
	ALTER TABLE ai_logs ADD COLUMN toolResultsJson TEXT;
	ALTER TABLE ai_logs ADD COLUMN usageJson TEXT;
	CREATE INDEX IF NOT EXISTS idx_ai_logs_provider ON ai_logs(provider);
	CREATE INDEX IF NOT EXISTS idx_ai_logs_model ON ai_logs(model);
	`,
	// Version 7: Unified logs table for daemon/channel/message/ai/tool/error timeline
	`
	CREATE TABLE IF NOT EXISTS unified_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT NOT NULL,
		source TEXT NOT NULL,
		type TEXT NOT NULL,
		level TEXT NOT NULL DEFAULT 'info',
		sessionId TEXT,
		channelId TEXT,
		channelUserId TEXT,
		agentId TEXT,
		tenantId TEXT,
		message TEXT NOT NULL,
		metadataJson TEXT,
		aiLogId INTEGER,
		FOREIGN KEY(aiLogId) REFERENCES ai_logs(id) ON DELETE SET NULL
	);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_timestamp ON unified_logs(timestamp);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_source ON unified_logs(source);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_type ON unified_logs(type);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_level ON unified_logs(level);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_sessionId ON unified_logs(sessionId);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_channelId ON unified_logs(channelId);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_channelUserId ON unified_logs(channelUserId);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_agentId ON unified_logs(agentId);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_tenantId ON unified_logs(tenantId);
	CREATE INDEX IF NOT EXISTS idx_unified_logs_source_type ON unified_logs(source, type);
	`,
	// Version 8: Archive table for ai_logs older than 30 days (replaces ~/.tamias/archive/history.json)
	`
	CREATE TABLE IF NOT EXISTS ai_logs_archive (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT,
		sessionId TEXT,
		model TEXT,
		provider TEXT,
		action TEXT,
		durationMs INTEGER,
		promptTokens INTEGER,
		completionTokens INTEGER,
		totalTokens INTEGER,
		estimatedCostUsd REAL,
		tenantId TEXT,
		agentId TEXT,
		channelId TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_archive_timestamp ON ai_logs_archive(timestamp);
	CREATE INDEX IF NOT EXISTS idx_archive_model ON ai_logs_archive(model);
	CREATE INDEX IF NOT EXISTS idx_archive_sessionId ON ai_logs_archive(sessionId);
	`
]

// Run migrations inside a transaction
db.transaction(() => {
	const result = db.query<{ user_version: number }, []>('PRAGMA user_version').get()
	const currentVersion = result?.user_version || 0

	for (let i = currentVersion; i < migrations.length; i++) {
		const statements = migrations[i].split(';').map(s => s.trim()).filter(s => s.length > 0)
		for (const stmt of statements) {
			try {
				db.exec(stmt)
			} catch (err: any) {
				if (err.message.includes('duplicate column name')) {
					continue
				}
				throw err
			}
		}
	}

	db.exec(`PRAGMA user_version = ${migrations.length}`)

	// One-time import: migrate existing history.json into ai_logs_archive
	if (currentVersion < 8) {
		const archiveFile = join(TAMIAS_DIR, 'archive', 'history.json')
		if (existsSync(archiveFile)) {
			try {
				const raw = readFileSync(archiveFile, 'utf-8')
				const entries = JSON.parse(raw) as any[]
				if (Array.isArray(entries) && entries.length > 0) {
					const insert = db.prepare(`
						INSERT INTO ai_logs_archive (timestamp, sessionId, model, provider, action, durationMs,
							promptTokens, completionTokens, totalTokens, estimatedCostUsd, tenantId, agentId, channelId)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					`)
					for (const e of entries) {
						insert.run(
							e.timestamp ?? null, e.sessionId ?? null, e.model ?? null,
							e.provider ?? null, e.action ?? null, e.durationMs ?? null,
							e.promptTokens ?? null, e.completionTokens ?? null, e.totalTokens ?? null,
							e.estimatedCostUsd ?? null, e.tenantId ?? null, e.agentId ?? null, e.channelId ?? null
						)
					}
					console.log(`[DB Migration] Imported ${entries.length} archived entries from history.json`)
				}
				renameSync(archiveFile, archiveFile + '.migrated')
				console.log('[DB Migration] Renamed history.json to history.json.migrated')
			} catch (err) {
				console.error('[DB Migration] Failed to import history.json:', err)
			}
		}
	}
})()
