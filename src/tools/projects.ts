import { z } from 'zod'
import { join } from 'path'
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs'
import { getProject, getProjectByDiscordChannel, updateProject, addProject, getProjectAgents, addProjectAgent, getProjectCrons, addProjectCron, getProjects } from '../core/projects.ts'
import { listProjects, buildActiveProjectContext, logProjectActivity, getProjectDir } from '../utils/projects.ts'
import type { KanbanTask, KanbanComment, ProjectConfig } from '../core/projects.ts'

/** Session context injected by the tool factory. */
export interface ProjectSessionCtx {
	/** projectSlug bound to the session (e.g. from a Dashboard project chat or linked channel). */
	sessionProjectSlug?: string
	/** Actual channel identifier (Discord channel snowflake, Telegram chat ID, etc.).
	 *  Used to look up a project by discordChannelId config field. */
	channelUserId?: string
}

/**
 * Resolve a project from either an explicit slug or session context.
 * Priority: explicit slug → session-bound project → channel-linked project.
 *
 * `ctx` is a plain `ProjectSessionCtx` (not the Vercel AI tool context).
 */
function resolveProject(ctx: ProjectSessionCtx, projectSlug?: string): { project: ProjectConfig } | { error: string } {
	// 1. Explicit slug passed by the AI (preferred)
	if (projectSlug) {
		const p = getProject(projectSlug)
		if (!p) return { error: `Project "${projectSlug}" not found. Use project_list to see available projects.` }
		return { project: p }
	}
	// 2. Session bound to a project (e.g. dashboard project chat or linked channel session)
	if (ctx.sessionProjectSlug) {
		const p = getProject(ctx.sessionProjectSlug)
		if (p) return { project: p }
	}
	// 3. Channel linked to a project via discordChannelId config (matched on actual channel ID)
	if (ctx.channelUserId) {
		const p = getProjectByDiscordChannel(ctx.channelUserId)
		if (p) return { project: p }
	}
	return { error: 'No project identified. Provide a projectSlug, or use project_list to find the right project.' }
}

// ─── project_list ──────────────────────────────────────────────────────────────

export const project_list = {
	description: 'List all projects with their slugs, names, status and description. Use this to identify which project a user message refers to before calling other project tools.',
	parameters: z.object({}),
	execute: async (_args: Record<string, never>, _context: any) => {
		const projects = listProjects()
		if (projects.length === 0) return { projects: [], message: 'No projects found. Use project_create to create one.' }
		return {
			projects: projects.map(p => ({
				slug: p.slug,
				name: p.name,
				status: p.status,
				description: p.description,
				workspacePath: p.workspacePath,
			}))
		}
	}
}

// ─── project_get_context ───────────────────────────────────────────────────────

export const project_get_context = {
	description: 'Read the README, notes, and recent activity for a project to understand how it is organised and where to add things. Always call this before adding tasks or notes to an unfamiliar project.',
	parameters: z.object({
		projectSlug: z.string().describe('The project slug (from project_list).'),
	}),
	execute: async ({ projectSlug }: { projectSlug: string }, _context: any) => {
		const context = buildActiveProjectContext(projectSlug)
		if (!context) return { error: `Project "${projectSlug}" not found or has no context.` }
		return { context }
	}
}

// ─── project_add_note ─────────────────────────────────────────────────────────

