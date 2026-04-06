export interface KanbanComment {
	id: string
	task_id: string
	author: 'user' | 'system' | 'ai'
	content: string
	execution_id: string | null
	created_at: string
}

export interface KanbanActivity {
	id: string
	type: 'tool' | 'text' | 'status'
	text: string
	createdAt: number
}

export interface KanbanTask {
	id: string
	title: string
	description?: string
	details?: string
	assignee?: string
	reaction?: string
	status: string
	createdAt: number
	priority?: 'low' | 'medium' | 'high' | 'urgent'
	dueDate?: number
	labels?: string[]
	order?: number
	comments?: KanbanComment[]
	activity?: KanbanActivity[]
	// Execution engine fields
	cli_provider?: 'claude' | 'gemini' | 'codex' | 'aider' | 'copilot' | 'custom'
	cli_custom_command?: string
	plan_thinking?: 'smart' | 'basic' | 'none' | null
	execute_thinking?: 'smart' | 'basic' | null
	auto_commit?: boolean | null
	auto_push?: boolean | null
	branch_mode?: 'current' | 'new' | 'specific'
	branch_name?: string
	blocking?: boolean
}

export interface Project {
	id: string
	name: string
	description?: string
	path: string
	discordServerId?: string
	discordChannelId?: string
	website?: string
	objectives?: string[]
	kanban: KanbanTask[]
	preferredConnections?: string[]
	preferredModel?: string
	preferredModelFallbacks?: string[]
	directory?: string
	kanbanCliProvider?: string
	kanbanPlanThinking?: string
	kanbanExecuteThinking?: string
	kanbanAutoCommit?: boolean
	kanbanAutoPush?: boolean
	kanbanCustomInstructions?: string
}

export const KANBAN_COLUMNS = ['backlog', 'queue', 'in-progress', 'done', 'failed'] as const

export interface Execution {
	id: string
	task_id: string
	session_id: string | null
	phase: 'plan' | 'execute'
	status: 'running' | 'success' | 'failed' | 'cancelled'
	output: string
	cost_usd: number
	exit_code: number | null
	retry_count: number
	pid: number | null
	started_at: string
	finished_at: string | null
	files_changed: string | null
}

export interface QueueStatus {
	isRunning: boolean
	isPaused: boolean
	active: string[]
	queue: string[]
}
