import { describe, test, expect, beforeEach } from 'bun:test'
import { CronJobSchema, type CronJob, migrateLegacyTarget, migrateRawCronEntry } from '../utils/cronStore'
import { CronManager } from '../bridge/cronManager'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
	return CronJobSchema.parse({
		id: crypto.randomUUID(),
		name: 'Test Job',
		schedule: '30m',
		type: 'ai',
		prompt: 'do stuff',
		target: 'last',
		enabled: true,
		createdAt: new Date().toISOString(),
		...overrides,
	})
}

/** Minimal fake timer controller — injectable into CronManager */
function makeFakeTimers() {
	type Timer = { id: number; callback: () => void; ms: number; nextFireAt: number }
	let now = 0
	let nextId = 1
	const timers = new Map<number, Timer>()

	const setIntervalFn = (callback: (...args: any[]) => void, ms: number): any => {
		const id = nextId++
		timers.set(id, { id, callback, ms, nextFireAt: now + ms })
		return id
	}

	const clearIntervalFn = (id: any): void => {
		timers.delete(id)
	}

	/** Advance virtual clock by `ms` milliseconds, firing all due timers in order */
	const advance = (ms: number) => {
		const target = now + ms
		// Fire timers as they come due, in time order
		let safety = 10000
		while (safety-- > 0) {
			// Find earliest due timer
			let earliest: Timer | undefined
			for (const t of timers.values()) {
				if (t.nextFireAt <= target && (!earliest || t.nextFireAt < earliest.nextFireAt)) {
					earliest = t
				}
			}
			if (!earliest) break
			now = earliest.nextFireAt
			earliest.nextFireAt = now + earliest.ms
			earliest.callback()
		}
		now = target
	}

	const count = () => timers.size

	return { setIntervalFn, clearIntervalFn, advance, count }
}

// ─── CronJobSchema ─────────────────────────────────────────────────────────────

describe('CronJobSchema', () => {
	test('defaults type to "ai" when omitted', () => {
		const job = CronJobSchema.parse({
			id: '1',
			name: 'test',
			schedule: '30m',
			prompt: 'do stuff',
			enabled: true,
			createdAt: new Date().toISOString(),
		})
		expect(job.type).toBe('ai')
	})

	test('accepts type "message"', () => {
		const job = makeJob({ type: 'message' })
		expect(job.type).toBe('message')
	})

	test('accepts type "ai" explicitly', () => {
		const job = makeJob({ type: 'ai' })
		expect(job.type).toBe('ai')
	})

	test('rejects unknown type values', () => {
		expect(() =>
			CronJobSchema.parse({
				id: '1',
				name: 'test',
				schedule: '30m',
				type: 'unknown',
				prompt: 'x',
				enabled: true,
				createdAt: new Date().toISOString(),
			})
		).toThrow()
	})

	test('defaults target to "last" when omitted', () => {
		const job = CronJobSchema.parse({
			id: '1',
			name: 'test',
			schedule: '30m',
			prompt: 'do stuff',
			enabled: true,
			createdAt: new Date().toISOString(),
		})
		expect(job.target).toBe('last')
	})

	test('defaults enabled to true when omitted', () => {
		const job = CronJobSchema.parse({
			id: '1',
			name: 'test',
			schedule: '30m',
			prompt: 'do stuff',
			createdAt: new Date().toISOString(),
		})
		expect(job.enabled).toBe(true)
	})

	test('parses discord:channelId target', () => {
		const job = makeJob({ target: 'discord:1474669130736205865' })
		expect(job.target).toBe('discord:1474669130736205865')
	})
})

// ─── CronManager – interval scheduling ────────────────────────────────────────

