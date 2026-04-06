export interface KanbanComment {
	id: string
	author: string
	text: string
	createdAt: number
	reaction?: string
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
}

export const KANBAN_COLUMNS = ['backlog', 'queue', 'in-progress', 'done', 'failed'] as const
