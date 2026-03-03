import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import { loadCronJobs, addCronJob, removeCronJob, updateCronJob, CronDeliverySchema } from '../utils/cronStore.ts'

export const CRON_TOOL_NAME = 'cron'
export const CRON_TOOL_LABEL = '⏰ Cron (manage recurring tasks and heartbeats)'

export function createCronTools(aiService: AIService, sessionId: string) {
	/**
	 * Derives the delivery target from the current session so the AI doesn't
	 * need to ask the user for bridge/channel details — it already knows them
	 * from the conversation context (Discord channel, Telegram chat, etc.).
	 */
	function deliveryFromSession(): { bridgeName: string; channelId?: string } | undefined {
		const session = aiService.getSession(sessionId)
		if (!session) return undefined
		// Only auto-fill when the session came from a real bridge (not bare terminal)
		if (!session.channelId || session.channelId === 'terminal') return undefined
		return {
			bridgeName: session.channelId,      // e.g. "discord:main"
			channelId: session.channelUserId,  // e.g. the Discord channel ID
		}
	}

	return {
		cron_list: tool({
			description: 'List all active cron jobs and scheduled heartbeats.',
			inputSchema: z.object({}),
			execute: async () => {
				const jobs = loadCronJobs()
				return { success: true, jobs }
			},
		}),

		cron_add: tool({
			description: 'Schedule a new recurring task or one-off reminder. Use intervals like "30m", "1h", "1d" or a 5-field cron expression. Prefer specifying bridgeName + channelId over the legacy target string.',
			inputSchema: z.object({
				name: z.string().describe('Descriptive name for the job'),
				schedule: z.string().describe('Schedule: e.g., "5m", "1h", or "* * * * *"'),
				type: z.enum(['ai', 'message']).optional().default('ai').describe('"ai" = send prompt to AI and deliver response to channel; "message" = send text directly to channel without AI'),
				prompt: z.string().describe('Instructions for the agent (type=ai) or message text to send (type=message)'),
				bridgeName: z.string().optional().describe('Full bridge key as registered, e.g. "discord:main", "terminal:main". Preferred over target.'),
				channelId: z.string().optional().describe('Platform channel/chat ID (Discord channel ID, Telegram chat ID, etc.)'),
				target: z.string().optional().describe('Legacy target string, e.g. "last". Use bridgeName + channelId instead.'),
			}),
			execute: async (input) => {
				try {
					// Use explicitly provided bridgeName, or fall back to the current session's channel
					const delivery = input.bridgeName
						? { bridgeName: input.bridgeName, channelId: input.channelId }
						: deliveryFromSession()
					const job = addCronJob({
						name: input.name,
						schedule: input.schedule,
						type: input.type ?? 'ai',
						prompt: input.prompt,
						delivery,
						target: input.target ?? 'last',
					})
					return {
						success: true,
						job,
						note: delivery
							? `Delivery auto-set from current session: bridgeName=${delivery.bridgeName}, channelId=${delivery.channelId ?? '(none)'}`
							: 'No delivery target resolved — job will use legacy target field',
					}
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		cron_remove: tool({
			description: 'Remove/delete a cron job by its ID.',
			inputSchema: z.object({
				id: z.string().describe('The ID of the cron job to remove'),
			}),
			execute: async ({ id }) => {
				try {
					removeCronJob(id)
					return { success: true, message: `Job ${id} removed.` }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		cron_edit: tool({
			description: 'Update/edit an existing cron job.',
			inputSchema: z.object({
				id: z.string().describe('The ID of the cron job to update'),
				updates: z.object({
					name: z.string().optional(),
					schedule: z.string().optional(),
					prompt: z.string().optional(),
					delivery: CronDeliverySchema.optional().describe('Structured delivery target — preferred over target string'),
					target: z.string().optional().describe('Legacy target string — use delivery instead'),
					enabled: z.boolean().optional(),
				}),
			}),
			execute: async ({ id, updates }) => {
				try {
					const job = updateCronJob(id, updates)
					return { success: true, job }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),
	}
}