describe('CronManager (interval schedules)', () => {
	test('fires a 30m interval job after 30 minutes', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ schedule: '30m' })
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job], ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		expect(triggered.length).toBe(0)
		ft.advance(30 * 60 * 1000)
		expect(triggered.length).toBe(1)
		expect(triggered[0]).toBe(job.id)
	})

	test('fires a 1h interval job only after 1 hour', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ schedule: '1h' })
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job], ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		ft.advance(59 * 60 * 1000)
		expect(triggered.length).toBe(0)

		ft.advance(60 * 1000) // total = 1h
		expect(triggered.length).toBe(1)
	})

	test('fires multiple times over multiple intervals', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ schedule: '30m' })
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job], ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		ft.advance(90 * 60 * 1000) // 1.5h → fires at 30m and 60m and 90m
		expect(triggered.length).toBe(3)
	})

	test('does not fire a disabled job', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ schedule: '30m', enabled: false })
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job], ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		ft.advance(60 * 60 * 1000)
		expect(triggered.length).toBe(0)
	})

	test('fires multiple independent interval jobs at correct rates', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job30 = makeJob({ id: 'a', schedule: '30m' })
		const job60 = makeJob({ id: 'b', schedule: '1h' })
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job30, job60], ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		ft.advance(60 * 60 * 1000) // 1h
		expect(triggered.filter(id => id === 'a').length).toBe(2) // 30m and 60m
		expect(triggered.filter(id => id === 'b').length).toBe(1) // 60m only
	})

	test('stop() cancels all timers', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ schedule: '30m' })
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job], ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()
		mgr.stop()

		ft.advance(60 * 60 * 1000)
		expect(triggered.length).toBe(0)
	})

	test('refresh() adds newly enabled jobs', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const jobs: CronJob[] = []
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => jobs, ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		// Add a job and refresh
		jobs.push(makeJob({ id: 'new', schedule: '30m' }))
		mgr.refresh()

		ft.advance(30 * 60 * 1000)
		expect(triggered).toContain('new')
	})

	test('refresh() removes jobs no longer in the list', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ id: 'removable', schedule: '30m' })
		const jobs: CronJob[] = [job]
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => jobs, ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		// Remove the job and refresh
		jobs.splice(0, 1)
		mgr.refresh()

		ft.advance(60 * 60 * 1000)
		expect(triggered.length).toBe(0)
	})

	test('refresh() removes jobs that become disabled', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ id: 'toggle', schedule: '30m', enabled: true })
		const jobs: CronJob[] = [job]
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => jobs, ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		// Disable the job and refresh
		jobs[0] = { ...jobs[0], enabled: false }
		mgr.refresh()

		ft.advance(60 * 60 * 1000)
		expect(triggered.length).toBe(0)
	})
})

// ─── CronManager – interval parsing ───────────────────────────────────────────

describe('CronManager interval parser', () => {
	const parseCases: Array<[string, number]> = [
		['30m', 30 * 60 * 1000],
		['1h', 60 * 60 * 1000],
		['2h', 2 * 60 * 60 * 1000],
		['1d', 24 * 60 * 60 * 1000],
		['45s', 45 * 1000],
	]

	for (const [schedule, expectedMs] of parseCases) {
		test(`"${schedule}" registers timer at ${expectedMs}ms`, () => {
			const triggered: string[] = []
			const ft = makeFakeTimers()
			const job = makeJob({ id: schedule, schedule })
			const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job], ft.setIntervalFn, ft.clearIntervalFn)
			mgr.start()

			// Should not fire before the interval
			ft.advance(expectedMs - 1)
			expect(triggered.length).toBe(0)

			// Should fire at exactly the interval
			ft.advance(1)
			expect(triggered.length).toBe(1)
		})
	}

	test('cron expression is not treated as an interval', () => {
		const triggered: string[] = []
		const ft = makeFakeTimers()
		const job = makeJob({ schedule: '0 8 * * *' }) // not a simple interval
		const mgr = new CronManager(async (j) => { triggered.push(j.id) }, () => [job], ft.setIntervalFn, ft.clearIntervalFn)
		mgr.start()

		// Our fake setInterval was not called for this job (croner handles it separately)
		ft.advance(24 * 60 * 60 * 1000)
		expect(triggered.length).toBe(0) // fake timers don't fire croner internals
	})
})

// ─── Cron trigger dispatch logic ──────────────────────────────────────────────

