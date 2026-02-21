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
	`
]

// Run migrations inside a transaction
db.transaction(() => {
	const result = db.query<{ user_version: number }, []>('PRAGMA user_version').get()
	const currentVersion = result?.user_version || 0

	for (let i = currentVersion; i < migrations.length; i++) {
		db.exec(migrations[i])
	}

	db.exec(`PRAGMA user_version = ${migrations.length}`)
})()
