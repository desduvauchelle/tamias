import { tool } from 'ai'
import { z } from 'zod'
import { AIService } from '../services/aiService'
import { loadAgents } from '../utils/agentsStore.ts'

export const SUBAGENT_TOOL_NAME = 'subagent'

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
				const agent = agents.find(a => a.id === agentId || a.name.toLowerCase() === agentId.toLowerCase())
				if (agent) {
					if (agent.model) finalModel = agent.model
					finalInstructions = `${agent.instructions}\n\n${finalInstructions}`.trim()
				}
			}

			const subSession = aiService.createSession({
				model: finalModel,
				channelId: parentSession.channelId,
				channelUserId: parentSession.channelUserId,
				channelName: parentSession.channelName,
				parentSessionId: sessionId,
				isSubagent: true
			})

			const fullPrompt = finalInstructions
				? `Task: ${task}\n\nContext/Instructions: ${finalInstructions}`
				: task

			await aiService.enqueueMessage(subSession.id, fullPrompt)

			return {
				success: true,
				message: `Sub-agent ${subSession.id} spawned. Result will be posted back here when done.`
			}
		}
	})
})