describe('onCronTrigger dispatch logic', () => {
	/**
	 * Inline the same logic from start.ts so we can unit-test it independently
	 * without spinning up a full daemon.
	 */
	type MockSession = { id: string; channelId: string; channelUserId?: string; updatedAt: Date }

	function buildTrigger(opts: {
		sessions: MockSession[]
		created: MockSession[]
		enqueued: Array<{ sessionId: string; prompt: string }>
		directEmits: Array<{ sessionId: string; type: string; text?: string }>
	}) {
		const getSessionForBridge = (channelId: string, channelUserId: string) =>
			opts.sessions.find(s => s.channelId === channelId && s.channelUserId === channelUserId)

		const createSession = (o: { channelId?: string; channelUserId?: string }) => {
			const s: MockSession = {
				id: `sess_${Math.random().toString(36).slice(2, 8)}`,
				channelId: o.channelId ?? 'terminal',
				channelUserId: o.channelUserId,
				updatedAt: new Date(),
			}
			// @ts-ignore
			s.emitter = { emit: (event: string, data: any) => { opts.directEmits.push({ sessionId: s.id, type: data.type, text: data.text }) } }
			opts.created.push(s)
			return s
		}

		const enqueueMessage = async (sessionId: string, prompt: string) => {
			opts.enqueued.push({ sessionId, prompt })
		}

		return async (job: CronJob) => {
			let session: MockSession | undefined

			if (job.target === 'last') {
				session = [...opts.sessions, ...opts.created].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
			} else if (job.target?.includes(':')) {
				const [channelId, channelUserId] = job.target.split(':')
				session = getSessionForBridge(channelId, channelUserId)
				if (!session) {
					session = createSession({ channelId, channelUserId })
				}
			}

			if (!session) {
				session = createSession({})
			}

			if (job.type === 'message') {
				; (session as any).emitter.emit('event', { type: 'start', sessionId: session.id })
					; (session as any).emitter.emit('event', { type: 'chunk', text: job.prompt })
					; (session as any).emitter.emit('event', { type: 'done', sessionId: session.id })
			} else {
				await enqueueMessage(session.id, job.prompt)
			}
		}
	}

	test('type "ai" enqueues message to AI service', async () => {
		const enqueued: Array<{ sessionId: string; prompt: string }> = []
		const trigger = buildTrigger({ sessions: [], created: [], enqueued, directEmits: [] })
		const job = makeJob({ type: 'ai', target: 'discord:123456', prompt: 'Summarise emails' })

		await trigger(job)

		expect(enqueued.length).toBe(1)
		expect(enqueued[0].prompt).toBe('Summarise emails')
	})

	test('type "message" emits direct events without going to AI', async () => {
		const enqueued: Array<{ sessionId: string; prompt: string }> = []
		const directEmits: Array<{ sessionId: string; type: string; text?: string }> = []
		const trigger = buildTrigger({ sessions: [], created: [], enqueued, directEmits })
		const job = makeJob({ type: 'message', target: 'discord:123456', prompt: 'Hello team!' })

		await trigger(job)

		expect(enqueued.length).toBe(0)
		expect(directEmits.some(e => e.type === 'chunk' && e.text === 'Hello team!')).toBe(true)
		expect(directEmits.some(e => e.type === 'done')).toBe(true)
	})

	test('reuses existing session for known discord:channelId', async () => {
		const enqueued: Array<{ sessionId: string; prompt: string }> = []
		const existingSession: MockSession = {
			id: 'existing-session',
			channelId: 'discord',
			channelUserId: '999',
			updatedAt: new Date(),
		}
			; (existingSession as any).emitter = { emit: () => { } }
		const created: MockSession[] = []
		const trigger = buildTrigger({ sessions: [existingSession], created, enqueued, directEmits: [] })
		const job = makeJob({ type: 'ai', target: 'discord:999', prompt: 'Check tasks' })

		await trigger(job)

		expect(enqueued[0].sessionId).toBe('existing-session')
		expect(created.length).toBe(0) // no new session created
	})

	test('creates new session when no existing session for target channel', async () => {
		const enqueued: Array<{ sessionId: string; prompt: string }> = []
		const created: MockSession[] = []
		const trigger = buildTrigger({ sessions: [], created, enqueued, directEmits: [] })
		const job = makeJob({ type: 'ai', target: 'discord:777', prompt: 'New task' })

		await trigger(job)

		expect(created.length).toBe(1)
		expect(created[0].channelId).toBe('discord')
		expect(created[0].channelUserId).toBe('777')
		expect(enqueued[0].sessionId).toBe(created[0].id)
	})

	test('target "last" resolves to most recently updated session', async () => {
		const enqueued: Array<{ sessionId: string; prompt: string }> = []
		const older: MockSession = { id: 'older', channelId: 'terminal', updatedAt: new Date(Date.now() - 10000) }
		const newer: MockSession = { id: 'newer', channelId: 'terminal', updatedAt: new Date(Date.now()) }
			; (older as any).emitter = { emit: () => { } }
			; (newer as any).emitter = { emit: () => { } }
		const trigger = buildTrigger({ sessions: [older, newer], created: [], enqueued, directEmits: [] })
		const job = makeJob({ type: 'ai', target: 'last', prompt: 'ping' })

		await trigger(job)

		expect(enqueued[0].sessionId).toBe('newer')
	})
})

