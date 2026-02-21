import { tool } from 'ai'
import { z } from 'zod'
import { loadCronJobs, addCronJob, removeCronJob, updateCronJob } from '../utils/cronStore.ts'

export const CRON_TOOL_NAME = 'cron'
export const CRON_TOOL_LABEL = '⏰ Cron (manage recurring tasks and heartbeats)'

export const cronTools = {
	cron_list: tool({
		description: 'List all active cron jobs and scheduled heartbeats.',
		inputSchema: z.object({}),
		execute: async () => {
			const jobs = loadCronJobs()
			return { success: true, jobs }
		},
	}),

	cron_add: tool({
		description: 'Schedule a new recurring task or one-off reminder. Use intervals like "30m", "1h", "1d" or a 5-field cron expression.',
		inputSchema: z.object({
			name: z.string().describe('Descriptive name for the job'),
			schedule: z.string().describe('Schedule: e.g., "5m", "1h", or "* * * * *"'),
			prompt: z.string().describe('Instructions for the agent to follow when triggered'),
			target: z.string().optional().describe('Output target (e.g., "discord:channel-id" or "last")'),
		}),
		execute: async (input) => {
			try {
				const job = addCronJob({
					name: input.name,
					schedule: input.schedule,
					prompt: input.prompt,
					target: input.target || 'last',
				})
				return { success: true, job }
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
				target: z.string().optional(),
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
