import type { Database } from 'bun:sqlite'

export interface Execution {
	id: string
	task_id: string
	session_id: string | null
	phase: 'plan' | 'execute'
	started_at: string
	finished_at: string | null
	status: 'running' | 'success' | 'failed' | 'cancelled'
	output: string
	cost_usd: number
	exit_code: number | null
	retry_count: number
	pid: number | null
	files_changed: string | null
}

export function listExecutions(db: Database, taskId: string): Execution[] {
	return db.query('SELECT * FROM executions WHERE task_id = ? ORDER BY started_at DESC').all(taskId) as Execution[]
}

export function getExecution(db: Database, id: string): Execution | null {
	return (db.query('SELECT * FROM executions WHERE id = ?').get(id) as Execution | null) ?? null
}

export function createExecution(db: Database, taskId: string, sessionId: string | null, phase: 'plan' | 'execute'): Execution {
	return db.query(`INSERT INTO executions (task_id, session_id, phase) VALUES (?, ?, ?) RETURNING *`).get(taskId, sessionId, phase) as Execution
}

export function updateExecutionStatus(db: Database, id: string, status: 'running' | 'success' | 'failed' | 'cancelled', exitCode: number | null): void {
	db.query("UPDATE executions SET status = ?, exit_code = ?, finished_at = datetime('now') WHERE id = ?").run(status, exitCode, id)
}

export function updateExecutionPid(db: Database, id: string, pid: number): void {
	db.query('UPDATE executions SET pid = ? WHERE id = ?').run(pid, id)
}

const MAX_DB_OUTPUT = 512 * 1024

export function appendExecutionOutput(db: Database, id: string, chunk: string): void {
	const row = db.query('SELECT length(output) as len FROM executions WHERE id = ?').get(id) as { len: number } | null
	const currentLen = row?.len ?? 0
	if (currentLen >= MAX_DB_OUTPUT) {
		const keepSize = MAX_DB_OUTPUT - chunk.length
		if (keepSize > 0) {
			db.query('UPDATE executions SET output = substr(output, -?) || ? WHERE id = ?').run(keepSize, chunk, id)
		}
		return
	}
	db.query('UPDATE executions SET output = output || ? WHERE id = ?').run(chunk, id)
}

export function updateExecutionCost(db: Database, id: string, costUsd: number): void {
	db.query('UPDATE executions SET cost_usd = ? WHERE id = ?').run(costUsd, id)
}

export function getCompletedPlanOutput(db: Database, taskId: string): string | null {
	const row = db.query("SELECT output FROM executions WHERE task_id = ? AND phase = 'plan' AND status = 'success' ORDER BY started_at DESC LIMIT 1").get(taskId) as { output: string } | null
	return row?.output ?? null
}

export function updateExecutionFilesChanged(db: Database, id: string, filesChanged: Array<{ path: string; additions: number; deletions: number }>): void {
	db.query('UPDATE executions SET files_changed = ? WHERE id = ?').run(JSON.stringify(filesChanged), id)
}

export function cancelRunningExecutions(db: Database): number {
	const result = db.query("UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE status = 'running'").run()
	return result.changes
}

export function getLastSessionId(db: Database, taskId: string): string | null {
	const row = db.query('SELECT session_id FROM executions WHERE task_id = ? AND session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1').get(taskId) as { session_id: string } | null
	return row?.session_id ?? null
}