// ─── /cron-test endpoint logic ─────────────────────────────────────────────────

describe('/cron-test endpoint logic', () => {
	/**
	 * Inline the handler logic from start.ts so we can test it without a running daemon.
	 * Mirrors: POST /cron-test → find job, optionally override target, call onCronTrigger.
	 */
	function makeCronTestHandler(jobs: CronJob[], triggered: Array<CronJob>) {
		const onCronTrigger = async (job: CronJob) => { triggered.push(job) }
		const loadJobs = () => jobs

		return async (cronId: string, target?: string): Promise<{ status: number; body: any }> => {
			const found = loadJobs().find(j => j.id === cronId)
			if (!found) return { status: 404, body: { error: `Cron job '${cronId}' not found` } }
			const testJob = target ? { ...found, target } : found
			await onCronTrigger(testJob)
			return { status: 200, body: { ok: true, jobName: found.name, target: testJob.target } }
		}
	}

	test('returns 404 when cronId does not match any job', async () => {
		const handler = makeCronTestHandler([], [])
		const res = await handler('nonexistent-id')
		expect(res.status).toBe(404)
		expect(res.body.error).toContain('nonexistent-id')
	})

	test('triggers the correct job when cronId matches', async () => {
		const job = makeJob({ name: 'My Job', target: 'discord:111' })
		const triggered: CronJob[] = []
		const handler = makeCronTestHandler([job], triggered)

		const res = await handler(job.id)

		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)
		expect(res.body.jobName).toBe('My Job')
		expect(triggered.length).toBe(1)
		expect(triggered[0].id).toBe(job.id)
	})

	test('uses job default target when no override provided', async () => {
		const job = makeJob({ target: 'discord:111' })
		const triggered: CronJob[] = []
		const handler = makeCronTestHandler([job], triggered)

		await handler(job.id)

		expect(triggered[0].target).toBe('discord:111')
	})

	test('overrides target when override is provided', async () => {
		const job = makeJob({ target: 'discord:111' })
		const triggered: CronJob[] = []
		const handler = makeCronTestHandler([job], triggered)

		const res = await handler(job.id, 'discord:999')

		expect(triggered[0].target).toBe('discord:999')
		expect(res.body.target).toBe('discord:999')
	})

	test('does not mutate the original job when overriding target', async () => {
		const job = makeJob({ target: 'discord:111' })
		const triggered: CronJob[] = []
		const handler = makeCronTestHandler([job], triggered)

		await handler(job.id, 'discord:999')

		expect(job.target).toBe('discord:111') // original unchanged
	})

	test('only triggers once per call even when multiple jobs exist', async () => {
		const job1 = makeJob({ name: 'Job A', target: 'discord:111' })
		const job2 = makeJob({ name: 'Job B', target: 'discord:222' })
		const triggered: CronJob[] = []
		const handler = makeCronTestHandler([job1, job2], triggered)

		await handler(job1.id)

		expect(triggered.length).toBe(1)
		expect(triggered[0].id).toBe(job1.id)
	})
})

// ─── Session channel fields ────────────────────────────────────────────────────

