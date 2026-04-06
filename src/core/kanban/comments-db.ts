import type { Database } from 'bun:sqlite'

export interface Comment {
	id: string
	task_id: string
	author: 'user' | 'system' | 'ai'
	content: string
	execution_id: string | null
	created_at: string
}

export function listComments(db: Database, taskId: string): Comment[] {
	return db.query('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as Comment[]
}

export function createComment(db: Database, taskId: string, input: { author: 'user' | 'system' | 'ai'; content: string; execution_id?: string | null }): Comment {
	return db.query(`INSERT INTO comments (task_id, author, content, execution_id) VALUES (?, ?, ?, ?) RETURNING *`).get(taskId, input.author, input.content, input.execution_id ?? null) as Comment
}

export function addSystemComment(db: Database, taskId: string, executionId: string, content: string): Comment {
	return createComment(db, taskId, { author: 'system', content, execution_id: executionId || null })
}

export function deleteComment(db: Database, id: string): boolean {
	const result = db.query('DELETE FROM comments WHERE id = ?').run(id)
	return result.changes > 0
}
