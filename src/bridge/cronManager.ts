import type { CronJob } from '../utils/cronStore'
import { loadCronJobs } from '../utils/cronStore'
import { Cron } from 'croner'

type SetIntervalFn = (callback: () => void, ms: number) => ReturnType<typeof setInterval>
type ClearIntervalFn = (id: ReturnType<typeof setInterval>) => void

export class CronManager {
	private timers: Map<string, ReturnType<typeof setInterval>> = new Map()
	private cronJobs: Map<string, Cron> = new Map()
	private refreshTimer: ReturnType<typeof setInterval> | undefined
	private onTrigger: (job: CronJob) => Promise<void>
	private loadJobs: () => CronJob[]
	private _setInterval: SetIntervalFn
	private _clearInterval: ClearIntervalFn

	constructor(
		onTrigger: (job: CronJob) => Promise<void>,
		loadJobs: () => CronJob[] = loadCronJobs,
		setIntervalFn: SetIntervalFn = setInterval,
		clearIntervalFn: ClearIntervalFn = clearInterval,
	) {
		this.onTrigger = onTrigger
		this.loadJobs = loadJobs
		this._setInterval = setIntervalFn
		this._clearInterval = clearIntervalFn
	}

	public start() {
		this.refresh()
		// Also poll for file changes every minute in case of manual edits or tool updates
		this.refreshTimer = this._setInterval(() => this.refresh(), 60000)
	}

	public refresh() {
		const jobs = this.loadJobs().filter(j => j.enabled)

		// Remove timers/crons for jobs no longer present or disabled
		const currentIds = new Array(...jobs.map(j => j.id))
		for (const id of this.timers.keys()) {
			if (!currentIds.includes(id)) {
				this._clearInterval(this.timers.get(id)!)
				this.timers.delete(id)
			}
		}
		for (const id of this.cronJobs.keys()) {
			if (!currentIds.includes(id)) {
				this.cronJobs.get(id)?.stop()
				this.cronJobs.delete(id)
			}
		}

		for (const job of jobs) {
			if (this.timers.has(job.id) || this.cronJobs.has(job.id)) continue

			if (this.isInterval(job.schedule)) {
				const ms = this.parseInterval(job.schedule)
				if (ms > 0) {
					const timer = this._setInterval(() => this.onTrigger(job), ms)
					this.timers.set(job.id, timer)
					console.log(`[CronManager] Scheduled interval job: ${job.name} (${job.schedule})`)
				}
			} else {
				try {
					const c = new Cron(job.schedule, () => this.onTrigger(job))
					this.cronJobs.set(job.id, c)
					console.log(`[CronManager] Scheduled cron job: ${job.name} (${job.schedule})`)
				} catch (err) {
					console.error(`[CronManager] Invalid cron expression for job ${job.name}: ${job.schedule}`, err)
				}
			}
		}
	}

	private isInterval(schedule: string): boolean {
		return /^\d+[smhd]$/.test(schedule)
	}

	private parseInterval(schedule: string): number {
		const match = schedule.match(/^(\d+)([smhd])$/)
		if (!match) return 0
		const value = parseInt(match[1])
		const unit = match[2]
		switch (unit) {
			case 's': return value * 1000
			case 'm': return value * 60 * 1000
			case 'h': return value * 60 * 60 * 1000
			case 'd': return value * 24 * 60 * 60 * 1000
			default: return 0
		}
	}

	public stop() {
		if (this.refreshTimer !== undefined) {
			this._clearInterval(this.refreshTimer)
			this.refreshTimer = undefined
		}
		for (const timer of this.timers.values()) this._clearInterval(timer)
		for (const cron of this.cronJobs.values()) cron.stop()
		this.timers.clear()
		this.cronJobs.clear()
	}
}
