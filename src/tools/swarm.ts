import { tool } from 'ai'
import { z } from 'zod'
import { AIService } from '../services/aiService.ts'
import { loadAgents, findAgent } from '../utils/agentsStore.ts'

export const SWARM_TOOL_NAME = 'swarm'
export const SWARM_TOOL_LABEL = '🐝 Swarm (multi-agent handoffs)'

export const createSwarmTools = (aiService: AIService, sessionId: string) => ({

	transfer_to_agent: tool({
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

	list_agents: tool({
		description: 'List all available named agents that you can hand off conversations to.',
		inputSchema: z.object({}),
		execute: async () => {
			const agents = loadAgents().filter(a => a.enabled)
			if (agents.length === 0) {
				return { success: true, agents: [], message: 'No named agents configured. Create one with `tamias agents add`.' }
			}
			return {
				success: true,
				agents: agents.map(a => ({
					id: a.id,
					slug: a.slug,
					name: a.name,
					model: a.model || 'default',
					instructions: a.instructions.slice(0, 100) + (a.instructions.length > 100 ? '...' : ''),
				}))
			}
		}
	}),
})