export const project_add_note = {
	description: 'Append a freeform note or reminder to the project NOTES.md file. Use this when the user asks to remember something for a project that does not fit as a Kanban task.',
	parameters: z.object({
		projectSlug: z.string().describe('The project slug.'),
		note: z.string().describe('The note content to append (Markdown supported).'),
	}),
	execute: async ({ projectSlug, note }: { projectSlug: string; note: string }, _context: any) => {
		const projectDir = getProjectDir(projectSlug)
		if (!existsSync(projectDir)) return { error: `Project "${projectSlug}" not found.` }

		const notesPath = join(projectDir, 'NOTES.md')
		const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
		const entry = `\n## ${timestamp}\n\n${note}\n`

		if (existsSync(notesPath)) {
			appendFileSync(notesPath, entry, 'utf-8')
		} else {
			const p = listProjects().find(p => p.slug === projectSlug)
			const header = p ? `# ${p.name} — Notes\n` : `# Notes\n`
			writeFileSync(notesPath, header + entry, 'utf-8')
		}

		logProjectActivity(projectSlug, `Note added: ${note.slice(0, 80).replace(/\n/g, ' ')}${note.length > 80 ? '…' : ''}`)
		return { success: true, message: `Note added to ${projectSlug}/NOTES.md` }
	}
}

// ─── project_create ────────────────────────────────────────────────────────────

export const project_create = {
	description: 'Create a new project and initialize its workspace (README, kanban board, notes).',
	parameters: z.object({
		name: z.string().describe('The name of the project.'),
		description: z.string().optional().describe('A short description of the project.'),
		path: z.string().optional().describe('The local directory path for the project workspace. Optional.'),
		discordServerId: z.string().optional().describe('The Discord Server ID to link this project to. (Optional)'),
		discordChannelId: z.string().optional().describe('The Discord Channel ID to link this project to. (Optional)'),
		website: z.string().optional().describe('The project website URL. (Optional)'),
		techStack: z.string().optional().describe('The technology stack used. (Optional)'),
		objectives: z.array(z.string()).optional().describe('Project objectives. (Optional)')
	}),
	execute: async (args: { name: string; description?: string; path?: string; discordServerId?: string; discordChannelId?: string; website?: string; techStack?: string; objectives?: string[] }, _context: any) => {
		try {
			const newProject = addProject({
				...args,
				path: args.path ?? '',
			})
			return { success: true, project: newProject }
		} catch (error) {
			return { success: false, error: String(error) }
		}
	}
}

// ─── project_get_tasks ────────────────────────────────────────────────────────

export const project_get_tasks = {
	description: 'Get tasks from a project Kanban board.',
	parameters: z.object({
		projectSlug: z.string().optional().describe('The project slug. If omitted, inferred from Discord channel or session context.'),
		status: z.enum(['todo', 'in-progress', 'done', 'all']).optional().describe('Filter by task status. Default is all.')
	}),
	execute: async ({ projectSlug, status }: { projectSlug?: string; status?: string }, ctx: ProjectSessionCtx) => {
		const result = resolveProject(ctx, projectSlug)
		if ('error' in result) return { error: result.error }
		const project = result.project

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
				priority: t.priority,
				dueDate: t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : undefined,
				labels: t.labels,
				commentCount: t.comments?.length || 0,
				details: t.details || ''
			}))
		}
	}
}

// ─── project_add_task ─────────────────────────────────────────────────────────

