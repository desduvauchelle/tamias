import type { Database } from 'bun:sqlite'

export interface TaskRow {
	id: string
	title: string
	description: string
	details: string
	status: string
	position: number
	blocking: number
	plan_thinking: string | null
	execute_thinking: string | null
	auto_commit: number | null
	auto_push: number | null
	cli_provider: string | null
	cli_custom_command: string | null
	branch_mode: string
	branch_name: string | null
	assignee: string
	priority: string | null
	due_date: string | null
	labels: string
	reaction: string | null
	created_at: string
	updated_at: string
}

export interface Task {
	id: string
	title: string
	description: string
	details: string
	status: 'backlog' | 'queue' | 'in-progress' | 'done' | 'failed' | string
	position: number
	blocking: boolean
	plan_thinking: 'smart' | 'basic' | null
	execute_thinking: 'smart' | 'basic' | null
	auto_commit: boolean | null
	auto_push: boolean | null
	cli_provider: 'claude' | 'gemini' | 'codex' | 'aider' | 'copilot' | 'custom' | null
	cli_custom_command: string | null
	branch_mode: 'current' | 'new' | 'specific'
	branch_name: string | null
	assignee: 'ai' | 'human'
	priority: 'low' | 'medium' | 'high' | 'urgent' | null
	due_date: string | null
	labels: string[]
	reaction: string | null
	created_at: string
	updated_at: string
}

function toTask(row: TaskRow): Task {
	return {
		...row,
		blocking: Boolean(row.blocking),
		plan_thinking: (row.plan_thinking ?? null) as Task['plan_thinking'],
		execute_thinking: (row.execute_thinking ?? null) as Task['execute_thinking'],
		auto_commit: row.auto_commit === null ? null : row.auto_commit !== 0,
		auto_push: row.auto_push === null ? null : row.auto_push !== 0,
		cli_provider: (row.cli_provider ?? null) as Task['cli_provider'],
		cli_custom_command: row.cli_custom_command ?? null,
		branch_mode: (row.branch_mode ?? 'current') as Task['branch_mode'],
		branch_name: row.branch_name ?? null,
		assignee: (row.assignee ?? 'ai') as Task['assignee'],
		priority: (row.priority ?? null) as Task['priority'],
		labels: (() => { try { return JSON.parse(row.labels) } catch { return [] } })(),
	}
}

export function listTasks(db: Database, status?: string): Task[] {
	const rows = status
		? db.query('SELECT * FROM tasks WHERE status = ? ORDER BY position ASC, created_at ASC').all(status) as TaskRow[]
		: db.query('SELECT * FROM tasks ORDER BY position ASC, created_at ASC').all() as TaskRow[]
	return rows.map(toTask)
}

export function getTask(db: Database, id: string): Task | null {
	const row = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | null
	return row ? toTask(row) : null
}

