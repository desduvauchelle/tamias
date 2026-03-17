import { EventEmitter } from 'events'
import { join } from 'path'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { streamText, generateText, generateObject, stepCountIs } from 'ai'

// Verbose debug logger — enabled by setting TAMIAS_DEBUG=1 or launching with `tamias start --verbose`
const DEBUG = process.env.TAMIAS_DEBUG === '1'
function debug(...args: unknown[]) {
	if (DEBUG) console.log('[DEBUG]', ...args)
}
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { loadConfig, getApiKeyForConnection, type ConnectionConfig, getDefaultModel, getDefaultModels, getSmartModels, getAllModelOptions, getCompactionModel, getAllConnections, getWorkspacePath as getWorkspacePathSync } from '../utils/config'
import { buildActiveTools } from '../utils/toolRegistry'
import { estimateTokens, estimateMessageTokens, getMessageTokenBudget, trimMessagesToTokenBudget } from '../utils/tokenBudget'
import { buildProviderOptions } from '../utils/promptCaching'
import { buildSystemPrompt, updatePersonaFiles, writePersonaFile, appendDailyLog, scaffoldFromTemplates, readAllPersonaFiles } from '../utils/memory'
import { saveSessionToDisk, type SessionPersist, listAllStoredSessions, loadSessionFromDisk } from '../utils/sessions'
import { db } from '../utils/db'
import { logAiRequest } from '../utils/logger'
import type { DaemonEvent, BridgeMessage } from '../bridge/types'
import { BridgeManager } from '../bridge'
import { findAgent, getAgentDir, resolveAgentModelChain } from '../utils/agentsStore'

export interface MessageJob {
	sessionId: string
	content: string
	authorName?: string
	attachments?: BridgeMessage['attachments']
	metadata?: {
		source: string
	}
}

export interface Session {
	id: string
	name?: string
	model: string
	connectionNickname: string
	modelId: string
	createdAt: Date
	updatedAt: Date
	queue: MessageJob[]
	processing: boolean
	messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | any[] }>
	summary?: string
	emitter: EventEmitter
	heartbeatTimer: ReturnType<typeof setInterval> | null
	channelId: string
	channelUserId?: string
	channelName?: string
	parentSessionId?: string
	isSubagent?: boolean
	// Sub-agent lifecycle tracking
	task?: string
	taskSlug?: string
	subagentStatus?: 'pending' | 'running' | 'completed' | 'failed'
	spawnedAt?: Date
	completedAt?: Date
	progress?: string
	subagentCallbackCalled?: boolean
	// Named agent fields
	agentId?: string
	agentSlug?: string
	agentDir?: string
	// Active project for this session
	projectSlug?: string
	/** Per-session workspace directory (e.g. ~/.tamias/workspace/time-tracker). Overrides global workspacePath. */
	workspacePath: string
	/** Model tier: 'normal' for everyday tasks, 'smart' for complex/coding tasks */
	modelTier?: 'normal' | 'smart'
}

export interface CreateSessionOptions {
	model?: string
	channelId?: string
	channelUserId?: string
	channelName?: string
	parentSessionId?: string
	isSubagent?: boolean
	id?: string
	task?: string
	agentId?: string
	projectSlug?: string
	/** Model tier: 'normal' for everyday tasks, 'smart' for complex/coding tasks */
	modelTier?: 'normal' | 'smart'
}

/**
 * Resolve the workspace path for a session.
 * - Sub-agents inherit their parent's workspace.
 * - Sessions linked to a project use ~/.tamias/workspace/<projectSlug> directly.
 * - All other sessions (bridge or terminal) use the global configured workspace.
 */
function resolveSessionWorkspacePath(options: {
	isSubagent?: boolean
	parentWorkspacePath?: string
	projectSlug?: string
}): string {
	if (options.isSubagent && options.parentWorkspacePath) {
		return options.parentWorkspacePath
	}
	if (options.projectSlug) {
		return join(getWorkspacePathSync(), options.projectSlug)
	}
	return getWorkspacePathSync()
}

/** Truncate a task description to a readable one-liner for status messages. */
function truncateTask(task: string | undefined, max = 80): string {
	if (!task) return 'sub-task'
	const first = task.split('\n')[0].trim()
	return first.length > max ? first.slice(0, max - 1) + '…' : first
}

export class AIService {
	private sessions = new Map<string, Session>()
	private bridgeSessionMap = new Map<string, string>()
	private activeTools: Record<string, unknown> = {}
	private toolNames: string[] = []
	private mcpClients: Array<{ close: () => Promise<void> }> = []
	private bridgeManager: BridgeManager
	private dashboardPort?: number

	constructor(bridgeManager: BridgeManager) {
		this.bridgeManager = bridgeManager
	}

	public getBridgeManager(): BridgeManager {
		return this.bridgeManager
	}

	public async initialize() {
		scaffoldFromTemplates()
		const config = loadConfig()
		debug(`initialize(): connections in config: [${Object.keys(config.connections).join(', ') || 'NONE'}]`)
		const allOpts = getAllModelOptions()
		debug(`initialize(): all model options: [${allOpts.join(', ') || 'NONE'}]`)
		debug(`initialize(): default models: [${getDefaultModels().join(', ') || 'NONE'}]`)
		this.healStaleSessionModels()
		this.loadAllSessions()

		try {
			const { projectEvents } = await import('../core/projects.ts')
			projectEvents.on('kanban_changed', (payload) => this.handleKanbanChanged(payload))
		} catch (e) {
			console.error('[AIService] Failed to bind kanban events', e)
		}
	}

