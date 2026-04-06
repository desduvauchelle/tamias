import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import { loadCronJobs, addCronJob, removeCronJob, updateCronJob, CronDeliverySchema } from '../utils/cronStore.ts'

export const CRON_TOOL_NAME = 'cron'
export const CRON_TOOL_LABEL = '⏰ Cron (manage recurring tasks and heartbeats)'

/**
 * Parses natural-language or ISO datetime input into an ISO 8601 datetime string.
 *
 * Supports:
 * - ISO datetime strings: "2026-04-06T09:00:00.000Z" → pass-through
 * - Relative: "in N minutes|hours|days" → now + offset
 * - "tomorrow at HH:MM" → next day at that time (local timezone)
 * - "YYYY-MM-DD HH:MM" or "YYYY-MM-DD" → parsed as local time
 */
export function parseRunAtInput(raw: string): string {
	const s = raw.trim()

	// Try ISO datetime first (or any unambiguous date string)
	const direct = new Date(s)
	if (!isNaN(direct.getTime()) && s.includes('T') && s.includes('Z')) {
		return direct.toISOString()
	}

	// "in N minutes|hours|days"
	const relMatch = s.match(/^in\s+(\d+)\s+(second|seconds|minute|minutes|hour|hours|day|days)$/i)
	if (relMatch) {
		const n = parseInt(relMatch[1])
		const unit = relMatch[2].toLowerCase()
		let ms = 0
		if (unit.startsWith('second')) ms = n * 1000
		else if (unit.startsWith('minute')) ms = n * 60_000
		else if (unit.startsWith('hour')) ms = n * 3_600_000
		else if (unit.startsWith('day')) ms = n * 86_400_000
		return new Date(Date.now() + ms).toISOString()
	}

	// "tomorrow at HH:MM"
	const tomorrowMatch = s.match(/^tomorrow\s+at\s+(\d{1,2}):(\d{2})$/i)
	if (tomorrowMatch) {
		const h = parseInt(tomorrowMatch[1])
		const m = parseInt(tomorrowMatch[2])
		const d = new Date()
		d.setDate(d.getDate() + 1)
		d.setHours(h, m, 0, 0)
		return d.toISOString()
	}

	// "YYYY-MM-DD HH:MM" or "YYYY-MM-DD"
	const dateMatch = s.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/)
	if (dateMatch) {
		const base = new Date(dateMatch[1] + 'T00:00:00')
		if (!isNaN(base.getTime())) {
			if (dateMatch[2]) {
				base.setHours(parseInt(dateMatch[2]), parseInt(dateMatch[3]), 0, 0)
			}
			return base.toISOString()
		}
	}

	throw new Error(`Cannot parse "${raw}" as a date/time. Use ISO format (e.g. "2026-04-06T09:00:00.000Z"), "in 2 hours", "tomorrow at 9:00", or "2026-04-06 09:00".`)
}

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
			description: 'Schedule a task — recurring or one-time. For recurring use a cron expression ("0 9 * * 1-5") or interval ("30m"). For a one-off reminder set runAt with an ISO datetime or natural language like "tomorrow at 9:00" or "in 2 hours". Delivery is auto-detected from the current channel.',
			inputSchema: z.object({
				name: z.string().describe('Descriptive name for the job'),
				schedule: z.string().optional().describe('Recurring: cron expression like "0 9 * * 1-5" or interval like "30m", "1h"'),
				runAt: z.string().optional().describe('One-shot: ISO datetime OR natural language like "tomorrow at 9:00", "in 2 hours", "2026-04-06 14:30"'),
				type: z.enum(['ai', 'message']).optional().default('ai').describe('"ai" = send prompt to AI; "message" = send text directly'),
				prompt: z.string().describe('Instructions for the agent (type=ai) or message text (type=message)'),
				skills: z.array(z.string()).optional().describe('Skill slugs to activate (e.g. ["researcher", "writer"])'),
				sessionKey: z.string().optional().describe('Stable session key for interactive workflows — enables user to reply and continue in same context'),
				context: z.string().optional().describe('Extra context injected before the prompt (e.g. file paths, project info)'),
				delivery: CronDeliverySchema.optional().describe('Structured delivery target — auto-filled from current session if omitted'),
			}),
			execute: async (input) => {
				try {
					if (!input.schedule && !input.runAt) {
						return { success: false, error: 'Either schedule (recurring) or runAt (one-shot) is required.' }
					}
					if (input.schedule && input.runAt) {
						return { success: false, error: 'Cannot set both schedule and runAt. Use one or the other.' }
					}

					let resolvedRunAt: string | undefined
					if (input.runAt) {
						try {
							resolvedRunAt = parseRunAtInput(input.runAt)
						} catch (err) {
							return { success: false, error: String(err) }
						}
					}

					const delivery = input.delivery ?? deliveryFromSession()
					const job = addCronJob({
						name: input.name,
						...(resolvedRunAt ? { runAt: resolvedRunAt } : { schedule: input.schedule! }),
						type: input.type ?? 'ai',
						prompt: input.prompt,
						skills: input.skills,
						sessionKey: input.sessionKey,
						context: input.context,
						delivery,
						target: 'last',
					})
					const schedDesc = job.runAt ? `one-time at ${job.runAt}` : `recurring ${job.schedule}`
					return {
						success: true,
						job,
						note: delivery
							? `Delivery set: platform=${delivery.platform}, channelId=${delivery.channelId}${delivery.emailTo ? `, email=${delivery.emailTo}` : ''}`
							: 'No bridge context — job will use the last-active session as fallback',
						scheduleType: job.runAt ? 'one-shot (auto-deletes after firing)' : 'recurring',
						scheduleDescription: schedDesc,
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
					runAt: z.string().optional().describe('One-shot datetime (ISO or natural language); clears schedule'),
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
					const resolvedUpdates = { ...updates }
					if (updates.runAt) {
						try {
							resolvedUpdates.runAt = parseRunAtInput(updates.runAt)
							resolvedUpdates.schedule = undefined
						} catch (err) {
							return { success: false, error: String(err) }
						}
					}
					const job = updateCronJob(id, resolvedUpdates)
					return { success: true, job }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),
	}
}