export function insertTask(db: Database, t: {
	id: string
	title: string
	description?: string
	details?: string
	status?: string
	position?: number
	blocking?: boolean
	assignee?: string
	priority?: string | null
	due_date?: string | null
	labels?: string[]
	reaction?: string | null
	plan_thinking?: string | null
	execute_thinking?: string | null
	auto_commit?: boolean | null
	auto_push?: boolean | null
	cli_provider?: string | null
	cli_custom_command?: string | null
	branch_mode?: string
	branch_name?: string | null
}): Task {
	const status = t.status ?? 'backlog'
	const position = t.position ?? (
		(db.query('SELECT COALESCE(MAX(position), -1) + 1 as p FROM tasks WHERE status = ?').get(status) as { p: number }).p
	)
	const row = db.query(`
    INSERT INTO tasks (id, title, description, details, status, position, blocking, assignee, priority, due_date, labels, reaction, plan_thinking, execute_thinking, auto_commit, auto_push, cli_provider, cli_custom_command, branch_mode, branch_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
		t.id, t.title, t.description ?? '', t.details ?? '', status, position,
		t.blocking ? 1 : 0, t.assignee ?? 'ai', t.priority ?? null, t.due_date ?? null,
		JSON.stringify(t.labels ?? []), t.reaction ?? null,
		t.plan_thinking ?? null, t.execute_thinking ?? null,
		t.auto_commit === undefined ? null : (t.auto_commit === null ? null : (t.auto_commit ? 1 : 0)),
		t.auto_push === undefined ? null : (t.auto_push === null ? null : (t.auto_push ? 1 : 0)),
		t.cli_provider ?? null, t.cli_custom_command ?? null,
		t.branch_mode ?? 'current', t.branch_name ?? null,
	) as TaskRow
	return toTask(row)
}

export function updateTask(db: Database, id: string, updates: Partial<{
	title: string
	description: string
	details: string
	status: string
	position: number
	blocking: boolean
	assignee: string
	priority: string | null
	due_date: string | null
	labels: string[]
	reaction: string | null
	plan_thinking: string | null
	execute_thinking: string | null
	auto_commit: boolean | null
	auto_push: boolean | null
	cli_provider: string | null
	cli_custom_command: string | null
	branch_mode: string
	branch_name: string | null
}>): Task | null {
	const current = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | null
	if (!current) return null

	const row = db.query(`
    UPDATE tasks SET
      title = ?, description = ?, details = ?, status = ?, position = ?,
      blocking = ?, assignee = ?, priority = ?, due_date = ?, labels = ?,
      reaction = ?, plan_thinking = ?, execute_thinking = ?,
      auto_commit = ?, auto_push = ?, cli_provider = ?, cli_custom_command = ?,
      branch_mode = ?, branch_name = ?, updated_at = datetime('now')
    WHERE id = ?
    RETURNING *
  `).get(
		updates.title ?? current.title,
		updates.description ?? current.description,
		updates.details ?? current.details,
		updates.status ?? current.status,
		updates.position ?? current.position,
		updates.blocking !== undefined ? (updates.blocking ? 1 : 0) : current.blocking,
		updates.assignee ?? current.assignee,
		updates.priority !== undefined ? updates.priority : current.priority,
		updates.due_date !== undefined ? updates.due_date : current.due_date,
		updates.labels !== undefined ? JSON.stringify(updates.labels) : current.labels,
		updates.reaction !== undefined ? updates.reaction : current.reaction,
		updates.plan_thinking !== undefined ? updates.plan_thinking : current.plan_thinking,
		updates.execute_thinking !== undefined ? updates.execute_thinking : current.execute_thinking,
		updates.auto_commit !== undefined ? (updates.auto_commit === null ? null : (updates.auto_commit ? 1 : 0)) : current.auto_commit,
		updates.auto_push !== undefined ? (updates.auto_push === null ? null : (updates.auto_push ? 1 : 0)) : current.auto_push,
		updates.cli_provider !== undefined ? updates.cli_provider : current.cli_provider,
		updates.cli_custom_command !== undefined ? updates.cli_custom_command : current.cli_custom_command,
		updates.branch_mode ?? current.branch_mode,
		updates.branch_name !== undefined ? updates.branch_name : current.branch_name,
		id,
	) as TaskRow
	return toTask(row)
}

export function updateTaskStatus(db: Database, id: string, status: string): void {
	db.query("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
}

export function deleteTask(db: Database, id: string): boolean {
	const result = db.query('DELETE FROM tasks WHERE id = ?').run(id)
	return result.changes > 0
}

export function listQueuedTasks(db: Database): Task[] {
	return (db.query("SELECT * FROM tasks WHERE status = 'queue' AND assignee = 'ai' ORDER BY position ASC, created_at ASC").all() as TaskRow[]).map(toTask)
}

export function recoverInterruptedTasks(db: Database): { requeued: number; reset: number } {
	const inProgressIds = db.query("SELECT id FROM tasks WHERE status = 'in-progress'").all() as Array<{ id: string }>
	let requeued = 0
	let reset = 0
	for (const { id } of inProgressIds) {
		db.query("UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE task_id = ? AND status = 'running'").run(id)
		const planDone = db.query("SELECT id FROM executions WHERE task_id = ? AND phase = 'plan' AND status = 'success' ORDER BY started_at DESC LIMIT 1").get(id)
		if (planDone) {
			db.query("UPDATE tasks SET status = 'queue', updated_at = datetime('now') WHERE id = ?").run(id)
			requeued++
		} else {
			db.query("UPDATE tasks SET status = 'backlog', updated_at = datetime('now') WHERE id = ?").run(id)
			reset++
		}
	}
	return { requeued, reset }
}