describe('Session channel fields (for /sessions endpoint)', () => {
	/**
	 * Verifies the shape of session data that the /sessions endpoint returns.
	 * We replicate the mapping logic from start.ts.
	 */
	type SessionLike = {
		id: string
		channelId: string
		channelUserId?: string
		channelName?: string
		model: string
		createdAt: Date
		updatedAt: Date
		queue: unknown[]
		summary?: string
		name?: string
	}

	function mapSession(s: SessionLike) {
		return {
			id: s.id,
			name: s.name,
			model: s.model,
			createdAt: s.createdAt.toISOString(),
			updatedAt: s.updatedAt.toISOString(),
			summary: s.summary,
			queueLength: s.queue.length,
			channelId: s.channelId,
			channelUserId: s.channelUserId,
			channelName: s.channelName,
		}
	}

	test('includes channelId in mapped session', () => {
		const s: SessionLike = { id: '1', channelId: 'discord', channelUserId: '123', model: 'x', createdAt: new Date(), updatedAt: new Date(), queue: [] }
		const mapped = mapSession(s)
		expect(mapped.channelId).toBe('discord')
	})

	test('includes channelUserId in mapped session', () => {
		const s: SessionLike = { id: '1', channelId: 'discord', channelUserId: '456', model: 'x', createdAt: new Date(), updatedAt: new Date(), queue: [] }
		const mapped = mapSession(s)
		expect(mapped.channelUserId).toBe('456')
	})

	test('includes channelName when present', () => {
		const s: SessionLike = { id: '1', channelId: 'discord', channelUserId: '456', channelName: '#general', model: 'x', createdAt: new Date(), updatedAt: new Date(), queue: [] }
		const mapped = mapSession(s)
		expect(mapped.channelName).toBe('#general')
	})

	test('channelName is undefined when not set', () => {
		const s: SessionLike = { id: '1', channelId: 'discord', channelUserId: '456', model: 'x', createdAt: new Date(), updatedAt: new Date(), queue: [] }
		const mapped = mapSession(s)
		expect(mapped.channelName).toBeUndefined()
	})

	test('terminal sessions have channelId "terminal" and no channelUserId', () => {
		const s: SessionLike = { id: '1', channelId: 'terminal', model: 'x', createdAt: new Date(), updatedAt: new Date(), queue: [] }
		const mapped = mapSession(s)
		expect(mapped.channelId).toBe('terminal')
		expect(mapped.channelUserId).toBeUndefined()
	})
})
// ─── CronJobSchema delivery field ─────────────────────────────────────────────

describe('CronJobSchema delivery field', () => {
	test('accepts a delivery object with platform + channelId', () => {
		const job = CronJobSchema.parse({
			id: '1',
			name: 'test',
			schedule: '1h',
			prompt: 'do stuff',
			enabled: true,
			createdAt: new Date().toISOString(),
			delivery: { platform: 'discord', channelId: '987654321' },
		})
		expect(job.delivery?.platform).toBe('discord')
		expect(job.delivery?.channelId).toBe('987654321')
		expect(job.delivery?.platformAccountId).toBeUndefined()
	})

	test('accepts a delivery object with platform + platformAccountId + channelId', () => {
		const job = CronJobSchema.parse({
			id: '1',
			name: 'test',
			schedule: '30m',
			prompt: 'ping',
			enabled: true,
			createdAt: new Date().toISOString(),
			delivery: { platform: 'discord', platformAccountId: 'bot-id-999', channelId: '1234567890' },
		})
		expect(job.delivery?.platform).toBe('discord')
		expect(job.delivery?.platformAccountId).toBe('bot-id-999')
		expect(job.delivery?.channelId).toBe('1234567890')
	})

	test('delivery is optional — job without it still parses', () => {
		const job = CronJobSchema.parse({
			id: '1',
			name: 'legacy',
			schedule: '30m',
			prompt: 'x',
			enabled: true,
			createdAt: new Date().toISOString(),
			target: 'last',
		})
		expect(job.delivery).toBeUndefined()
		expect(job.target).toBe('last')
	})

	test('rejects delivery without channelId', () => {
		expect(() =>
			CronJobSchema.parse({
				id: '1',
				name: 'bad',
				schedule: '1h',
				prompt: 'x',
				enabled: true,
				createdAt: new Date().toISOString(),
				delivery: { platform: 'discord' }, // missing channelId
			})
		).toThrow()
	})
})

// ─── migrateLegacyTarget ──────────────────────────────────────────────────────