export const project_add_task = {
	description: 'Add a new task to a project Kanban board.',
	parameters: z.object({
		projectSlug: z.string().optional().describe('The project slug. If omitted, inferred from Discord channel or session context.'),
		title: z.string(),
		details: z.string().optional().describe('Detailed description or acceptance criteria in Markdown.'),
		assignee: z.string().optional().describe('Who is assigned to this task (e.g. AI, User, specific name).'),
		status: z.enum(['todo', 'in-progress', 'done', 'queue', 'backlog', 'failed']).default('todo'),
		priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Task priority level.'),
		dueDate: z.string().optional().describe('Due date in ISO format (e.g. "2025-01-15").'),
		labels: z.array(z.string()).optional().describe('Labels/tags for the task (e.g. ["bug", "frontend"]).'),
		cli_provider: z.enum(['claude', 'gemini', 'codex', 'aider', 'copilot', 'custom']).optional().describe('CLI provider for this task'),
		plan_thinking: z.enum(['smart', 'basic', 'none']).optional().describe('Thinking level for plan phase'),
		execute_thinking: z.enum(['smart', 'basic']).optional().describe('Thinking level for execute phase'),
		auto_commit: z.boolean().optional().describe('Auto-commit changes on success'),
		blocking: z.boolean().optional().describe('Stop queue on failure'),
	}),
	execute: async (args: { projectSlug?: string; title: string; details?: string; assignee?: string; status?: string; priority?: string; dueDate?: string; labels?: string[]; cli_provider?: KanbanTask['cli_provider']; plan_thinking?: KanbanTask['plan_thinking']; execute_thinking?: KanbanTask['execute_thinking']; auto_commit?: boolean; blocking?: boolean }, ctx: ProjectSessionCtx) => {
		const result = resolveProject(ctx, args.projectSlug)
		if ('error' in result) return { error: result.error }
		const project = result.project

		const newTask: KanbanTask = {
			id: Math.random().toString(36).substring(2, 9),
			title: args.title,
			details: args.details,
			assignee: args.assignee,
			status: args.status || 'todo',
			createdAt: Date.now(),
			priority: args.priority as KanbanTask['priority'],
			dueDate: args.dueDate ? new Date(args.dueDate).getTime() : undefined,
			labels: args.labels,
			cli_provider: args.cli_provider,
			plan_thinking: args.plan_thinking ?? null,
			execute_thinking: args.execute_thinking ?? null,
			auto_commit: args.auto_commit ?? null,
			blocking: args.blocking,
		}

		const updatedKanban = [...(project.kanban || []), newTask]
		updateProject(project.id, { kanban: updatedKanban }, { source: 'ai' })
		logProjectActivity(project.id, `Task added: "${args.title}"`)

		if (args.assignee === 'ai' && args.status === 'queue' && project.directory) {
			const { notifyProjectNewTask } = await import('../core/kanban/queue-manager.ts')
			try {
				notifyProjectNewTask(project.id)
			} catch { /* non-fatal */ }
		}

		return { success: true, task: newTask }
	}
}

// ─── project_update_task ──────────────────────────────────────────────────────

export const project_update_task = {
	description: 'Update the properties of an existing task on the Kanban board (e.g. status, assignee, details, priority, due date, labels, or reaction).',
	parameters: z.object({
		projectSlug: z.string().optional().describe('The project slug. If omitted, inferred from Discord channel or session context.'),
		taskId: z.string().describe('The ID of the task to update.'),
		status: z.enum(['todo', 'in-progress', 'awaiting-review', 'done', 'queue', 'backlog', 'failed']).optional(),
		assignee: z.string().optional(),
		details: z.string().optional(),
		reaction: z.string().optional().describe('An emoji reaction to set for the task.'),
		priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Task priority level.'),
		dueDate: z.string().optional().describe('Due date in ISO format (e.g. "2025-01-15").'),
		labels: z.array(z.string()).optional().describe('Labels/tags for the task.'),
		cli_provider: z.enum(['claude', 'gemini', 'codex', 'aider', 'copilot', 'custom']).optional().describe('CLI provider for this task'),
		plan_thinking: z.enum(['smart', 'basic', 'none']).optional().describe('Thinking level for plan phase'),
		execute_thinking: z.enum(['smart', 'basic']).optional().describe('Thinking level for execute phase'),
		auto_commit: z.boolean().optional().describe('Auto-commit changes on success'),
		blocking: z.boolean().optional().describe('Stop queue on failure'),
	}),
	execute: async (args: { projectSlug?: string; taskId: string; status?: string; assignee?: string; details?: string; reaction?: string; priority?: string; dueDate?: string; labels?: string[]; cli_provider?: KanbanTask['cli_provider']; plan_thinking?: KanbanTask['plan_thinking']; execute_thinking?: KanbanTask['execute_thinking']; auto_commit?: boolean; blocking?: boolean }, ctx: ProjectSessionCtx) => {
		const result = resolveProject(ctx, args.projectSlug)
		if ('error' in result) return { error: result.error }
		const project = result.project

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
					...(args.priority !== undefined && { priority: args.priority as KanbanTask['priority'] }),
					...(args.dueDate !== undefined && { dueDate: new Date(args.dueDate).getTime() }),
					...(args.labels !== undefined && { labels: args.labels }),
					...(args.cli_provider !== undefined && { cli_provider: args.cli_provider }),
					...(args.plan_thinking !== undefined && { plan_thinking: args.plan_thinking }),
					...(args.execute_thinking !== undefined && { execute_thinking: args.execute_thinking }),
					...(args.auto_commit !== undefined && { auto_commit: args.auto_commit }),
					...(args.blocking !== undefined && { blocking: args.blocking }),
				}
			}
			return t
		})

		if (!found) return { error: `Task ID ${args.taskId} not found.` }

		updateProject(project.id, { kanban: updatedKanban }, { source: 'ai' })
		return { success: true, message: `Task ${args.taskId} updated.` }
	}
}

