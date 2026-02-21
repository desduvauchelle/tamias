import { Database } from 'bun:sqlite'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync } from 'fs'

const DB_DIR = join(homedir(), '.tamias')
if (!existsSync(DB_DIR)) {
	mkdirSync(DB_DIR, { recursive: true })
}

export const db = new Database(join(DB_DIR, 'data.sqlite'))

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
})()