describe('migrateLegacyTarget', () => {
	test('pass-through: new-format job with platform field is unchanged', () => {
		const job = makeJob({ delivery: { platform: 'discord', channelId: '111' } })
		const result = migrateLegacyTarget(job)
		expect(result).toBe(job) // exact same reference
		expect(result.delivery?.platform).toBe('discord')
	})

	test('v1 migration: old bridgeName delivery → platform extracted from key', () => {
		// Simulate a v1 job stored in cron.json — bypass schema parse since old format fails new validation
		const job = {
			id: crypto.randomUUID(), name: 'v1 job', schedule: '30m', type: 'ai',
			prompt: 'do stuff', target: 'last', enabled: true, createdAt: new Date().toISOString(),
			delivery: { bridgeName: 'discord:main', channelId: '987' },
		} as unknown as CronJob
		const result = migrateLegacyTarget(job)
		expect(result.delivery?.platform).toBe('discord')
		expect(result.delivery?.channelId).toBe('987')
		expect((result.delivery as any)?.bridgeName).toBeUndefined()
	})

	test('v1 migration: bridgeName without channelId → empty channelId', () => {
		const job = {
			id: crypto.randomUUID(), name: 'v1 job 2', schedule: '30m', type: 'ai',
			prompt: 'do stuff', target: 'last', enabled: true, createdAt: new Date().toISOString(),
			delivery: { bridgeName: 'telegram:bot' },
		} as unknown as CronJob
		const result = migrateLegacyTarget(job)
		expect(result.delivery?.platform).toBe('telegram')
		expect(result.delivery?.channelId).toBe('')
	})

	test('legacy target string "discord:channelId" → delivery with platform + channelId', () => {
		const job = makeJob({ delivery: undefined, target: 'discord:123456' })
		const result = migrateLegacyTarget(job)
		expect(result.delivery?.platform).toBe('discord')
		expect(result.delivery?.channelId).toBe('123456')
	})

	test('legacy target "last" → no delivery created', () => {
		const job = makeJob({ delivery: undefined, target: 'last' })
		const result = migrateLegacyTarget(job)
		expect(result.delivery).toBeUndefined()
		expect(result.target).toBe('last')
	})

	test('missing target → no delivery created', () => {
		const job = makeJob({ delivery: undefined, target: undefined })
		const result = migrateLegacyTarget(job)
		expect(result.delivery).toBeUndefined()
	})
})

// ─── migrateRawCronEntry ──────────────────────────────────────────────────────
// This function migrates raw JSON BEFORE Zod schema validation so that old
// delivery formats (e.g. bridgeName) get converted rather than dropped.

describe('migrateRawCronEntry', () => {
	test('pass-through: new-format delivery with platform is unchanged', () => {
		const raw = { id: '1', delivery: { platform: 'discord', channelId: '123' } }
		const result = migrateRawCronEntry(raw) as typeof raw
		expect(result.delivery.platform).toBe('discord')
		expect(result.delivery.channelId).toBe('123')
	})

	test('v1 bridgeName delivery: extracts platform from first colon segment', () => {
		const raw = { id: '1', delivery: { bridgeName: 'discord:main', channelId: '987' } }
		const result = migrateRawCronEntry(raw) as any
		expect(result.delivery.platform).toBe('discord')
		expect(result.delivery.channelId).toBe('987')
		expect(result.delivery.bridgeName).toBeUndefined()
	})

	test('v1 bridgeName: telegram bridge extracts platform correctly', () => {
		const raw = { id: '1', delivery: { bridgeName: 'telegram:bot', channelId: '555' } }
		const result = migrateRawCronEntry(raw) as any
		expect(result.delivery.platform).toBe('telegram')
		expect(result.delivery.channelId).toBe('555')
	})

	test('v1 bridgeName without channelId → empty channelId', () => {
		const raw = { id: '1', delivery: { bridgeName: 'discord:main' } }
		const result = migrateRawCronEntry(raw) as any
		expect(result.delivery.platform).toBe('discord')
		expect(result.delivery.channelId).toBe('')
	})

	test('unrecognised delivery (no platform, no bridgeName) → delivery dropped', () => {
		const raw = { id: '1', delivery: { someUnknownField: 'value' }, target: 'last' }
		const result = migrateRawCronEntry(raw) as any
		expect(result.delivery).toBeUndefined()
		expect(result.target).toBe('last')
	})

	test('legacy target string "discord:channelId" → delivery object created', () => {
		const raw = { id: '1', target: 'discord:123456789' }
		const result = migrateRawCronEntry(raw) as any
		expect(result.delivery.platform).toBe('discord')
		expect(result.delivery.channelId).toBe('123456789')
	})

	test('legacy target "last" → no delivery created, kept as-is', () => {
		const raw = { id: '1', target: 'last' }
		const result = migrateRawCronEntry(raw) as any
		expect(result.delivery).toBeUndefined()
		expect(result.target).toBe('last')
	})

	test('no target, no delivery → unchanged', () => {
		const raw = { id: '1', name: 'bare' }
		const result = migrateRawCronEntry(raw) as any
		expect(result.delivery).toBeUndefined()
	})

	test('non-object input → returned as-is', () => {
		expect(migrateRawCronEntry(null)).toBe(null)
		expect(migrateRawCronEntry('string')).toBe('string')
		expect(migrateRawCronEntry(42)).toBe(42)
		expect(migrateRawCronEntry([])).toEqual([])
	})
})

