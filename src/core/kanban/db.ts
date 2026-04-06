import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { TAMIAS_DIR } from '../../utils/config.ts'
import { initKanbanSchema, migrateFromKanbanJson } from './schema.ts'

const PROJECTS_DIR = join(TAMIAS_DIR, 'workspace')

const databases = new Map<string, Database>()

export function openKanbanDb(projectId: string): Database {
	const existing = databases.get(projectId)
	if (existing) return existing

	const dir = join(PROJECTS_DIR, projectId)
	mkdirSync(dir, { recursive: true })

	const dbPath = join(dir, 'kanban.db')
	const db = new Database(dbPath, { create: true })
	db.exec('PRAGMA journal_mode = WAL')
	db.exec('PRAGMA foreign_keys = ON')
	db.exec('PRAGMA cache_size = -2000')
	db.exec('PRAGMA mmap_size = 64000000')

	initKanbanSchema(db)
	migrateFromKanbanJson(db, dir)

	databases.set(projectId, db)
	return db
}

export function getKanbanDb(projectId: string): Database | undefined {
	return databases.get(projectId)
}

export function closeKanbanDb(projectId: string): void {
	const db = databases.get(projectId)
	if (db) {
		try { db.exec('PRAGMA wal_checkpoint(PASSIVE)') } catch { }
		db.close()
		databases.delete(projectId)
	}
}

export function closeAllKanbanDbs(): void {
	for (const [id] of databases) {
		closeKanbanDb(id)
	}
}

/** For testing: create an in-memory database */
export function getTestKanbanDb(): Database {
	const db = new Database(':memory:')
	db.exec('PRAGMA foreign_keys = ON')
	initKanbanSchema(db)
	return db
}