// ─── project_add_comment ──────────────────────────────────────────────────────

export const project_add_comment = {
	description: 'Add a new comment or update message to a specific task on the Kanban board.',
	parameters: z.object({
		projectSlug: z.string().optional().describe('The project slug. If omitted, inferred from Discord channel or session context.'),
		taskId: z.string(),
		text: z.string().describe('The content of the comment in Markdown.')
	}),
	execute: async (args: { projectSlug?: string; taskId: string; text: string }, ctx: ProjectSessionCtx) => {
		const result = resolveProject(ctx, args.projectSlug)
		if ('error' in result) return { error: result.error }
		const project = result.project

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

		updateProject(project.id, { kanban: updatedKanban }, { source: 'ai' })
		return { success: true, message: `Comment added to task ${args.taskId}.` }
	}
}

// ─── project_update_comment ───────────────────────────────────────────────────

export const project_update_comment = {
	description: 'Update the text or reaction of an existing comment on the Kanban board.',
	parameters: z.object({
		projectSlug: z.string().optional().describe('The project slug. If omitted, inferred from Discord channel or session context.'),
		taskId: z.string(),
		commentId: z.string(),
		text: z.string().optional().describe('The new content of the comment in Markdown.'),
		reaction: z.string().optional().describe('An emoji reaction to set for the comment.')
	}),
	execute: async (args: { projectSlug?: string; taskId: string; commentId: string; text?: string; reaction?: string }, ctx: ProjectSessionCtx) => {
		const result = resolveProject(ctx, args.projectSlug)
		if ('error' in result) return { error: result.error }
		const project = result.project

		let taskFound = false
		let commentFound = false
		const updatedKanban = (project.kanban || []).map(t => {
			if (t.id === args.taskId) {
				taskFound = true
				const updatedComments = (t.comments || []).map(c => {
					if (c.id === args.commentId) {
						commentFound = true
						return {
							...c,
							...(args.text !== undefined && { text: args.text }),
							...(args.reaction !== undefined && { reaction: args.reaction })
						}
					}
					return c
				})
				return { ...t, comments: updatedComments }
			}
			return t
		})

		if (!taskFound) return { error: `Task ID ${args.taskId} not found.` }
		if (!commentFound) return { error: `Comment ID ${args.commentId} not found in task ${args.taskId}.` }

		updateProject(project.id, { kanban: updatedKanban }, { source: 'ai' })
		return { success: true, message: `Comment ${args.commentId} updated in task ${args.taskId}.` }
	}
}

// ─── project_list_agents ──────────────────────────────────────────────────────

export const project_list_agents = {
	description: 'List all agents scoped to a specific project.',
	parameters: z.object({
		projectId: z.string().describe('The project ID to list agents for.'),
	}),
	execute: async (args: { projectId: string }) => {
		try {
			const agents = getProjectAgents(args.projectId)
			return {
				agents: agents.map(a => ({
					slug: a.slug,
					name: a.name,
					model: a.model,
					enabled: a.enabled,
				}))
			}
		} catch (error) {
			return { error: String(error) }
		}
	}
}

