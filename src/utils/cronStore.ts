import { z } from 'zod'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
// crypto is available in global scope in Bun / Node 19+

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
	target: z.string().optional().default('last'),
	enabled: z.boolean().default(true),
	lastRun: z.string().datetime().optional(),
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

export const loadCronJobs = (): CronJob[] => {
	const path = getCronPath()
	if (!existsSync(path)) {
		return []
	}

	try {
		const rawData = JSON.parse(readFileSync(path, 'utf-8'))
		return z.array(CronJobSchema).parse(rawData)
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
