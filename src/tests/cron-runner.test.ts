import { describe, test, expect } from 'bun:test'
import { runCronJobsOnce } from '../commands/cron.ts'
import type { CronJob } from '../utils/cronStore.ts'

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		name: overrides.name ?? 'Test Cron',
		schedule: 'schedule' in overrides ? overrides.schedule : (overrides.runAt ? undefined : '1h'),
		type: overrides.type ?? 'message',
		prompt: overrides.prompt ?? 'hello',
		target: overrides.target ?? 'last',
		enabled: overrides.enabled ?? true,
		createdAt: overrides.createdAt ?? new Date().toISOString(),
		delivery: overrides.delivery,
		skills: overrides.skills,
		sessionKey: overrides.sessionKey,
		context: overrides.context,
		lastRun: overrides.lastRun,
		lastStatus: overrides.lastStatus,
		lastError: overrides.lastError,
		runAt: overrides.runAt,
	}
}

describe('runCronJobsOnce', () => {
	test('executes due jobs and records successful runs', async () => {
		const executed: string[] = []
		const recorded: Array<{ id: string; status: string }> = []
		const job = makeJob({ id: 'job-1' })

		const result = await runCronJobsOnce({
			daemonUrl: 'http://127.0.0.1:9001',
			daemonToken: 'token',
			loadJobsFn: () => [job],
			isJobDueFn: () => true,
			executeJobFn: async (j) => { executed.push(j.id) },
			recordRunFn: (id, r) => {
				recorded.push({ id, status: r.status })
				return undefined
			},
			logFn: () => { },
			errorFn: () => { },
		})

		expect(result.dueCount).toBe(1)
		expect(result.executedCount).toBe(1)
		expect(result.failedCount).toBe(0)
		expect(executed).toEqual(['job-1'])
		expect(recorded).toEqual([{ id: 'job-1', status: 'success' }])
	})

	test('dry-run reports due jobs without executing', async () => {
		let executed = false
		const job = makeJob({ id: 'job-1' })

		const result = await runCronJobsOnce({
			dryRun: true,
			daemonUrl: 'http://127.0.0.1:9001',
			daemonToken: 'token',
			loadJobsFn: () => [job],
			isJobDueFn: () => true,
			executeJobFn: async () => { executed = true },
			recordRunFn: () => undefined,
			logFn: () => { },
			errorFn: () => { },
		})

		expect(result.dueCount).toBe(1)
		expect(result.executedCount).toBe(0)
		expect(result.failedCount).toBe(0)
		expect(executed).toBe(false)
	})

	test('throws when requested job id does not exist', async () => {
		await expect(runCronJobsOnce({
			jobId: 'missing',
			daemonUrl: 'http://127.0.0.1:9001',
			daemonToken: 'token',
			loadJobsFn: () => [makeJob({ id: 'job-1' })],
			isJobDueFn: () => true,
			executeJobFn: async () => { },
			recordRunFn: () => undefined,
			logFn: () => { },
			errorFn: () => { },
		})).rejects.toThrow("Job 'missing' not found")
	})

	test('records failed runs when execute throws', async () => {
		const recorded: Array<{ id: string; status: string; error?: string }> = []
		const job = makeJob({ id: 'job-1' })

		const result = await runCronJobsOnce({
			daemonUrl: 'http://127.0.0.1:9001',
			daemonToken: 'token',
			loadJobsFn: () => [job],
			isJobDueFn: () => true,
			executeJobFn: async () => { throw new Error('boom') },
			recordRunFn: (id, r) => {
				recorded.push({ id, status: r.status, error: r.error })
				return undefined
			},
			logFn: () => { },
			errorFn: () => { },
		})

		expect(result.dueCount).toBe(1)
		expect(result.executedCount).toBe(0)
		expect(result.failedCount).toBe(1)
		expect(recorded[0].id).toBe('job-1')
		expect(recorded[0].status).toBe('error')
		expect(recorded[0].error).toBe('boom')
	})
})

describe('runCronJobsOnce — one-shot auto-delete', () => {
	test('one-shot job (runAt): removeJobFn called after successful execution', async () => {
		const removed: string[] = []
		const pastTime = new Date(Date.now() - 60_000).toISOString()
		const job = makeJob({ id: 'shot-1', runAt: pastTime })

		await runCronJobsOnce({
			daemonUrl: 'http://127.0.0.1:9001',
			daemonToken: 'token',
			loadJobsFn: () => [job],
			isJobDueFn: () => true,
			executeJobFn: async () => { },
			recordRunFn: () => undefined,
			removeJobFn: (id) => { removed.push(id) },
			logFn: () => { },
			errorFn: () => { },
		})

		expect(removed).toEqual(['shot-1'])
	})

	test('one-shot job (runAt): removeJobFn called even when execution fails', async () => {
		const removed: string[] = []
		const pastTime = new Date(Date.now() - 60_000).toISOString()
		const job = makeJob({ id: 'shot-2', runAt: pastTime })

		await runCronJobsOnce({
			daemonUrl: 'http://127.0.0.1:9001',
			daemonToken: 'token',
			loadJobsFn: () => [job],
			isJobDueFn: () => true,
			executeJobFn: async () => { throw new Error('fail') },
			recordRunFn: () => undefined,
			removeJobFn: (id) => { removed.push(id) },
			logFn: () => { },
			errorFn: () => { },
		})

		expect(removed).toEqual(['shot-2'])
	})

	test('recurring job (schedule only): removeJobFn NOT called', async () => {
		const removed: string[] = []
		const job = makeJob({ id: 'recurring-1' }) // schedule: '1h', no runAt

		await runCronJobsOnce({
			daemonUrl: 'http://127.0.0.1:9001',
			daemonToken: 'token',
			loadJobsFn: () => [job],
			isJobDueFn: () => true,
			executeJobFn: async () => { },
			recordRunFn: () => undefined,
			removeJobFn: (id) => { removed.push(id) },
			logFn: () => { },
			errorFn: () => { },
		})

		expect(removed).toEqual([])
	})
})
