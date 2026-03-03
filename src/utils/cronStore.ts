import { z } from 'zod'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
// crypto is available in global scope in Bun / Node 19+

/**
 * Structured delivery target for a cron job.
 *
 * `bridgeName` is the full registered bridge key (e.g. "discord:main", "terminal:main").
 * This must exactly match the key in `activeBridges` inside BridgeManager — it is
 * used verbatim as `session.channelId` so dispatchEvent can find the bridge.
 *
 * `channelId` is the platform-level recipient (Discord channel ID, Telegram chat ID,
 * WhatsApp group JID, etc.). Leave undefined for bridges that don't need it (terminal).
 */
export const CronDeliverySchema = z.object({
	bridgeName: z.string().describe('Full bridge key e.g. "discord:main", "terminal:main"'),
	channelId: z.string().optional().describe('Platform channel/chat/group ID'),
})

export type CronDelivery = z.infer<typeof CronDeliverySchema>

export const CronJobSchema = z.object({
	id: z.string(),
	name: z.string(),
	schedule: z.string(), // "30m", "1h", or cron expression
	/**
	 * 'ai'      – send prompt to AI, deliver generated response to target channel
	 * 'message' – send the prompt text directly to the target channel, no AI involved
	 */
	type: z.enum(['ai', 'message']).default('ai'),
	prompt: z.string(),
	/**
	 * Structured delivery target. When present, `bridgeName` is used directly as
	 * the session channelId so BridgeManager.dispatchEvent can find the right bridge.
	 * Preferred over the legacy `target` string.
	 */
	delivery: CronDeliverySchema.optional(),
	/**
	 * @deprecated Use `delivery` instead. Kept for backward compatibility with
	 * existing cron.json files. Migrated to `delivery` on load via migrateLegacyTarget().
	 */
	target: z.string().optional().default('last'),
	enabled: z.boolean().default(true),
	lastRun: z.string().datetime().optional(),
	lastStatus: z.enum(['success', 'error']).optional(),
	lastError: z.string().optional(),
	createdAt: z.string().datetime(),
})

export type CronJob = z.infer<typeof CronJobSchema>

const getCronPath = () => {
	const dir = join(homedir(), '.tamias')
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
	return join(dir, 'cron.json')
}

/**
 * Converts a legacy `target` string to the structured `delivery` format.
 *
 * Legacy formats:
 *   "last"                    → no delivery object (use 'last' logic)
 *   "discord:channelId"       → { bridgeName: "discord:main", channelId: "channelId" }
 *   "terminal:channelUserId"  → { bridgeName: "terminal:main", channelId: "channelUserId" }
 *
 * The old target format split on ':' giving only the platform name (e.g. "discord")
 * as channelId, which never matched any bridge. This migration uses a sensible default
 * instance key of "main" when one cannot be determined from the string alone.
 */
export function migrateLegacyTarget(job: CronJob): CronJob {
	if (job.delivery) return job // already migrated
	if (!job.target || job.target === 'last') return job // 'last' stays as-is

	if (job.target.includes(':')) {
		const colonIdx = job.target.indexOf(':')
		const platform = job.target.slice(0, colonIdx)
		const channelId = job.target.slice(colonIdx + 1) || undefined
		return {
			...job,
			delivery: {
				bridgeName: `${platform}:main`,
				channelId,
			},
		}
	}

	return job
}

export const loadCronJobs = (): CronJob[] => {
	const path = getCronPath()
	if (!existsSync(path)) {
		return []
	}

	try {
		const rawData = JSON.parse(readFileSync(path, 'utf-8'))
		if (!Array.isArray(rawData)) {
			console.error('Cron configuration file root must be an array')
			return []
		}

		const validJobs: CronJob[] = []
		for (const [index, entry] of rawData.entries()) {
			const parsed = CronJobSchema.safeParse(entry)
			if (parsed.success) {
				validJobs.push(migrateLegacyTarget(parsed.data))
			} else {
				console.warn(`Skipping invalid cron job at index ${index}:`, parsed.error.issues)
			}
		}

		return validJobs
	} catch (err) {
		console.error('Cron configuration file is invalid or missing:', err)
		return []
	}
}

export const saveCronJobs = (jobs: CronJob[]): void => {
	const path = getCronPath()
	const validated = z.array(CronJobSchema).parse(jobs)
	writeFileSync(path, JSON.stringify(validated, null, 2), 'utf-8')
}

export const addCronJob = (job: Omit<CronJob, 'id' | 'createdAt' | 'enabled'>): CronJob => {
	const jobs = loadCronJobs()
	const newJob: CronJob = {
		...job,
		id: crypto.randomUUID(),
		enabled: true,
		createdAt: new Date().toISOString(),
	}
	jobs.push(newJob)
	saveCronJobs(jobs)
	return newJob
}

export const updateCronJob = (id: string, updates: Partial<Omit<CronJob, 'id' | 'createdAt'>>): CronJob => {
	const jobs = loadCronJobs()
	const index = jobs.findIndex(j => j.id === id)
	if (index === -1) throw new Error(`Cron job with ID '${id}' not found.`)

	jobs[index] = { ...jobs[index], ...updates }
	saveCronJobs(jobs)
	return jobs[index]
}

export const recordCronJobRun = (
	id: string,
	result: { status: 'success' | 'error'; error?: string }
): CronJob => {
	return updateCronJob(id, {
		lastRun: new Date().toISOString(),
		lastStatus: result.status,
		lastError: result.status === 'error' ? result.error ?? 'Unknown cron execution error' : undefined,
	})
}

export const removeCronJob = (id: string): void => {
	const jobs = loadCronJobs()
	const filtered = jobs.filter(j => j.id !== id)
	if (filtered.length === jobs.length) throw new Error(`Cron job with ID '${id}' not found.`)
	saveCronJobs(filtered)
}

export const getCronJob = (id: string): CronJob | undefined => {
	const jobs = loadCronJobs()
	return jobs.find(j => j.id === id)
}

export const DEFAULT_HEARTBEAT_CONFIG = {
	name: 'Default Heartbeat',
	schedule: '30m',
	prompt: 'Check your periodic tasks and instructions in ~/.tamias/memory/HEARTBEAT.md. If there are pending items or checks requested there, perform them now. If nothing needs your attention, reply with HEARTBEAT_OK.',
	target: 'last'
}
