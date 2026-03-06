import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import { loadCronJobs, addCronJob, removeCronJob, updateCronJob, CronDeliverySchema } from '../utils/cronStore.ts'

export const CRON_TOOL_NAME = 'cron'
export const CRON_TOOL_LABEL = '⏰ Cron (manage recurring tasks and heartbeats)'

export function createCronTools(aiService: AIService, sessionId: string) {
	/**
	 * Derives the delivery target from the current session's bridge context.
	 */
	function deliveryFromSession(): z.infer<typeof CronDeliverySchema> | undefined {
		const session = aiService.getSession(sessionId)
		if (!session) return undefined
		if (!session.channelId || session.channelId.startsWith('terminal')) return undefined
		if (!session.channelUserId) return undefined
		const bridge = aiService.getBridgeManager().getBridgeByName(session.channelId)
		if (!bridge) return undefined
		return {
			platform: bridge.platform,
			platformAccountId: bridge.platformAccountId,
			channelId: session.channelUserId,
			channelName: session.channelName,
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
			description: 'Schedule a new recurring task. Use 5-field cron expressions for precise timing (e.g. "0 9-17 * * 1-5" for hourly Mon-Fri 9am-5pm). Delivery is auto-detected from the current channel. Set skills to activate specific capabilities.',
			inputSchema: z.object({
				name: z.string().describe('Descriptive name for the job'),
				schedule: z.string().describe('Schedule: cron expression like "0 9 * * 1-5" or interval like "30m", "1h"'),
				type: z.enum(['ai', 'message']).optional().default('ai').describe('"ai" = send prompt to AI; "message" = send text directly'),
				prompt: z.string().describe('Instructions for the agent (type=ai) or message text (type=message)'),
				skills: z.array(z.string()).optional().describe('Skill slugs to activate (e.g. ["researcher", "writer"])'),
				sessionKey: z.string().optional().describe('Stable session key for interactive workflows — enables user to reply and continue in same context'),
				context: z.string().optional().describe('Extra context injected before the prompt (e.g. file paths, project info)'),
				delivery: CronDeliverySchema.optional().describe('Structured delivery target — auto-filled from current session if omitted'),
			}),
			execute: async (input) => {
				try {
					const delivery = input.delivery ?? deliveryFromSession()
					const job = addCronJob({
						name: input.name,
						schedule: input.schedule,
						type: input.type ?? 'ai',
						prompt: input.prompt,
						skills: input.skills,
						sessionKey: input.sessionKey,
						context: input.context,
						delivery,
						target: 'last',
					})
					return {
						success: true,
						job,
						note: delivery
							? `Delivery set: platform=${delivery.platform}, channelId=${delivery.channelId}${delivery.emailTo ? `, email=${delivery.emailTo}` : ''}`
							: 'No bridge context — job will use the last-active session as fallback',
						reminder: 'Run `tamias cron install` to enable the system crontab for automatic execution.',
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
					type: z.enum(['ai', 'message']).optional(),
					skills: z.array(z.string()).optional(),
					sessionKey: z.string().optional(),
					context: z.string().optional(),
					delivery: CronDeliverySchema.optional().describe('Structured delivery target'),
					target: z.string().optional().describe('Legacy target string'),
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
