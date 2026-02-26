import { tool } from 'ai'
import { z } from 'zod'
import { AIService } from '../services/aiService'
import { loadAgents } from '../utils/agentsStore.ts'

export const SUBAGENT_TOOL_NAME = 'subagent'
export const SUBAGENT_TOOL_LABEL = '🧠 Sub-agent (spawn specialized agents)'

export const createSubagentTools = (aiService: AIService, sessionId: string) => ({
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
			})

			const fullPrompt = finalInstructions
				? `Task: ${task}\n\nContext/Instructions: ${finalInstructions}`
				: task

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
})
