import { z } from 'zod'
import { getProject, getProjectByDiscordChannel, updateProject, addProject } from '../core/projects'
import type { KanbanTask, KanbanComment, ProjectConfig } from '../core/projects'

export const project_create = {
	description: 'Create a new project and initialize its Kanban board.',
	parameters: z.object({
		name: z.string().describe('The name of the project.'),
		description: z.string().optional().describe('A short description of the project.'),
		path: z.string().describe('The local directory path for the project workspace.'),
		discordServerId: z.string().optional().describe('The Discord Server ID to link this project to. (Optional)'),
		discordChannelId: z.string().optional().describe('The Discord Channel ID to link this project to. (Optional)'),
		contextFile: z.string().optional().describe('The filename of the context file (e.g. "readme.md"). (Optional)')
	}),
	execute: async (args: Omit<ProjectConfig, 'id' | 'kanban'>, context: any) => {
		try {
			const newProject = addProject(args)
			return { success: true, project: newProject }
		} catch (error) {
			return { success: false, error: String(error) }
		}
	}
}

export const project_get_tasks = {
	description: 'Get all active or completed tasks for the current context project Kanban board.',
	parameters: z.object({
		status: z.enum(['todo', 'in-progress', 'done', 'all']).optional().describe('Filter by task status. Default is all.')
	}),
	execute: async ({ status }: { status?: string }, context: any) => {
		// determine project from context:
		const channelId = context.sessionId // fallback or actual channel
		// Actually, in tools context, `id` might be the channel Id if from discord bridge, let's try to find it
		const bridgeId = context.id

		let project = null
		if (bridgeId) {
			project = getProjectByDiscordChannel(bridgeId)
		}
		// Also support looking up by explicit session memory if we bind it later
		if (!project && context.sessionProjectSlug) {
			// This relies on binding sessionProjectSlug later, if implemented.
		}

		if (!project) {
			return { error: 'No active project linked to this conversation context.' }
		}

		let tasks = project.kanban || []
		if (status && status !== 'all') {
			tasks = tasks.filter(t => t.status === status)
		}

		return {
			project: project.name,
			tasks: tasks.map(t => ({
				id: t.id,
				title: t.title,
				status: t.status,
				assignee: t.assignee,
				commentCount: t.comments?.length || 0,
				details: t.details || ''
			}))
		}
	}
}

export const project_add_task = {
	description: 'Add a new task to the project Kanban board.',
	parameters: z.object({
		title: z.string(),
		details: z.string().optional().describe('Detailed description or acceptance criteria in Markdown.'),
		assignee: z.string().optional().describe('Who is assigned to this task (e.g. AI, User, specific name).'),
		status: z.enum(['todo', 'in-progress', 'done']).default('todo')
	}),
	execute: async (args: { title: string, details?: string, assignee?: string, status?: string }, context: any) => {
		const bridgeId = context.id
		const project = bridgeId ? getProjectByDiscordChannel(bridgeId) : null
		if (!project) return { error: 'No active project linked to this conversation context.' }

		const newTask: KanbanTask = {
			id: Math.random().toString(36).substring(2, 9),
			title: args.title,
			details: args.details,
			assignee: args.assignee,
			status: args.status || 'todo',
			createdAt: Date.now()
		}

		const updatedKanban = [...(project.kanban || []), newTask]
		updateProject(project.id, { kanban: updatedKanban })

		return { success: true, task: newTask }
	}
}

export const project_update_task = {
	description: 'Update the properties of an existing task on the Kanban board (e.g. status, assignee, details, or reaction).',
	parameters: z.object({
		taskId: z.string().describe('The ID of the task to update.'),
		status: z.enum(['todo', 'in-progress', 'awaiting-review', 'done']).optional(),
		assignee: z.string().optional(),
		details: z.string().optional(),
		reaction: z.string().optional().describe('An emoji reaction to set for the task.')
	}),
	execute: async (args: { taskId: string, status?: string, assignee?: string, details?: string, reaction?: string }, context: any) => {
		const bridgeId = context.id
		const project = bridgeId ? getProjectByDiscordChannel(bridgeId) : null
		if (!project) return { error: 'No active project linked to this conversation context.' }

		let found = false
		const updatedKanban = (project.kanban || []).map(t => {
			if (t.id === args.taskId) {
				found = true
				return {
					...t,
					...(args.status !== undefined && { status: args.status }),
					...(args.assignee !== undefined && { assignee: args.assignee }),
					...(args.details !== undefined && { details: args.details }),
					...(args.reaction !== undefined && { reaction: args.reaction }),
				}
			}
			return t
		})

		if (!found) return { error: `Task ID ${args.taskId} not found.` }

		updateProject(project.id, { kanban: updatedKanban })
		return { success: true, message: `Task ${args.taskId} updated.` }
	}
}

export const project_add_comment = {
	description: 'Add a new comment or update message to a specific task on the Kanban board.',
	parameters: z.object({
		taskId: z.string(),
		text: z.string().describe('The content of the comment in Markdown.')
	}),
	execute: async (args: { taskId: string, text: string }, context: any) => {
		const bridgeId = context.id
		const project = bridgeId ? getProjectByDiscordChannel(bridgeId) : null
		if (!project) return { error: 'No active project linked to this conversation context.' }

		const newComment: KanbanComment = {
			id: Math.random().toString(36).substring(2, 9),
			author: 'AI Assistant',
			text: args.text,
			createdAt: Date.now()
		}

		let found = false
		const updatedKanban = (project.kanban || []).map(t => {
			if (t.id === args.taskId) {
				found = true
				return { ...t, comments: [...(t.comments || []), newComment] }
			}
			return t
		})

		if (!found) return { error: `Task ID ${args.taskId} not found.` }

		updateProject(project.id, { kanban: updatedKanban })
		return { success: true, message: `Comment added to task ${args.taskId}.` }
	}
}
