export interface KanbanComment {
	id: string
	author: string
	text: string
	createdAt: number
	reaction?: string
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
}

export interface Project {
	id: string
	name: string
	description?: string
	path: string
	discordServerId?: string
	discordChannelId?: string
	contextFile?: string
	kanban: KanbanTask[]
}

export const KANBAN_COLUMNS = ['todo', 'in-progress', 'awaiting-review', 'done'] as const
