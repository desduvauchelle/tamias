/**
 * Agents AI Tool Module
 *
 * TWO sources of tools:
 * 1. Registry-backed CRUD (from core/domains/agents.ts via buildToolsForDomain):
 *    create, update, remove, list, show — auto-wired by toolRegistry.ts
 * 2. Manual agent-ops tools (createAgentOpsTools factory): 9 tools
 *    consolidated from subagent.ts, swarm.ts, session.ts, and tamias.ts.
 */
import { tool } from 'ai'
import { z } from 'zod'
import { buildToolsForDomain } from '../core/adapters/ai-tools.ts'
import type { AIService, Session } from '../services/aiService.ts'
import type { DaemonEvent } from '../bridge/types.ts'
import { loadAgents, findAgent } from '../utils/agentsStore.ts'
import { getWorkspacePath } from '../utils/config.ts'
import { isDaemonRunning, getDaemonUrl } from '../utils/daemon.ts'

export const AGENTS_TOOL_NAME = 'agents'
export const AGENTS_TOOL_LABEL = '🤖 Agents (personas, sub-agents, handoffs, sessions)'

/**
 * Registry-backed CRUD tools (backward compatibility shim).
 * toolRegistry.ts auto-wires these via getDomains(), but this function
 * remains for any direct usage.
 */