	private async handleKanbanChanged({ project, oldKanban, newKanban, source }: any) {
		const session = [...this.sessions.values()].find(s =>
			s.projectSlug === project.id ||
			(project.discordChannelId && s.channelId === project.discordChannelId)
		)
		if (!session) return

		// Prevent infinite loops triggered by AI taking action or acknowledging tasks
		if (source === 'ai') return

		// We will accumulate updates here if we need to auto-apply 👀 reactions
		let needsSave = false
		const updatedKanban = JSON.parse(JSON.stringify(newKanban))

		// Determine what changed
		const addedTasks = updatedKanban.filter((t: any) => !oldKanban.find((o: any) => o.id === t.id))
		const changedTasks = updatedKanban.filter((t: any) => {
			const old = oldKanban.find((o: any) => o.id === t.id)
			if (!old) return false
			return (
				old.status !== t.status ||
				old.title !== t.title ||
				old.assignee !== t.assignee ||
				(t.comments?.length || 0) > (old.comments?.length || 0)
			)
		})

		const prompts: string[] = []

		for (const task of addedTasks) {
			task.reaction = '👀'
			needsSave = true
			prompts.push(`[KANBAN EVENT] A new task was just created in the project kanban board:\n- Title: "${task.title}"\n- Status: ${task.status}\n- ID: ${task.id}\n\nPlease acknowledge this task and ask clarifying questions if anything is unclear, or offer to help plan or execute it.`)
		}

		for (const task of changedTasks) {
			const old = oldKanban.find((o: any) => o.id === task.id)
			const isNewlyAssignedToAI = task.assignee?.toLowerCase() === 'ai' && old?.assignee?.toLowerCase() !== 'ai'
			const hasNewComment = (task.comments?.length || 0) > (old?.comments?.length || 0)
			const newComment = hasNewComment ? task.comments?.[task.comments.length - 1] : null
			const isUserComment = newComment && !newComment.author.toLowerCase().includes('ai')
			const statusChanged = old.status !== task.status
			const titleChanged = old.title !== task.title
			const isAssignedToAI = task.assignee?.toLowerCase() === 'ai'

			if (isNewlyAssignedToAI) {
				// High-priority auto-execution path
				task.reaction = '👀'
				needsSave = true
				prompts.push(`[KANBAN EVENT] Task "${task.title}" (ID: ${task.id}) was just assigned to you.

Execution workflow:
1. Set reaction to 👀 to acknowledge receipt
2. Move task to 'in-progress' and set reaction to 🧠
3. As you work, post progress comments using project_add_comment to keep the user informed of what you're doing (e.g. "Analyzing requirements...", "Implementing solution...", "Running validation...")
4. When finished, move task to 'awaiting-review', post a final comment with your result, and set reaction to ✅

Important: Post at least one progress comment before your final result so the user can see you're actively working.`)
			} else if (hasNewComment && isUserComment) {
				// Comment on any task — AI should engage
				newComment.reaction = '👀'
				needsSave = true
				prompts.push(`[KANBAN EVENT] A new comment was added to the task "${task.title}" (ID: ${task.id}):\n\n> ${newComment.author}: ${newComment.text}\n\nPlease respond to this comment or take action. When finished, use the project_update_comment tool to set the reaction of this comment (Comment ID: ${newComment.id}) to ✅.`)
			} else if (statusChanged && !isAssignedToAI) {
				prompts.push(`[KANBAN EVENT] Task "${task.title}" (ID: ${task.id}) moved from "${old.status}" to "${task.status}". Acknowledge and offer any relevant help if needed.`)
			} else if (titleChanged && !isAssignedToAI) {
				prompts.push(`[KANBAN EVENT] Task title was updated from "${old.title}" to "${task.title}" (ID: ${task.id}). Acknowledge and let the user know if you need any clarification.`)
			}
		}

		if (needsSave) {
			try {
				const { updateProject } = await import('../core/projects.ts')
				updateProject(project.id, { kanban: updatedKanban }, { source: 'ai' })
			} catch (e) {
				console.error('[AIService] Failed to save eye reaction state to project', e)
			}
		}

		for (const prompt of prompts) {
			this.enqueueMessage(session.id, prompt, 'SYSTEM', undefined, { source: 'from-cron' })
		}
	}


	public setDashboardPort(port: number) {
		this.dashboardPort = port
	}

	/** Directly update sessions in SQLite whose connectionNickname no longer exists in config */
	private healStaleSessionModels() {
		const config = loadConfig()
		const validNicknames = new Set(Object.keys(config.connections))
		if (validNicknames.size === 0) return

		const replacement = getDefaultModels().find(m => {
			const [nick] = m.split('/')
			return validNicknames.has(nick)
		}) ?? getAllModelOptions()[0]

		if (!replacement) return

		const [repNick, ...repRest] = replacement.split('/')
		const repModelId = repRest.join('/')

		// Find sessions with dead connectionNickname and update them in the DB
		try {
			const placeholders = [...validNicknames].map(() => '?').join(',')
			const staleSessions = db.query<{ id: string, model: string }, string[]>(
				`SELECT id, model FROM sessions WHERE connectionNickname NOT IN (${placeholders})`
			).all(...validNicknames)

			if (staleSessions.length > 0) {
				console.log(`[AIService] Healing ${staleSessions.length} stale session(s) in DB: ${staleSessions.map(s => `${s.id}(${s.model})`).join(', ')} → ${replacement}`)
				const stmt = db.prepare(`UPDATE sessions SET model = ?, connectionNickname = ?, modelId = ? WHERE id = ?`)
				for (const s of staleSessions) {
					stmt.run(replacement, repNick, repModelId, s.id)
				}
			}
		} catch (err) {
			console.error('[AIService] healStaleSessionModels failed:', err)
		}
	}

	public async refreshTools(sessionId: string) {
		try {
			const { tools, mcpClients, toolNames } = await buildActiveTools(this, sessionId)
			this.activeTools = tools
			this.toolNames = toolNames
			// Close old clients before replacing
			for (const c of this.mcpClients) await c.close().catch((err) => console.error('[AIService] Failed to close MCP client:', err))
			this.mcpClients = mcpClients
		} catch (err) {
			console.error('[AIService] Failed to load tools:', err)
		}
	}

	private loadAllSessions() {
		const stored = listAllStoredSessions()
		const config = loadConfig()
		const availableModels = getAllModelOptions()
		const defaultModels = getDefaultModels()
		for (const s of stored) {
			const full = loadSessionFromDisk(s.id)
			if (full) {
				// Heal stale model — if the stored connection no longer exists on this machine,
				// update to the first available model so the session works immediately.
				let resolvedModel = full.model
				const [storedNick] = resolvedModel.split('/')
				if (!config.connections[storedNick]) {
					const replacement = defaultModels.find(m => {
						const [nick] = m.split('/')
						return !!config.connections[nick]
					}) ?? availableModels[0]
					if (replacement) {
						console.log(`[AIService] Session ${full.id}: healing stale model "${resolvedModel}" → "${replacement}"`)
						resolvedModel = replacement
					}
				}
				const [nickname, ...rest] = resolvedModel.split('/')
				const restoredChannelId = full.channelId || 'terminal'
				const restoredWorkspacePath = resolveSessionWorkspacePath({
					isSubagent: (full as any).isSubagent,
					parentWorkspacePath: (full as any).parentSessionId
						? this.sessions.get((full as any).parentSessionId)?.workspacePath
						: undefined,
					projectSlug: (full as any).projectSlug,
				})
				// Ensure the global workspace exists (no per-channel dirs)
				try { mkdirSync(getWorkspacePathSync(), { recursive: true }) } catch { }

				const session: Session = {
					id: full.id,
					name: full.name,
					model: resolvedModel,
					connectionNickname: nickname,
					modelId: rest.join('/'),
					createdAt: new Date(full.createdAt),
					updatedAt: new Date(full.updatedAt),
					queue: [],
					processing: false,
					messages: full.messages,
					summary: full.summary,
					emitter: new EventEmitter(),
					heartbeatTimer: null,
					channelId: restoredChannelId,
					channelUserId: full.channelUserId,
					channelName: full.channelName,
					parentSessionId: (full as any).parentSessionId,
					isSubagent: (full as any).isSubagent || false,
					workspacePath: restoredWorkspacePath,
				}
				this.sessions.set(full.id, session)
				if (session.channelId && session.channelUserId) {
					this.bridgeSessionMap.set(`${session.channelId}:${session.channelUserId}`, session.id)
				}
				this.attachBridgeListeners(session)
				// Persist healed model back to DB so it survives next restart
				if (resolvedModel !== full.model) {
					saveSessionToDisk(this.toPersist(session))
				}
			}
		}
	}

	public getSession(id: string): Session | undefined {
		return this.sessions.get(id)
	}

	public getAllSessions() {
		return [...this.sessions.values()]
	}

	public getSessionForBridge(channelId: string, channelUserId: string): Session | undefined {
		const sessionId = this.bridgeSessionMap.get(`${channelId}:${channelUserId}`)
		return sessionId ? this.sessions.get(sessionId) : undefined
	}