// ─── onCronTrigger delivery routing — fixed dispatch ─────────────────────────

describe('onCronTrigger delivery routing — fixed dispatch', () => {
	/**
	 * Mirrors the stable-ID version of onCronTrigger from start.ts.
	 * When job.delivery is set, the bridge is resolved at runtime via
	 * findBridgeByAccount(platform, platformAccountId) — session.channelId
	 * is set to bridge.name (the registered key), not the platform string.
	 */
	type MockSession = { id: string; channelId: string; channelUserId?: string; updatedAt: Date }

	function buildFixedTrigger(opts: {
		sessions: MockSession[]
		created: MockSession[]
		enqueued: Array<{ sessionId: string; prompt: string }>
		directEmits: Array<{ sessionId: string; type: string; text?: string }>
		bridges?: Array<{ platform: string; platformAccountId?: string; name: string }>
		bridgeNotFoundErrors?: string[]
	}) {
		const bridges = opts.bridges ?? []

		const findBridgeByAccount = (platform: string, platformAccountId?: string) =>
			bridges.find(b => {
				if (b.platform !== platform) return false
				if (platformAccountId && b.platformAccountId && b.platformAccountId !== platformAccountId) return false
				return true
			})

		const getSessionForBridge = (channelId: string, channelUserId: string) =>
			opts.sessions.find(s => s.channelId === channelId && s.channelUserId === channelUserId)

		const createSession = (o: { channelId?: string; channelUserId?: string }) => {
			const s: MockSession = {
				id: `sess_${Math.random().toString(36).slice(2, 8)}`,
				channelId: o.channelId ?? 'terminal',
				channelUserId: o.channelUserId,
				updatedAt: new Date(),
			}
			// @ts-ignore
			s.emitter = { emit: (_event: string, data: any) => { opts.directEmits.push({ sessionId: s.id, type: data.type, text: data.text }) } }
			opts.created.push(s)
			return s
		}

		const enqueueMessage = async (sessionId: string, prompt: string) => {
			opts.enqueued.push({ sessionId, prompt })
		}

		return async (job: CronJob) => {
			let session: MockSession | undefined

			if (job.delivery) {
				// ── Stable-ID path: resolve bridge at runtime via platform identifiers ─
				const { platform, platformAccountId, channelId: targetChannelId } = job.delivery
				const bridge = findBridgeByAccount(platform, platformAccountId)
				if (!bridge) {
					opts.bridgeNotFoundErrors?.push(platform)
					session = createSession({})
				} else {
					const bridgeName = bridge.name
					session = getSessionForBridge(bridgeName, targetChannelId)
					if (!session) {
						session = createSession({ channelId: bridgeName, channelUserId: targetChannelId })
					}
				}
			} else if (job.target === 'last') {
				session = [...opts.sessions, ...opts.created].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
			} else if (job.target?.includes(':')) {
				const colonIdx = job.target.indexOf(':')
				const platform = job.target.slice(0, colonIdx)
				const targetChannelId = job.target.slice(colonIdx + 1) || undefined
				const bridge = findBridgeByAccount(platform)
				const matchedBridgeName = bridge?.name ?? platform
				session = getSessionForBridge(matchedBridgeName, targetChannelId ?? '')
				if (!session) {
					session = createSession({ channelId: matchedBridgeName, channelUserId: targetChannelId })
				}
			}

			if (!session) {
				session = createSession({})
			}

			if (job.type === 'message') {
				; (session as any).emitter.emit('event', { type: 'start', sessionId: session.id })
					; (session as any).emitter.emit('event', { type: 'chunk', text: job.prompt })
					; (session as any).emitter.emit('event', { type: 'done', sessionId: session.id })
			} else {
				await enqueueMessage(session.id, job.prompt)
			}
		}
	}

	test('delivery.platform+channelId resolves bridge and sets session.channelId to bridge.name', async () => {
		const created: MockSession[] = []
		const trigger = buildFixedTrigger({
			sessions: [], created, enqueued: [], directEmits: [],
			bridges: [{ platform: 'discord', name: 'discord:main' }],
		})
		const job = makeJob({ type: 'ai', delivery: { platform: 'discord', channelId: '987654321' } })

		await trigger(job)

		expect(created.length).toBe(1)
		// Key assertion: session.channelId is the bridge's registered name, resolved at runtime
		expect(created[0].channelId).toBe('discord:main')
		expect(created[0].channelUserId).toBe('987654321')
	})

	test('delivery.channelId is used as session.channelUserId', async () => {
		const created: MockSession[] = []
		const enqueued: Array<{ sessionId: string; prompt: string }> = []
		const trigger = buildFixedTrigger({
			sessions: [], created, enqueued, directEmits: [],
			bridges: [{ platform: 'terminal', name: 'terminal:main' }],
		})
		const job = makeJob({ type: 'ai', delivery: { platform: 'terminal', channelId: 'chan-abc' } })

		await trigger(job)

		expect(created[0].channelUserId).toBe('chan-abc')
		expect(enqueued[0].sessionId).toBe(created[0].id)
	})

	test('logs error when no bridge found for platform', async () => {
		const bridgeNotFoundErrors: string[] = []
		const trigger = buildFixedTrigger({
			sessions: [], created: [], enqueued: [], directEmits: [],
			bridges: [{ platform: 'terminal', name: 'terminal:main' }], // discord not registered
			bridgeNotFoundErrors,
		})
		const job = makeJob({ type: 'message', delivery: { platform: 'discord', channelId: '111' } })

		await trigger(job)

		expect(bridgeNotFoundErrors).toContain('discord')
	})

	test('reuses existing session when platform + channelId match resolved bridge', async () => {
		const now = new Date()
		const existingSession: MockSession = { id: 'existing', channelId: 'discord:main', channelUserId: '555', updatedAt: now }
			; (existingSession as any).emitter = { emit: () => { } }
		const created: MockSession[] = []
		const enqueued: Array<{ sessionId: string; prompt: string }> = []
		const trigger = buildFixedTrigger({
			sessions: [existingSession], created, enqueued, directEmits: [],
			bridges: [{ platform: 'discord', name: 'discord:main' }],
		})
		const job = makeJob({ type: 'ai', delivery: { platform: 'discord', channelId: '555' } })

		await trigger(job)

		expect(created.length).toBe(0) // no new session
		expect(enqueued[0].sessionId).toBe('existing')
	})

	test('type "message" emits chunk event when delivery is used', async () => {
		const directEmits: Array<{ sessionId: string; type: string; text?: string }> = []
		const trigger = buildFixedTrigger({
			sessions: [], created: [], enqueued: [], directEmits,
			bridges: [{ platform: 'terminal', name: 'terminal:main' }],
		})
		const job = makeJob({ type: 'message', delivery: { platform: 'terminal', channelId: 'terminal' }, prompt: 'Hello from cron!' })

		await trigger(job)

		expect(directEmits.some(e => e.type === 'chunk' && e.text === 'Hello from cron!')).toBe(true)
		expect(directEmits.some(e => e.type === 'done')).toBe(true)
	})
})

// ─── CronManager end-to-end — real timer, fires once ─────────────────────────

describe('CronManager real timer — fires exactly once', () => {
	test('10s schedule fires exactly once after 10 seconds', async () => {
		const triggered: CronJob[] = []
		const job = makeJob({ id: 'real-timer-test', schedule: '10s', delivery: { platform: 'terminal', channelId: 'terminal' } })

		const mgr = new CronManager(async (j) => { triggered.push(j) }, () => [job])
		mgr.start()

		// Wait 12s — enough for exactly one fire but not two
		await new Promise<void>(resolve => setTimeout(resolve, 12_000))
		mgr.stop()

		expect(triggered.length).toBe(1)
		expect(triggered[0].id).toBe('real-timer-test')
	}, { timeout: 15_000 })
})
