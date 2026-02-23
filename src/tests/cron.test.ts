import { describe, test, expect, beforeEach } from 'bun:test'
import { CronJobSchema, type CronJob } from '../utils/cronStore'
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
				;(session as any).emitter.emit('event', { type: 'start', sessionId: session.id })
				;(session as any).emitter.emit('event', { type: 'chunk', text: job.prompt })
				;(session as any).emitter.emit('event', { type: 'done', sessionId: session.id })
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
		;(existingSession as any).emitter = { emit: () => {} }
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
		;(older as any).emitter = { emit: () => {} }
		;(newer as any).emitter = { emit: () => {} }
		const trigger = buildTrigger({ sessions: [older, newer], created: [], enqueued, directEmits: [] })
		const job = makeJob({ type: 'ai', target: 'last', prompt: 'ping' })

		await trigger(job)

		expect(enqueued[0].sessionId).toBe('newer')
	})
})
