import type { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { existsSync, readFileSync, renameSync } from 'node:fs'

export function initKanbanSchema(db: Database): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'backlog' CHECK(status IN ('backlog','queue','in-progress','done','failed')),
      position INTEGER NOT NULL DEFAULT 0,
      blocking INTEGER NOT NULL DEFAULT 0,
      plan_thinking TEXT DEFAULT NULL,
      execute_thinking TEXT DEFAULT NULL,
      auto_commit INTEGER DEFAULT NULL,
      auto_push INTEGER DEFAULT NULL,
      cli_provider TEXT DEFAULT NULL,
      cli_custom_command TEXT DEFAULT NULL,
      branch_mode TEXT NOT NULL DEFAULT 'current',
      branch_name TEXT DEFAULT NULL,
      assignee TEXT NOT NULL DEFAULT 'ai',
      priority TEXT DEFAULT NULL,
      due_date TEXT DEFAULT NULL,
      labels TEXT NOT NULL DEFAULT '[]',
      reaction TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (task_id, tag)
    );

    CREATE TABLE IF NOT EXISTS task_files (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      PRIMARY KEY (task_id, file_path)
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      session_id TEXT,
      phase TEXT NOT NULL DEFAULT 'plan' CHECK(phase IN ('plan','execute')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','failed','cancelled')),
      output TEXT NOT NULL DEFAULT '',
      cost_usd REAL NOT NULL DEFAULT 0,
      exit_code INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      pid INTEGER,
      files_changed TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author TEXT NOT NULL CHECK(author IN ('user','system','ai')),
      content TEXT NOT NULL,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_comments_task_id ON comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id);
  `)
}

/**
 * Migrate existing kanban.json to SQLite on first open.
 * Renames kanban.json to kanban.json.migrated after successful migration.
 */
export function migrateFromKanbanJson(db: Database, projectDir: string): void {
	const jsonPath = join(projectDir, 'kanban.json')
	if (!existsSync(jsonPath)) return

	try {
		const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
		if (!Array.isArray(raw)) return

		const insert = db.prepare(`
      INSERT OR IGNORE INTO tasks (
        id, title, description, details, status, position,
        assignee, priority, due_date, labels, reaction, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

		const tx = db.transaction(() => {
			for (let i = 0; i < raw.length; i++) {
				const t = raw[i]
				if (!t || !t.id || !t.title) continue
				// Map old status values to new schema
				const statusMap: Record<string, string> = {
					todo: 'backlog',
					'awaiting-review': 'queue',
					queue: 'queue',
					backlog: 'backlog',
					'in-progress': 'in-progress',
					done: 'done',
					failed: 'failed',
				}
				const status = statusMap[t.status] ?? 'backlog'
				insert.run(
					t.id,
					t.title,
					t.description ?? '',
					t.details ?? '',
					status,
					t.order ?? i,
					t.assignee ?? 'ai',
					t.priority ?? null,
					t.dueDate ? new Date(t.dueDate).toISOString() : null,
					JSON.stringify(t.labels ?? []),
					t.reaction ?? null,
					t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
					new Date().toISOString(),
				)

				// Migrate comments
				if (Array.isArray(t.comments)) {
					const commentInsert = db.prepare(`
            INSERT OR IGNORE INTO comments (id, task_id, author, content)
            VALUES (?, ?, ?, ?)
          `)
					for (const c of t.comments) {
						if (!c.id || !c.text) continue
						const author = c.author === 'AI Assistant' ? 'ai' : 'user'
						commentInsert.run(c.id, t.id, author, c.text)
					}
				}
			}
		})
		tx()

		renameSync(jsonPath, jsonPath + '.migrated')
	} catch (err) {
		console.error('[kanban] Failed to migrate kanban.json:', err)
	}
}