	public createSession(options: CreateSessionOptions): Session {
		let projectSlug = options.projectSlug
		if (!projectSlug && options.id?.startsWith('project-')) {
			projectSlug = options.id.replace('project-', '')
		}
		const config = loadConfig()
		debug(`createSession(): options.model=${options.model}, getDefaultModel()=${getDefaultModel()}`)
		debug(`createSession(): connections in config: [${Object.keys(config.connections).join(', ') || 'NONE'}]`)
		let modelStr = options.model ?? getDefaultModel()
		// If the requested model's connection doesn't exist, fall back to any configured one
		if (modelStr) {
			const [nick] = modelStr.split('/')
			if (!config.connections[nick]) {
				debug(`createSession(): connection "${nick}" not found — attempting fallback`)
				const fallback = getDefaultModels().find(m => {
					const [n] = m.split('/')
					return !!config.connections[n]
				}) ?? getAllModelOptions()[0]
				if (fallback) {
					console.log(`[AIService] createSession: model "${modelStr}" connection not found, using "${fallback}" instead`)
					modelStr = fallback
				} else {
					console.warn(`[AIService] createSession: no fallback found either! connections=[${Object.keys(config.connections).join(', ')}]`)
				}
			}
		}
		modelStr = modelStr ?? getAllModelOptions()[0] ?? 'openai/gpt-4o'
		const [nickname, ...rest] = modelStr.split('/')
		const modelId = rest.join('/') || modelStr

		// Resolve named agent dir
		let agentSlug: string | undefined
		let agentDir: string | undefined
		if (options.agentId) {
			const agent = findAgent(options.agentId)
			if (agent) {
				agentSlug = agent.slug
				agentDir = getAgentDir(agent.slug)
			}
		}

		// Derive a short task slug for sub-agents
		let taskSlug: string | undefined
		if (options.isSubagent && options.task) {
			taskSlug = options.task
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, '')
				.trim()
				.split(/\s+/)
				.slice(0, 4)
				.join('-')
		}

		// Workspace: sub-agents inherit parent; project-linked sessions use that project's path;
		// everything else (bridge or terminal) uses the global configured workspace.
		const parentSession = options.parentSessionId ? this.sessions.get(options.parentSessionId) : undefined
		const sessionWorkspacePath = resolveSessionWorkspacePath({
			isSubagent: options.isSubagent,
			parentWorkspacePath: parentSession?.workspacePath,
			projectSlug: projectSlug,
		})
		// Ensure the global workspace exists (no per-session/per-channel dirs)
		try { mkdirSync(getWorkspacePathSync(), { recursive: true }) } catch { }

		const session: Session = {
			id: options.id ?? `sess_${Math.random().toString(36).slice(2, 10)}`,
			model: modelStr,
			connectionNickname: nickname,
			modelId,
			createdAt: new Date(),
			updatedAt: new Date(),
			queue: [],
			processing: false,
			messages: [],
			emitter: new EventEmitter(),
			heartbeatTimer: null,
			channelId: options.channelId || 'terminal',
			channelUserId: options.channelUserId,
			channelName: options.channelName,
			parentSessionId: options.parentSessionId,
			isSubagent: options.isSubagent || false,
			task: options.task,
			taskSlug,
			subagentStatus: options.isSubagent ? 'pending' : undefined,
			spawnedAt: options.isSubagent ? new Date() : undefined,
			agentId: options.agentId,
			agentSlug,
			agentDir,
			projectSlug: projectSlug,
			workspacePath: sessionWorkspacePath,
			modelTier: options.modelTier,
		}

		// Sub-agents MUST NOT overwrite the parent's entry in bridgeSessionMap.
		// They share the same channelId/channelUserId as their parent, so registering
		// here would redirect every subsequent user message to the sub-agent instead
		// of the parent session, causing the "🧠 Working on: <task>" loop.
		if (session.channelId && session.channelUserId && !session.isSubagent) {
			this.bridgeSessionMap.set(`${session.channelId}:${session.channelUserId}`, session.id)
		}