export function createAgentsTools() {
	return buildToolsForDomain('agents')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toThreadSuccess(session: Session) {
	return {
		success: true,
		threadId: session.id,
		streamPath: `/session/${session.id}/stream`,
		queue: {
			length: session.queue.length,
			processing: session.processing,
		},
	}
}

// ── Manual agent-ops tools ───────────────────────────────────────────────────

/**
 * Manual agent-related tools (not registry-backed).
 * These are merged with the registry-backed CRUD tools in toolRegistry.ts.
 */
export function createAgentOpsTools(aiService: AIService, sessionId: string) {
	return {

		// ── From subagent.ts ─────────────────────────────────────────────────

		spawn: tool({
			description: 'Spawn a sub-agent to handle a specific sub-task. You can optionally specify an agentId to use a pre-defined persona.',
			inputSchema: z.object({
				task: z.string().describe('The task description for the sub-agent.'),
				agentId: z.string().optional().describe('Optional ID of a pre-registered agent to use (e.g. "agent_researcher").'),
				model: z.string().optional().describe('Optional model override.'),
				instructions: z.string().optional().describe('Specific instructions or context.')
			}),
			execute: async ({ task, agentId, model, instructions }: { task: string; agentId?: string; model?: string; instructions?: string }) => {
				const parentSession = aiService.getSession(sessionId)
				if (!parentSession) {
					return { success: false, error: 'Parent session not found' }
				}

				let finalModel = model || parentSession.model
				let finalInstructions = instructions || ''

				if (agentId) {
					const agents = loadAgents()
					const agent = agents.find(a => a.id === agentId || a.slug === agentId.toLowerCase() || a.name.toLowerCase() === agentId.toLowerCase())
					if (agent) {
						if (agent.model) finalModel = agent.model
						// Persona files in agentDir handle instructions; only append extra instructions if supplied
					}
				}

				const subSession = aiService.createSession({
					model: finalModel,
					channelId: parentSession.channelId,
					channelUserId: parentSession.channelUserId,
					channelName: parentSession.channelName,
					parentSessionId: sessionId,
					isSubagent: true,
					task,
					agentId,
					projectSlug: parentSession.projectSlug,
				})

				// Include workspace context so the sub-agent knows where to operate
				const workspacePath = getWorkspacePath()
				let workspaceHint = `\n\nWorkspace: ${workspacePath}`
				if (parentSession.projectSlug) {
					try {
						const { getProject } = await import('../utils/projects')
						const project = getProject(parentSession.projectSlug)
						if (project?.workspacePath) {
							workspaceHint = `\n\nActive Project: ${project.name} (${parentSession.projectSlug})\nProject Workspace: ${project.workspacePath}\nAll file operations should target this project folder.`
						}
					} catch { /* projects module may not exist */ }
				}

				const fullPrompt = finalInstructions
					? `Task: ${task}\n\nContext/Instructions: ${finalInstructions}${workspaceHint}`
					: `${task}${workspaceHint}`

				await aiService.enqueueMessage(subSession.id, fullPrompt)

				const label = subSession.taskSlug
					? `[${subSession.taskSlug} / ${subSession.id}]`
					: subSession.id
				return {
					success: true,
					message: `Sub-agent ${label} spawned. Result will be posted back here when done.`
				}
			}
		}),

		callback: tool({
			description: 'Report the final outcome of your task back to the parent agent. Use this when you have finished your work or if you encountered a terminal failure.',
			inputSchema: z.object({
				task: z.string().describe('The task you were assigned.'),
				status: z.enum(['completed', 'failed']).describe('Whether you succeeded or failed.'),
				reason: z.string().optional().describe('Brief reason, especially useful if failed.'),
				outcome: z.string().optional().describe('Clear summary of what was achieved or discovered.'),
				context: z.any().optional().describe('Optional structured data (JSON) to pass back as context.')
			}),
			execute: async ({ task, status, reason, outcome, context }) => {
				const session = aiService.getSession(sessionId)
				if (!session?.isSubagent || !session.parentSessionId) {
					return { success: false, error: 'The callback tool can only be used by sub-agents to report to their parent.' }
				}

				// Mark that the sub-agent used the explicit callback so processSession
				// doesn't double-inject a fallback report
				aiService.markSubagentCallbackCalled(sessionId)

				await aiService.reportSubagentResult(sessionId, { task, status, reason, outcome, context })

				return {
					success: true,
					message: 'Report sent to parent agent. You should now stop and let the parent continue.'
				}
			}
		}),

		progress: tool({
			description: 'Send an intermediate progress update back to the user on the originating channel (Discord/Telegram). Use this for long-running tasks so the user knows you are still working.',
			inputSchema: z.object({
				message: z.string().describe('A brief status update, e.g. "Found 3 relevant files, now reading them…"'),
			}),
			execute: async ({ message }) => {
				const session = aiService.getSession(sessionId)
				if (!session?.isSubagent) {
					return { success: false, error: 'The progress tool can only be used by sub-agents.' }
				}

				aiService.updateSubagentProgress(sessionId, message)

				return {
					success: true,
					message: 'Progress update sent.',
				}
			}
		}),

		// ── From swarm.ts ────────────────────────────────────────────────────

		transfer: tool({
			description: 'Transfer the current conversation to a different named agent. The new agent will take over this channel session with full context. The user will be notified of the handoff. Use this when the current task is better suited for a specialized agent.',
			inputSchema: z.object({
				agentSlug: z.string().describe('The slug or name of the agent to hand off to (e.g., "researcher", "coder")'),
				reason: z.string().describe('Why you are transferring — this is shown to the user so make it clear and helpful'),
				context: z.string().optional().describe('Optional summary of the conversation so far to give the receiving agent full context'),
			}),
			execute: async ({ agentSlug, reason, context }: { agentSlug: string; reason: string; context?: string }) => {
				const session = aiService.getSession(sessionId)
				if (!session) {
					return { success: false, error: 'Session not found' }
				}

				const targetAgent = findAgent(agentSlug)
				if (!targetAgent) {
					const available = loadAgents().filter(a => a.enabled).map(a => `${a.slug} (${a.name})`).join(', ')
					return {
						success: false,
						error: `Agent "${agentSlug}" not found. Available agents: ${available || 'none'}`
					}
				}

				if (!targetAgent.enabled) {
					return { success: false, error: `Agent "${targetAgent.name}" is currently disabled.` }
				}

				try {
					await aiService.handoffSession(sessionId, targetAgent.id, reason, context)
					return {
						success: true,
						message: `Conversation handed off to **${targetAgent.name}** (${targetAgent.slug}). Reason: ${reason}`
					}
				} catch (err: unknown) {
					return { success: false, error: (err as Error).message }
				}
			}
		}),

		// ── From session.ts ──────────────────────────────────────────────────

		create_thread: tool({
			description: 'Create a new thread/session, optionally overriding model/channel and enqueueing an initial message.',
			inputSchema: z.object({
				model: z.string().optional().describe('Optional model override, e.g. "openai/gpt-4o" or "nickname/modelId".'),
				channelId: z.string().optional().describe('Optional channel override (defaults to current session channel when available).'),
				channelUserId: z.string().optional().describe('Optional channel user identifier override.'),
				channelName: z.string().optional().describe('Optional channel display name override.'),
				initialMessage: z.string().optional().describe('Optional first message to enqueue immediately in the new thread.'),
			}),
			execute: async ({ model, channelId, channelUserId, channelName, initialMessage }) => {
				const current = aiService.getSession(sessionId)

				const created = aiService.createSession({
					model,
					channelId: channelId ?? current?.channelId,
					channelUserId: channelUserId ?? current?.channelUserId,
					channelName: channelName ?? current?.channelName,
				})

				if (initialMessage && initialMessage.trim()) {
					try {
						await aiService.enqueueMessage(created.id, initialMessage)
					} catch (err) {
						return { success: false, error: err instanceof Error ? err.message : String(err) }
					}
				}

				return {
					...toThreadSuccess(created),
					created: true,
					enqueued: !!(initialMessage && initialMessage.trim()),
				}
			},
		}),

		send_message: tool({
			description: 'Enqueue a message to a target thread/session. Accepts threadId or sessionId; defaults to current session.',
			inputSchema: z.object({
				threadId: z.string().optional().describe('Target thread identifier (alias of sessionId).'),
				sessionId: z.string().optional().describe('Target session identifier (alias of threadId).'),
				message: z.string().describe('Message content to enqueue.'),
				authorName: z.string().optional().describe('Optional author prefix.'),
			}),
			execute: async ({ threadId, sessionId: targetSessionId, message, authorName }) => {
				const resolvedThreadId = threadId ?? targetSessionId ?? sessionId
				const target = aiService.getSession(resolvedThreadId)

				if (!target) {
					return { success: false, error: `Session '${resolvedThreadId}' not found.` }
				}

				try {
					await aiService.enqueueMessage(target.id, message, authorName)
				} catch (err) {
					return { success: false, error: err instanceof Error ? err.message : String(err) }
				}

				return {
					...toThreadSuccess(target),
					enqueued: true,
				}
			},
		}),

		// ── From tamias.ts ───────────────────────────────────────────────────

		list_active: tool({
			description: 'List all currently active sub-agents and named-agent sessions, showing their task slug, status, progress, and elapsed time.',
			inputSchema: z.object({}),
			execute: async () => {
				const all = aiService.getAllSessions()
				const now = Date.now()
				const subagents = all
					.filter(s => s.isSubagent && s.subagentStatus !== 'completed' && s.subagentStatus !== 'failed')
					.map(s => ({
						sessionId: s.id,
						taskSlug: s.taskSlug ?? null,
						task: s.task ? s.task.split('\n')[0].slice(0, 100) : null,
						status: s.subagentStatus ?? 'unknown',
						progress: s.progress ?? null,
						elapsedSeconds: s.spawnedAt ? Math.round((now - s.spawnedAt.getTime()) / 1000) : null,
					}))
				return { subagents, count: subagents.length }
			},
		}),

		list_sessions: tool({
			description: 'List all active chat sessions on the running daemon.',
			inputSchema: z.object({}),
			execute: async () => {
				const running = await isDaemonRunning()
				if (!running) return { success: false, error: 'Daemon is not running.' }
				const res = await fetch(`${getDaemonUrl()}/sessions`)
				const sessions = await res.json()
				return { success: true, sessions }
			},
		}),

		send_progress_update: tool({
			description: 'Send an interim progress update to the user during a multi-step task. On Discord this creates/posts to a thread so the user can follow along without flooding the main channel. Use this after completing each significant step of a complex task.',
			inputSchema: z.object({
				title: z.string().describe('A short title for the overall task (e.g. "Deploying backend"). This becomes the thread name on Discord.'),
				message: z.string().describe('A brief progress update (e.g. "Step 2/5 done: database migrated successfully").'),
				step: z.number().optional().describe('Current step number (1-based).'),
				totalSteps: z.number().optional().describe('Total number of steps in the task.'),
			}),
			execute: async ({ title, message, step, totalSteps }) => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }
				session.emitter.emit('event', {
					type: 'progress-update',
					title,
					message,
					step,
					totalSteps,
				} as DaemonEvent)
				return { success: true, message: 'Progress update sent.' }
			},
		}),
	}
}