// ─── project_add_agent ────────────────────────────────────────────────────────

export const project_add_agent = {
	description: 'Add a new agent scoped to a specific project.',
	parameters: z.object({
		projectId: z.string().describe('The project ID to add the agent to.'),
		name: z.string().describe('The name of the agent.'),
		instructions: z.string().describe('The agent instructions/persona.'),
		model: z.string().optional().describe('The model to use (e.g. "openai/gpt-4o").'),
	}),
	execute: async (args: { projectId: string; name: string; instructions: string; model?: string }) => {
		try {
			const agent = addProjectAgent(args.projectId, {
				slug: '',
				name: args.name,
				instructions: args.instructions,
				model: args.model,
			})
			return { success: true, agent: { slug: agent.slug, name: agent.name, id: agent.id } }
		} catch (error) {
			return { error: String(error) }
		}
	}
}

// ─── project_list_crons ───────────────────────────────────────────────────────

export const project_list_crons = {
	description: 'List all cron jobs scoped to a specific project.',
	parameters: z.object({
		projectId: z.string().describe('The project ID to list crons for.'),
	}),
	execute: async (args: { projectId: string }) => {
		try {
			const crons = getProjectCrons(args.projectId)
			return {
				crons: crons.map(c => ({
					id: c.id,
					name: c.name,
					schedule: c.schedule,
					type: c.type,
					enabled: c.enabled,
					lastRun: c.lastRun,
					lastStatus: c.lastStatus,
				}))
			}
		} catch (error) {
			return { error: String(error) }
		}
	}
}

export const PROJECTS_TOOL_NAME = 'projects'

// ─── project_add_cron ─────────────────────────────────────────────────────────

export const project_add_cron = {
	description: 'Add a new scheduled cron job scoped to a specific project.',
	parameters: z.object({
		projectId: z.string().describe('The project ID to add the cron to.'),
		name: z.string().describe('The name of the cron job.'),
		schedule: z.string().describe('The schedule (e.g. "30m", "1h", or a cron expression).'),
		type: z.enum(['ai', 'message']).default('ai').describe('Type: "ai" sends to AI, "message" sends directly.'),
		prompt: z.string().describe('The prompt or message text.'),
	}),
	execute: async (args: { projectId: string; name: string; schedule: string; type: 'ai' | 'message'; prompt: string }) => {
		try {
			const cron = addProjectCron(args.projectId, {
				name: args.name,
				schedule: args.schedule,
				type: args.type,
				prompt: args.prompt,
				target: 'last',
			})
			return { success: true, cron: { id: cron.id, name: cron.name, schedule: cron.schedule } }
		} catch (error) {
			return { error: String(error) }
		}
	}
}

// ─── Factory ──────────────────────────────────────────────────────────────────
// Returns all project tools with session context baked into the 5 tools that
// use resolveProject.  Call this from toolRegistry instead of importing the
// bare tool objects so that the AI can auto-infer the active project.

/** All project tools with session context wired in. */
export function createProjectTools(sessionCtx: ProjectSessionCtx) {
	/** Wrap a tool so its execute receives sessionCtx as the options argument. */
	function withCtx<T extends { description: string; parameters: unknown; execute: (...args: any[]) => any }>(tool: T): T {
		return {
			...tool,
			execute: (args: any) => tool.execute(args, sessionCtx),
		} as T
	}

	return {
		project_list,
		project_get_context,
		project_add_note,
		project_create,
		project_get_tasks: withCtx(project_get_tasks),
		project_add_task: withCtx(project_add_task),
		project_update_task: withCtx(project_update_task),
		project_add_comment: withCtx(project_add_comment),
		project_update_comment: withCtx(project_update_comment),
		project_list_agents,
		project_add_agent,
		project_list_crons,
		project_add_cron,
	}
}
