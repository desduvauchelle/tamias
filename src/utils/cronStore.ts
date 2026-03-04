import { z } from 'zod'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
// crypto is available in global scope in Bun / Node 19+

/**
 * Structured delivery target for a cron job.
 *
 * Uses stable platform-assigned identifiers that survive config key renames:
 *
 * - `platform`          — constant platform type: "discord", "telegram", "whatsapp", etc.
 * - `platformAccountId` — the bot's own user ID as assigned by the platform (Snowflake,
 *                         Telegram bot ID, etc.). Never changes. Used to disambiguate when
 *                         multiple bot accounts are registered for the same platform.
 * - `channelId`         — the platform's channel/chat/group ID to deliver into.
 * - `channelName`       — human-readable name, informational only (not used for routing).
 *
 * At trigger time, BridgeManager.findBridgeByAccount(platform, platformAccountId) resolves
 * the live bridge instance — no config key name is stored in the job.
 */
export const CronDeliverySchema = z.object({
	platform: z.string().describe('Platform type: "discord", "telegram", "whatsapp", etc.'),
	platformAccountId: z.string().optional().describe("Bot's own user ID from the platform — stable identifier, never changes"),
	channelId: z.string().describe('Platform channel/chat/group ID'),
	channelName: z.string().optional().describe('Human-readable channel name — informational only, not used for routing'),
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
	 * Structured delivery target using stable platform identifiers.
	 * BridgeManager.findBridgeByAccount() resolves the live bridge at trigger time.
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
 * Migrates a raw (unparsed) cron entry's delivery/target fields before Zod validation.
 *
 * This runs on the raw JSON object before `CronJobSchema.safeParse()` so that
 * old-format entries (e.g. `delivery.bridgeName`) are converted to the current
 * `delivery.platform` format instead of being dropped by Zod.
 *
 * Mirrors the same logic as `migrateLegacyTarget` but operates on `unknown` data.
 */
export function migrateRawCronEntry(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
	const entry = raw as Record<string, unknown>
	const delivery = entry.delivery

	// Case 1: already has delivery.platform → pass through
	if (delivery && typeof delivery === 'object' && !Array.isArray(delivery)) {
		const d = delivery as Record<string, unknown>
		if (typeof d.platform === 'string') return entry

		// Case 2: old bridgeName delivery (v1)
		if (typeof d.bridgeName === 'string') {
			const platform = d.bridgeName.split(':')[0]
			return {
				...entry,
				delivery: {
					platform,
					// platformAccountId intentionally omitted — falls back to any bot on this platform
					channelId: typeof d.channelId === 'string' ? d.channelId : '',
				},
			}
		}

		// Case 3: delivery exists but unrecognisable — drop it, fall through to target
		const { delivery: _drop, ...rest } = entry
		return rest
	}

	// Case 4: legacy target string
	const target = entry.target
	if (!target || target === 'last') return entry

	if (typeof target === 'string' && target.includes(':')) {
		const colonIdx = target.indexOf(':')
		const platform = target.slice(0, colonIdx)
		const channelId = target.slice(colonIdx + 1) || ''
		return {
			...entry,
			delivery: { platform, channelId },
		}
	}

	return entry
}

/**
 * Migrates a cron job to the current stable-ID delivery format.
 *
 * Handles three cases in order:
 *
 * 1. **New format** — `delivery.platform` already present → pass-through unchanged.
 *
 * 2. **Old bridgeName delivery** — `delivery.bridgeName` exists (v1 format):
 *    Extract `platform` from the first colon-separated segment (e.g. "discord:main" → "discord").
 *    `platformAccountId` is intentionally omitted so `findBridgeByAccount` falls back to any
 *    bot on that platform, preserving backward compat.
 *
 * 3. **Legacy `target` string** — "discord:channelId" or "last":
 *    "last" stays as-is (no delivery). "platform:channelId" → `{ platform, channelId }`.
 */
export function migrateLegacyTarget(job: CronJob): CronJob {
	// Case 1: already in new stable-ID format
	if (job.delivery && 'platform' in job.delivery) return job

	// Case 2: old bridgeName-based delivery (v1)
	if (job.delivery && 'bridgeName' in (job.delivery as any)) {
		const oldDelivery = job.delivery as any
		const platform = (oldDelivery.bridgeName as string).split(':')[0]
		return {
			...job,
			delivery: {
				platform,
				// platformAccountId intentionally omitted — falls back to any bot on this platform
				channelId: oldDelivery.channelId ?? '',
			},
		}
	}

	// Case 3: legacy target string
	if (!job.target || job.target === 'last') return job // 'last' stays as-is

	if (job.target.includes(':')) {
		const colonIdx = job.target.indexOf(':')
		const platform = job.target.slice(0, colonIdx)
		const channelId = job.target.slice(colonIdx + 1) || ''
		return {
			...job,
			delivery: {
				platform,
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
			// Migrate legacy delivery formats BEFORE Zod validation so old entries
			// (e.g. { delivery: { bridgeName } }) aren't dropped by the new schema.
			const migrated = migrateRawCronEntry(entry)
			const parsed = CronJobSchema.safeParse(migrated)
			if (parsed.success) {
				validJobs.push(parsed.data)
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