		this.attachBridgeListeners(session)
		this.sessions.set(session.id, session)
		return session
	}

	private attachBridgeListeners(session: Session) {
		if (session.channelId === 'terminal') return

		// Sub-agents: suppress raw output streaming to the channel.
		// Instead, emit clean lifecycle status notifications so the user knows
		// what's happening without seeing the sub-agent's entire working text.
		if (session.isSubagent) {
			session.emitter.on('event', (evt: DaemonEvent) => {
				if (evt.type === 'start') {
					session.subagentStatus = 'running'
					this.bridgeManager.dispatchEvent(session.channelId, {
						type: 'subagent-status',
						subagentId: session.id,
						task: truncateTask(session.task),
						status: 'started',
						message: truncateTask(session.task),
					}, session).catch(console.error)
				}
				// All other event types (chunk, tool_call, tool_result, done, error)
				// are intentionally suppressed here — lifecycle events are handled
				// in processSession after the run finishes.
			})
			return
		}

		const buffer: string[] = []
		session.emitter.on('event', (evt: DaemonEvent) => {
			if (evt.type === 'start') {
				console.log(`[AIService] Dispatching 'start' event → channelId=${session.channelId} channelUserId=${session.channelUserId}`)
				this.bridgeManager.dispatchEvent(session.channelId, evt, session).catch(console.error)
				return
			}
			if (evt.type === 'chunk') {
				buffer.push(evt.text)
				return
			}
			if (evt.type === 'done') {
				console.log(`[AIService] Dispatching 'done' event → channelId=${session.channelId} suppressed=${(evt as any).suppressed} bufferLen=${buffer.length}`)
				if (!evt.suppressed) {
					// Flush buffer
					for (const chunk of buffer) {
						this.bridgeManager.dispatchEvent(session.channelId, { type: 'chunk', text: chunk }, session).catch(console.error)
					}
				}
				this.bridgeManager.dispatchEvent(session.channelId, evt, session).catch(console.error)
				buffer.length = 0 // clear
				return
			}
			this.bridgeManager.dispatchEvent(session.channelId, evt, session).catch(console.error)
		})
	}

	public deleteSession(id: string) {
		const session = this.sessions.get(id)
		if (session) {
			if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
			session.emitter.removeAllListeners('event')
			this.sessions.delete(id)
		}
	}

	/** Called by the sub-agent callback tool to mark that the sub-agent explicitly reported back. */
	public markSubagentCallbackCalled(sessionId: string) {
		const session = this.sessions.get(sessionId)
		if (session) session.subagentCallbackCalled = true
	}

	/** Called by the sub-agent progress tool to broadcast a status update to the originating channel. */
	public updateSubagentProgress(sessionId: string, message: string) {
		const session = this.sessions.get(sessionId)
		if (!session?.isSubagent) return
		session.progress = message
		if (session.channelId !== 'terminal') {
			this.bridgeManager.dispatchEvent(session.channelId, {
				type: 'subagent-status',
				subagentId: session.id,
				task: truncateTask(session.task),
				status: 'progress',
				message,
			}, session).catch(console.error)
		}
	}

	public async reportSubagentResult(sessionId: string, data: { task: string; status: 'completed' | 'failed'; reason?: string; outcome?: string; context?: any }) {
		const session = this.sessions.get(sessionId)
		if (!session || !session.parentSessionId) return

		const parentSession = this.sessions.get(session.parentSessionId)
		if (!parentSession) return

		let report = `### 🧠 Sub-agent Report\n\n`
		report += `**Task:** ${data.task}\n`
		report += `**Status:** ${data.status === 'completed' ? '✅ completed' : '❌ failed'}\n`
		if (data.reason) report += `**Reason:** ${data.reason}\n`
		if (data.outcome) report += `\n**Outcome:**\n${data.outcome}\n`
		if (data.context) {
			report += `\n**Context:**\n\`\`\`json\n${JSON.stringify(data.context, null, 2)}\n\`\`\`\n`
		}
		report += `\n_The sub-agent has finished. Please integrate its findings and continue the conversation naturally, summarising the outcome for the user._`

		await this.enqueueMessage(parentSession.id, report, undefined, undefined, { source: 'subagent-report' })
	}

	/**
	 * Hand off the current session to a different named agent.
	 * Updates the session's agent context and notifies the user through the bridge.
	 */
	public async handoffSession(sessionId: string, targetAgentId: string, reason: string, context?: string) {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error('Session not found')

		const { findAgent, getAgentDir, resolveAgentModelChain } = await import('../utils/agentsStore.ts')
		const targetAgent = findAgent(targetAgentId)
		if (!targetAgent) throw new Error(`Agent "${targetAgentId}" not found`)

		const fromAgent = session.agentSlug || 'default'

		// Notify the user via bridge before switching
		const handoffEvent: DaemonEvent = {
			type: 'agent-handoff',
			fromAgent,
			toAgent: targetAgent.slug,
			reason,
		}
		session.emitter.emit('event', handoffEvent)

		// Update session agent context
		session.agentId = targetAgent.id
		session.agentSlug = targetAgent.slug
		session.agentDir = getAgentDir(targetAgent.slug)

		// Update model chain to prefer the new agent's model
		const agentModels = resolveAgentModelChain(targetAgent)
		if (agentModels.length > 0) {
			session.model = agentModels[0]
		}

		// Inject context summary for the new agent
		if (context) {
			session.summary = (session.summary ? session.summary + '\n\n' : '') +
				`## Handoff from ${fromAgent}\n\n**Reason:** ${reason}\n\n${context}`
		} else {
			session.summary = (session.summary ? session.summary + '\n\n' : '') +
				`## Handoff from ${fromAgent}\n\n**Reason:** ${reason}`
		}

		console.log(`[AIService] Session ${sessionId} handed off from ${fromAgent} to ${targetAgent.slug}`)
	}

	public async enqueueMessage(sessionId: string, content: string, authorName?: string, attachments?: BridgeMessage['attachments'], metadata?: { source: string }) {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error('Session not found')
		session.queue.push({ sessionId, content, authorName, attachments, metadata })
		this.processSession(session).catch(console.error)
	}

	private async processSession(session: Session) {
		if (session.processing || session.queue.length === 0) return
		session.processing = true
		console.log(`[AIService] processSession: id=${session.id} channelId=${session.channelId} channelUserId=${session.channelUserId} queueLen=${session.queue.length}`)

		const job = session.queue.shift()!
		let messageContent = job.authorName ? `[${job.authorName}]: ${job.content}` : job.content

		// Handle attachments (text files, audio for transcription, etc.)
		if (job.attachments && job.attachments.length > 0) {
			for (const att of job.attachments) {
				if ((att.type === 'file' || att.type === 'audio') && att.buffer) {
					// Strip CDN query parameters before testing the URL extension
					const cleanUrl = att.url != null ? att.url.split('?')[0] : null
					const isAudio = att.type === 'audio'
						|| att.mimeType.startsWith('audio/')
						|| att.mimeType === 'application/ogg'
						|| (cleanUrl != null && /\.(ogg|mp3|m4a|wav|flac|aac|opus|weba|webm)$/i.test(cleanUrl))

					if (isAudio) {
						// Transcribe audio attachments (e.g. voice messages from Discord)
						const filename = att.url?.split('/').pop()?.split('?')[0] || 'audio'
						try {
							console.log(`[AIService] Transcribing audio attachment: ${filename} (${att.mimeType})`)
							const { transcribeAudioBuffer } = await import('../utils/transcription.ts')
							const transcript = await transcribeAudioBuffer(att.buffer)
							if (transcript) {
								messageContent = messageContent
									? `${messageContent}\n\n[Transcribed audio: ${transcript}]`
									: `[Transcribed audio: ${transcript}]`
								console.log(`[AIService] Audio transcribed: "${transcript.slice(0, 100)}"`)
							} else {
								console.warn(`[AIService] Audio transcription returned empty for ${filename}`)
								messageContent = messageContent
									? `${messageContent}\n\n[User sent an audio message but it was silent or could not be transcribed]`
									: `[User sent an audio message but it was silent or could not be transcribed]`
							}
						} catch (err) {
							console.error('[AIService] Failed to transcribe audio attachment:', err)
							// Surface the failure to the user rather than silently dropping the audio
							session.emitter.emit('event', {
								type: 'error',
								message: `⚠️ Audio transcription failed for "${filename}". Please send your message as text instead.`
							} as DaemonEvent)
							session.processing = false
							if (session.queue.length > 0) setImmediate(() => this.processSession(session))
							return
						}
					} else if (att.mimeType.startsWith('text/') || att.mimeType === 'application/json' || att.mimeType === 'application/javascript' || att.mimeType === 'application/typescript' || att.mimeType === 'application/octet-stream') {
						// Check if it looks like text even if octet-stream
						const text = att.buffer.toString('utf-8')
						// Rough check for binary
						const isLikelyText = !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text.slice(0, 1024))
						if (isLikelyText) {
							messageContent += `\n\n--- ATTACHED FILE: ${att.url?.split('/').pop() || 'unknown'} ---\n${text}\n--- END ATTACHED FILE ---`
						}
					}
				}
			}
		}

		// Build multimodal content when image attachments are present
		const imageAttachments = job.attachments?.filter(att => att.type === 'image' && att.buffer) ?? []
		let userContent: string | any[]
		if (imageAttachments.length > 0) {
			const parts: any[] = [{ type: 'text', text: messageContent }]
			for (const img of imageAttachments) {
				parts.push({ type: 'image', image: new Uint8Array(img.buffer!), mimeType: img.mimeType })
			}
			userContent = parts
		} else {
			userContent = messageContent
		}
		session.messages.push({ role: 'user', content: userContent })

		const config = loadConfig()
		// Priority order: smart models (if tier=smart) → configured default models → session's stored model → any other configured model
		// Only include models whose connection actually exists on this machine.
		const currentDefaults = getDefaultModels()
		const currentSmartModels = getSmartModels()
		const allConfiguredModels = getAllModelOptions()
		debug(`processSession(${session.id}): session.model=${session.model} connectionNickname=${session.connectionNickname} modelTier=${session.modelTier}`)
		debug(`processSession(${session.id}): config connections=[${Object.keys(config.connections).join(', ') || 'NONE'}]`)
		debug(`processSession(${session.id}): currentDefaults=[${currentDefaults.join(', ') || 'NONE'}]`)
		debug(`processSession(${session.id}): smartModels=[${currentSmartModels.join(', ') || 'NONE'}]`)
		debug(`processSession(${session.id}): allConfiguredModels=[${allConfiguredModels.join(', ') || 'NONE'}]`)
		const modelsToTry = [
			// Agent-specific models take highest priority
			...(session.agentId ? (() => {
				const agent = findAgent(session.agentId)
				return agent ? resolveAgentModelChain(agent) : []
			})() : []),
			// Smart models take priority when tier is 'smart'
			...(session.modelTier === 'smart' ? currentSmartModels : []),
			...currentDefaults,
			session.model,
			...allConfiguredModels,
		].filter((m, i, arr) => {
			if (!m) return false
			if (arr.indexOf(m) !== i) return false // deduplicate
			const [nick] = m.split('/')
			if (!config.connections[nick]) {
				console.log(`[AIService] Skipping model "${m}" — connection "${nick}" not in config [${Object.keys(config.connections).join(', ')}]`)
				return false
			}
			return true
		})
		console.log(`[AIService] session=${session.id} modelsToTry=[${modelsToTry.join(', ') || 'NONE'}]`)
		if (modelsToTry.length === 0) {
			const configuredConns = Object.keys(config.connections)
			const diagMsg = configuredConns.length === 0
				? `No AI connections configured. Run \`tamias models\` on the server to set one up.`
				: `Session model "${session.model}" uses connection "${session.connectionNickname}" which is not in config. Configured connections: ${configuredConns.join(', ')}. Run \`tamias stop && tamias start\` on the server.`
			console.error(`[AIService] No valid models to try for session ${session.id}. Config connections: [${configuredConns.join(', ')}]`)
			session.messages.pop() // remove the user message we pushed since we can't respond
			session.emitter.emit('event', { type: 'error', message: diagMsg } as DaemonEvent)
			session.emitter.emit('event', { type: 'done', sessionId: session.id }) // Added this line
			session.processing = false
			if (session.queue.length > 0) setImmediate(() => this.processSession(session))
			return
		}

		let lastError: any = null
		const failures: Array<{ model: string; error: string }> = []

		// Emit 'start' once per message job, BEFORE the model-retry loop.
		// Emitting inside the loop caused a second 'start' on retry, which
		// popped the next queued Discord message prematurely, resulting in
		// that message receiving two responses.
		session.emitter.emit('event', { type: 'start', sessionId: session.id } as DaemonEvent)

		for (const currentModelStr of modelsToTry) {
			const [nickname, ...rest] = currentModelStr.split('/')
			const modelId = rest.join('/') || currentModelStr
			const connection = config.connections[nickname]

			if (!connection) {
				console.warn(`[AIService] No connection object for "${nickname}" (model="${currentModelStr}") — skipping`)
				lastError = new Error(`No AI connection configured for "${nickname}"`)
				failures.push({ model: currentModelStr, error: `No connection config for "${nickname}"` })
				continue
			}

			console.log(`[AIService] Attempting session ${session.id} via ${currentModelStr} (provider=${connection.provider})`)
			debug(`  API key present: ${!!getApiKeyForConnection(connection.nickname)}, modelId=${modelId}`)
			let _streamResult: ReturnType<typeof streamText> | undefined
			try {
				await this.refreshTools(session.id)
				const model = this.buildModel(connection, modelId)
				const toolFunctionNames = Object.keys(this.activeTools)

				// Build project context for system prompt
				let projectContext: string | undefined
				try {
					const { buildProjectContext, findProjectInstructionFile } = await import('../utils/projects')
					const parts: string[] = []

					// Priority A: Session has an explicit project slug (Dashboard Project Chat)
					if (session.projectSlug) {
						try {
							const { getProject } = await import('../core/projects')
							const project = getProject(session.projectSlug)
							if (project) {
								let projText = `## Active Project Context: ${project.name}\n`
								if (project.description) projText += `**Description**: ${project.description}\n`

								// Inject project-specific AI instructions (e.g. .tamias-instructions.md)
								if (project.path) {
									const instruction = findProjectInstructionFile(project.path)
									if (instruction) {
										projText += `\n### Project Instructions (${instruction.filename}):\n\n${instruction.content}\n`
									}
								}

								if (project.kanban && project.kanban.length > 0) {
									const activeTasks = project.kanban.filter(t => t.status !== 'done')
									if (activeTasks.length > 0) {
										projText += `\n### Active Kanban Tasks:\n${activeTasks.map(t => `- [${t.status}] ${t.title} | Assignee: ${t.assignee || 'None'} | ID: ${t.id}`).join('\n')}\n`
									}
								}

								if (project.contextFile && project.path) {
									const { join } = await import('path')
									const { existsSync, readFileSync } = await import('fs')
									const ctxPath = join(project.path, project.contextFile)
									if (existsSync(ctxPath)) {
										const content = readFileSync(ctxPath, 'utf-8')
										projText += `\n### Context File (${project.contextFile}):\n\`\`\`\n${content}\n\`\`\``
									}
								}
								parts.push(projText)
							}
						} catch (e) {
							console.error(`[AIService] Failed to load explicit project context for ${session.projectSlug}`, e)
						}
					}

					// Priority B: Session comes from a linked Discord channel (and isn't already the active project)
					try {
						const { getProjectByDiscordChannel } = await import('../core/projects')
						const linkedProject = getProjectByDiscordChannel(session.channelId)
						if (linkedProject && linkedProject.id !== session.projectSlug) {
							let projText = `## Linked Project Context (${linkedProject.name})\n`
							if (linkedProject.description) projText += `**Description**: ${linkedProject.description}\n`

							// Inject project-specific AI instructions (e.g. .tamias-instructions.md)
							if (linkedProject.path) {
								const instruction = findProjectInstructionFile(linkedProject.path)
								if (instruction) {
									projText += `\n### Project Instructions (${instruction.filename}):\n\n${instruction.content}\n`
								}
							}

							if (linkedProject.kanban && linkedProject.kanban.length > 0) {
								const activeTasks = linkedProject.kanban.filter(t => t.status !== 'done')
								if (activeTasks.length > 0) {
									projText += `\n### Active Kanban Tasks:\n${activeTasks.map(t => `- [${t.status}] ${t.title} | Assignee: ${t.assignee || 'None'} | ID: ${t.id}`).join('\n')}\n`
								}
							}

							if (linkedProject.contextFile) {
								const { join } = await import('path')
								const { existsSync, readFileSync } = await import('fs')
								const ctxPath = join(linkedProject.path, linkedProject.contextFile)
								if (existsSync(ctxPath)) {
									const content = readFileSync(ctxPath, 'utf-8')
									projText += `\n### Context File: ${linkedProject.contextFile}\n\`\`\`\n${content}\n\`\`\``
								}
							}
							parts.push(projText)
						}
					} catch (e) {
						console.error('[AIService] Failed to load discord project context', e)
					}

					// Always include the shallow list of all projects for cross-reference
					try {
						const shallowCtx = buildProjectContext()
						if (shallowCtx) parts.push(shallowCtx)
					} catch { }

					if (parts.length > 0) projectContext = parts.join('\n\n---\n\n')
				} catch (err) {
					console.error('[AIService] Critical error building project context', err)
				}

				const systemPrompt = buildSystemPrompt(session.summary, {
					id: session.channelId,
					userId: session.channelUserId,
					name: session.channelName,
					authorName: job.authorName,
					isSubagent: session.isSubagent
				}, session.agentDir, { projectContext, modelContextWindow: connection.contextWindow ?? 128000, sessionWorkspacePath: session.workspacePath })

				// ── Token-budgeted message trimming ──────────────────────────
				const ctxWindow = connection.contextWindow ?? 128000
				const msgRatio = config.messageTokenRatio ?? 0.30
				const responseReserve = config.responseTokenReserve ?? 8192
				const systemTokens = estimateTokens(systemPrompt)
				const messageBudget = getMessageTokenBudget(ctxWindow, systemTokens, responseReserve, msgRatio)
				const { kept: messagesForSend, dropped } = trimMessagesToTokenBudget(
					session.messages as any,
					messageBudget,
				)
				if (dropped > 0) {
					console.log(`[AIService] Trimmed ${dropped} oldest messages to fit ${messageBudget}-token budget (ctx=${ctxWindow}, sys=${systemTokens})`)
				}

				const startTime = Date.now()
				const source = job.metadata?.source || 'from-chat'
				const headers: Record<string, string> = {
					'X-Title': `Tamias (${source})`,
					'X-Tamias-Source': source,
				}


				const collectedToolCalls: Array<{ toolName: string; input: unknown }> = []
				const collectedToolResults: Array<{ toolName: string; result: unknown }> = []

				const sanitizeForLog = (value: any): any => {
					if (value == null) return value
					if (Buffer.isBuffer(value)) return { __type: 'Buffer', length: value.length }
					if (Array.isArray(value)) return value.map(sanitizeForLog)
					if (typeof value === 'object') {
						const out: Record<string, any> = {}
						for (const [key, v] of Object.entries(value)) {
							if (key === 'buffer' && (Buffer.isBuffer(v) || typeof v === 'string')) {
								out[key] = Buffer.isBuffer(v) ? { __type: 'Buffer', length: (v as Buffer).length } : { __type: 'StringBuffer', length: String(v).length }
								continue
							}
							out[key] = sanitizeForLog(v)
						}
						return out
					}
					return value
				}

				// Build provider-specific options (cache scoping, usage tracking)
				const providerOpts = buildProviderOptions(connection.provider, modelId, session.id)

				_streamResult = streamText({
					model,
					system: systemPrompt,
					messages: messagesForSend as any,
					tools: toolFunctionNames.length > 0 ? (this.activeTools as any) : undefined,
					stopWhen: stepCountIs(10),
					headers,
					...(providerOpts ? { providerOptions: providerOpts } : {}),
					onStepFinish: async ({ toolCalls, toolResults }) => {
						if (toolCalls?.length) {
							for (const tc of toolCalls) {
								collectedToolCalls.push({ toolName: tc.toolName, input: sanitizeForLog((tc as any).input ?? {}) })
								session.emitter.emit('event', { type: 'tool_call', name: tc.toolName, input: (tc as any).input ?? {} } as DaemonEvent)
							}
						}
						if (toolResults?.length) {
							for (const tr of (toolResults as any)) {
								collectedToolResults.push({ toolName: tr.toolName, result: sanitizeForLog(tr.result) })
								// Emit tool_result event
								session.emitter.emit('event', { type: 'tool_result', name: tr.toolName, result: tr.result } as DaemonEvent)

								// Also emit file events for tools returning { __tamias_file__: true, name, buffer, mimeType }
								const res = tr?.result
								if (res?.__tamias_file__ === true && res.name && res.buffer) {
									session.emitter.emit('event', {
										type: 'file',
										name: res.name,
										buffer: Buffer.isBuffer(res.buffer) ? res.buffer : Buffer.from(res.buffer),
										mimeType: res.mimeType ?? 'application/octet-stream',
									} as DaemonEvent)
								}
							}
						}
					},
				})

				let fullResponse = ''
				let suppressed = false

				for await (const chunk of _streamResult.textStream) {
					fullResponse += chunk
					session.emitter.emit('event', { type: 'chunk', text: chunk } as DaemonEvent)
				}

				if (fullResponse.trim() === 'HEARTBEAT_OK') {
					suppressed = true
				}

				// Await totalUsage (sums ALL multi-step tool-call rounds, not just the last step)
				const usage = await Promise.resolve(_streamResult.totalUsage).catch((err: unknown) => {
					console.warn('[AIService] Failed to retrieve usage stats:', err)
					return {
						inputTokens: undefined,
						outputTokens: undefined,
						totalTokens: undefined,
						inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
						outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
					} satisfies import('ai').LanguageModelUsage
				})

				const response = await Promise.resolve(_streamResult.response).catch(() => null)
				const fullMessages = response?.messages ?? []

				const logId = logAiRequest({
					timestamp: new Date().toISOString(),
					sessionId: session.id,
					model: currentModelStr,
					provider: nickname,
					action: 'chat',
					durationMs: Date.now() - startTime,
					tokens: {
						prompt: usage?.inputTokens,
						completion: usage?.outputTokens,
						total: usage?.totalTokens,
					},
					messages: [
						{ role: 'system', content: systemPrompt },
						...fullMessages,
					],
					systemPromptText: systemPrompt,
					requestInputMessages: messagesForSend as any,
					toolCalls: collectedToolCalls,
					toolResults: collectedToolResults,
					usageRaw: usage,
					response: fullResponse,
					tenantId: (session as any).tenantId,
					agentId: session.agentId,
					channelId: session.channelId,
					cachedPromptTokens: usage?.inputTokenDetails?.cacheReadTokens,
				})

				if (config.debug) {
					const debugMeta = [
						'',
						'--- DEBUG INFO ---',
						`Model: ${currentModelStr}`,
						`Tokens: ${usage?.totalTokens || 0} (Prompt: ${usage?.inputTokens || 0}, Completion: ${usage?.outputTokens || 0})`,
					]
					if (this.dashboardPort && logId) {
						debugMeta.push(`Log: http://localhost:${this.dashboardPort}/history?log=${logId}`)
					}
					debugMeta.push('---')

					const footer = debugMeta.join('\n')
					fullResponse += footer
					session.emitter.emit('event', { type: 'chunk', text: footer } as DaemonEvent)
				}

				session.messages.push({ role: 'assistant', content: fullResponse })
				session.updatedAt = new Date()

				// If we used a fallback model, update the session so next messages use it directly
				if (currentModelStr !== session.model) {
					console.log(`[AIService] Permanently updating session ${session.id} model from ${session.model} to ${currentModelStr}`)
					session.model = currentModelStr
					session.modelId = modelId
					session.connectionNickname = nickname
				}

				// Sub-agent sessions are transient — skip persisting them
				if (!session.isSubagent) {
					saveSessionToDisk(this.toPersist(session))
				}
				session.emitter.emit('event', { type: 'done', sessionId: session.id, suppressed } as DaemonEvent)

				// If this is a subagent, report back to parent and notify the channel
				if (session.isSubagent && session.parentSessionId) {
					session.subagentStatus = 'completed'
					session.completedAt = new Date()

					const parentSession = this.sessions.get(session.parentSessionId)
					if (parentSession) {
						// Send a clean "done" status notification to the channel so the user
						// knows the sub-agent finished and the main AI is now processing
						if (session.channelId !== 'terminal') {
							this.bridgeManager.dispatchEvent(session.channelId, {
								type: 'subagent-status',
								subagentId: session.id,
								task: truncateTask(session.task),
								status: 'completed',
								message: truncateTask(session.task),
							}, session).catch(console.error)
						}

						// Only inject a fallback report if the sub-agent didn't explicitly
						// call the callback tool (which already reported back properly)
						if (!session.subagentCallbackCalled) {
							await this.reportSubagentResult(session.id, {
								task: truncateTask(session.task),
								status: 'completed',
								outcome: fullResponse,
							})
						}
					}

					// Sub-agent sessions are transient. Remove from memory now that the report
					// has been sent so no subsequent user message can be routed here.
					this.deleteSession(session.id)
					return
				}

				// Token-based compaction trigger: compact when message tokens exceed the budget
				const postMsgTokens = estimateMessageTokens(session.messages as any)
				const compactCtxWindow = connection.contextWindow ?? 128000
				const compactMsgRatio = config.messageTokenRatio ?? 0.30
				if (postMsgTokens > compactCtxWindow * compactMsgRatio) {
					this.compactSession(session, model, connection, config).then(() => {
						saveSessionToDisk(this.toPersist(session))
					}).catch((err) => console.error(`[AIService] Session compaction failed for ${session.id}:`, err))
				}

				session.processing = false
				if (session.queue.length > 0) {
					setImmediate(() => this.processSession(session))
				}
				return // Success!
			} catch (err: any) {
				// Suppress the totalUsage promise rejection that floats after a stream error
				if (_streamResult) Promise.resolve(_streamResult.totalUsage).catch(() => { })
				const errStr = err?.message || String(err)
				const isToolUnsupported = errStr.includes('tool use') || errStr.includes('tool_use') || errStr.includes('No endpoints found that support')
				if (isToolUnsupported) {
					console.warn(`[AIService] Skipping ${currentModelStr} — does not support tool use, trying next model`)
				} else {
					console.error(`[AIService] Failed with model ${currentModelStr}: ${errStr}`)
				}
				failures.push({ model: currentModelStr, error: errStr })
				lastError = err
				// Continue to next model
			}
		}

		// If we get here, all models failed
		const failureSummary = failures.map(f => `${f.model}: ${f.error}`).join(' | ')
		console.error(`[AIService] All models failed for session ${session.id}: ${failureSummary}`)
		session.emitter.emit('event', { type: 'error', message: `All AI models failed:\n${failures.map(f => `• ${f.model}: ${f.error}`).join('\n')}` } as DaemonEvent)

		// If this is a sub-agent, report the failure back to the parent and notify the channel
		if (session.isSubagent && session.parentSessionId) {
			session.subagentStatus = 'failed'
			session.completedAt = new Date()

			if (session.channelId !== 'terminal') {
				this.bridgeManager.dispatchEvent(session.channelId, {
					type: 'subagent-status',
					subagentId: session.id,
					task: truncateTask(session.task),
					status: 'failed',
					message: 'All AI models failed',
				}, session).catch(console.error)
			}

			await this.reportSubagentResult(session.id, {
				task: truncateTask(session.task),
				status: 'failed',
				reason: failureSummary,
			}).catch(console.error)

			// Sub-agent sessions are transient — remove from memory after reporting.
			this.deleteSession(session.id)
			return
		}

		session.processing = false
		if (session.queue.length > 0) {
			setImmediate(() => this.processSession(session))
		}
	}

	private buildModel(connection: ConnectionConfig, modelId: string) {
		const apiKey = getApiKeyForConnection(connection.nickname)
		switch (connection.provider) {
			case 'openai': return createOpenAI({ apiKey })(modelId)
			case 'anthropic': return createAnthropic({ apiKey })(modelId) as any
			case 'google': return createGoogleGenerativeAI({ apiKey })(modelId) as any
			case 'openrouter': {
				return createOpenRouter({ apiKey })(modelId, {
					usage: { include: true },
				})
			}
			case 'ollama': {
				let baseURL = (connection as any).baseUrl || 'http://127.0.0.1:11434'
				baseURL = baseURL.replace(/\/$/, '')
				if (!baseURL.endsWith('/v1')) baseURL += '/v1'
				return createOpenAI({ baseURL, apiKey: apiKey || 'ollama' }).chat(modelId)
			}
			default: throw new Error(`Unsupported provider: ${connection.provider}`)
		}
	}

	private async compactSession(session: Session, model: any, connection?: ConnectionConfig, cfg?: any) {
		const ctxWindow = connection?.contextWindow ?? 128000
		const msgRatio = cfg?.messageTokenRatio ?? 0.30
		const responseReserve = cfg?.responseTokenReserve ?? 8192
		const msgTokens = estimateMessageTokens(session.messages as any)
		if (msgTokens <= ctxWindow * msgRatio * 0.5) return // not worth compacting yet

		// ── Use cheap compaction model if configured ──────────────────────
		let compactionModel = model
		const compactionModelStr = getCompactionModel()
		if (compactionModelStr) {
			try {
				const [nickname, ...rest] = compactionModelStr.split('/')
				const modelId = rest.join('/')
				const allConnections = getAllConnections()
				const conn = allConnections.find(c => c.nickname === nickname)
				if (conn) {
					compactionModel = this.buildModel(conn, modelId)
					console.log(`[AIService] Using compaction model: ${compactionModelStr}`)
				}
			} catch (err) {
				console.warn(`[AIService] Failed to build compaction model '${compactionModelStr}', falling back to default:`, err)
			}
		}

		const startTime = Date.now()
		try {
			// ── Split messages into old (to compact) and recent (to keep) ──────
			const postBudget = getMessageTokenBudget(ctxWindow, 0, responseReserve, msgRatio) * 0.5
			const { kept: messagesToKeep } = trimMessagesToTokenBudget(session.messages as any, postBudget)
			const messagesToCompact = (session.messages as any[]).slice(0, session.messages.length - messagesToKeep.length)

			const personaFiles = readAllPersonaFiles()
			const existingContext = Object.entries(personaFiles)
				.map(([file, content]) => `### ${file}\n${content}`)
				.join('\n\n')

			const today = new Date().toISOString().slice(0, 10)
			const oldHistoryText = messagesToCompact.map((m: any) => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n')
			const keptHistoryText = messagesToKeep.map((m: any) => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n')

			const compactionPrompt = `### TASK: INCREMENTAL CONTEXT COMPACTION
You are managing the long-term memory buffer for an AI assistant called Tamias.

### GOAL
Summarize the OLDER portion of the conversation below. This summary will be prepended to the current active chat buffer so the agent retains context across the token boundary.

### REQUIREMENTS
- **Focus on Outcomes:** What was actually accomplished or decided in the older turns? Skip small-talk and failed attempts — lead with what was resolved.
- **Variable Persistence:** Preserve any specific paths, IDs, file names, URLs, version numbers, or configuration values that were mentioned — these are easy to lose but critical to retain.
- **Tone/Persona:** Did the user give any instructions on how to behave, what to call them, or what style to use? Carry those forward.
- **Brevity:** Summarize into no more than 3-4 dense paragraphs. Every sentence must earn its place.

### MEMORY FILE RESPONSIBILITIES

You also maintain the following persistent files. Update them as needed based on the FULL conversation (old + kept).

#### MEMORY.md (rewritten every compaction)
The living activity log. Rewrite it entirely — merge existing content with new information:
1. **Last Session** — a 2-3 sentence narrative of what was just discussed and accomplished.
2. **Lessons Learned** — bullet list of important discoveries: API quirks, user preferences, bugs found, conventions to follow.
3. **Pending** — bullet list of tasks or follow-ups that carry over to the next session.

#### USER.md (only when genuinely new personal facts are discovered)
Stable facts about the human: identity, communication style (the **Style:** field), what they care about, what annoys them, recurring patterns. NOT a project log.
- Only provide a \`userUpdate\` if something meaningfully NEW was learned. Otherwise leave empty.
- If provided, rewrite USER.md entirely — merge existing content with new info. Keep the \`- **Style:**\` field.

#### IDENTITY.md (appended only when genuinely new)
New preferences for how the AI should behave, new personality traits observed.
Leave the insights array EMPTY if nothing new was learned. DO NOT repeat existing context.

#### PROJECT-README.md (only if project work was discussed)
Concise technical summary: architecture, key components, conventions, current state. Include a \`## Todo List\` section — placeholder \`- put todos here\` if no concrete todos.

### EXISTING PERSONA CONTEXT
${existingContext}

### INSTRUCTIONS
1. **Summary** — 3-4 dense paragraphs covering outcomes, key variables, and user preferences from the OLD HISTORY below.
2. **Session Name** — short (2-4 words) descriptive label for this session.
3. **MEMORY.md Update** — full rewrite: Last Session + Lessons Learned + Pending.
4. **USER.md Update** (optional) — full rewrite only if new personal facts emerged.
5. **IDENTITY.md Insights** (optional) — append-only, only genuinely new AI behavior insights.
6. **Project README** (optional) — only if project work was discussed.

### INPUT: OLD HISTORY (summarize this)
${oldHistoryText}

### INPUT: RECENT MESSAGES BEING KEPT (context — do NOT summarize, just use for awareness)
${keptHistoryText}`

			const compProviderOpts = buildProviderOptions(connection?.provider ?? '', '', session.id)

			const { object, usage } = await generateObject({
				model: compactionModel,
				schema: z.object({
					summary: z.string().describe('3-4 dense paragraphs summarizing outcomes, key variables (paths/IDs/names), and user tone/persona preferences from the old history. Will be prepended to the active chat buffer as SESSION BACKSTORY.'),
					sessionName: z.string().describe('A short, descriptive name for the session.'),
					memoryUpdate: z.string().describe('Full replacement content for MEMORY.md: ## Last Session (2-3 sentence narrative), ## Lessons Learned (bullets), ## Pending (bullets).'),
					userUpdate: z.string().describe('Full replacement content for USER.md if genuinely new personal facts were learned. Empty string if nothing new.'),
					projectReadmeUpdate: z.string().describe('Technical summary of the project worked on in this session (architecture, components, conventions, current state), including a default "## Todo List" section. If no todos are known, include a placeholder like "- put todos here". Empty string if no project work was discussed.'),
					insights: z.array(z.object({
						filename: z.enum(['IDENTITY.md']).describe('The persona file to append a new insight to.'),
						content: z.string().describe('The new insight to append.')
					})).describe('Genuinely new AI behavior/personality insights to append to IDENTITY.md. Leave empty if nothing new was learned.')
				}),
				system: compactionPrompt,
				prompt: 'Summarize the OLD HISTORY section in the system prompt into the required structured object.',
				headers: {
					'X-Title': 'Tamias (from-compacting)',
					'X-Tamias-Source': 'from-compacting',
				},
				...(compProviderOpts ? { providerOptions: compProviderOpts } : {}),
			})

			logAiRequest({
				timestamp: new Date().toISOString(),
				sessionId: session.id,
				model: session.model,
				provider: session.connectionNickname,
				action: 'compact',
				durationMs: Date.now() - startTime,
				tokens: {
					prompt: usage?.inputTokens,
					completion: usage?.outputTokens,
					total: usage?.totalTokens,
				},
				messages: [
					{ role: 'system', content: compactionPrompt },
					{ role: 'user', content: `Current history to compact:\n${JSON.stringify(session.messages)}` }
				],
				response: JSON.stringify(object),
			})

			session.summary = object.summary
			if (object.sessionName && (!session.name || session.name.startsWith('sess_'))) {
				session.name = object.sessionName
			}
			// Append a one-liner to today's raw daily log (feeds the nightly digest)
			const sessionLabel = session.name || session.id
			const oneLiner = object.summary.split(/[.\n]/)[0].trim()
			appendDailyLog(`- **${sessionLabel}**: ${oneLiner}.`)
			// Rewrite MEMORY.md entirely with the merged content
			if (object.memoryUpdate?.trim()) {
				writePersonaFile('MEMORY.md', object.memoryUpdate.trim() + '\n')
			}
			// Rewrite USER.md entirely if new personal facts were discovered
			if (object.userUpdate?.trim()) {
				writePersonaFile('USER.md', object.userUpdate.trim() + '\n')
			}
			// Only append genuinely new identity/preference insights, dated
			if (object.insights && object.insights.length > 0) {
				const insightsRecord: Record<string, string> = {}
				for (const item of object.insights) {
					insightsRecord[item.filename] = item.content
				}
				updatePersonaFiles(insightsRecord, today)
			}
			// Write PROJECT-README.md if project context was updated
			if (object.projectReadmeUpdate?.trim() && session.projectSlug) {
				try {
					const { getProjectDir } = await import('../utils/projects')
					const projectDir = getProjectDir(session.projectSlug)
					const readmePath = join(projectDir, 'PROJECT-README.md')
					if (existsSync(projectDir)) {
						let projectReadmeContent = object.projectReadmeUpdate.trim()
						if (!/\n##\s+Todo List\b/i.test(`\n${projectReadmeContent}`)) {
							projectReadmeContent += '\n\n## Todo List\n\n- put todos here'
						} else {
							projectReadmeContent = projectReadmeContent.replace(
								/(\n##\s+Todo List\s*\n)(?=\s*(?:##\s+|$))/i,
								'$1\n- put todos here\n'
							)
						}
						writeFileSync(readmePath, projectReadmeContent.trim() + '\n', 'utf-8')
					}
				} catch (err) {
					console.error('[Compaction] Failed to write PROJECT-README.md:', err)
				}
			}
			// Apply the pre-computed trim: keep only the recent messages, drop the compacted portion
			session.messages = messagesToKeep as any

			// ── Auto-index compaction artifacts into vector store ──────────────
			try {
				const { getVectorStoreConfig } = await import('../utils/config')
				const vectorCfg = getVectorStoreConfig()
				if (vectorCfg.enabled && vectorCfg.autoIndexCompaction) {
					const { getVectorStore } = await import('../utils/vectors')
					const vectorStore = await getVectorStore()
					const sessionTag = session.name || session.id

					// Index the compaction summary
					if (object.summary?.trim()) {
						await vectorStore.upsert(
							object.summary.trim(),
							'compaction',
							['summary', sessionTag]
						)
					}

					// Index individual insights
					if (object.insights && object.insights.length > 0) {
						for (const insight of object.insights) {
							if (insight.content?.trim()) {
								await vectorStore.upsert(
									insight.content.trim(),
									'insight',
									['insight', sessionTag]
								)
							}
						}
					}

					console.log(`[AIService] Auto-indexed compaction artifacts into vector store for session '${sessionTag}'.`)
				}
			} catch (vecErr) {
				// Vector store failures must never break compaction
				console.warn('[AIService] Failed to auto-index compaction into vector store:', vecErr)
			}
		} catch (err) {
			console.error('Failed to compact session:', err)
		}
	}

	private toPersist(session: Session): SessionPersist {
		return {
			id: session.id,
			name: session.name,
			createdAt: session.createdAt.toISOString(),
			updatedAt: session.updatedAt.toISOString(),
			model: session.model,
			summary: session.summary,
			channelId: session.channelId,
			channelUserId: session.channelUserId,
			messages: session.messages,
			parentSessionId: session.parentSessionId,
			isSubagent: session.isSubagent,
		} as any
	}

	public async shutdown() {
		for (const client of this.mcpClients) await client.close().catch((err) => console.error('[AIService] Failed to close MCP client during shutdown:', err))
	}
}
