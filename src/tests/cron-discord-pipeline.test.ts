/**
 * End-to-end integration test: Cron → Discord delivery pipeline.
 *
 * This test wires up a real BridgeManager and AIService together with a
 * FakeDiscordBridge, then drives the same code path that `onCronTrigger` in
 * start.ts walks at runtime.  No mocking of internal modules — only the
 * external Discord SDK is replaced with the FakeDiscordBridge class below.
 *
 * Failure modes caught by this test that pure unit tests miss:
 *  - session.emitter events NOT flowing through attachBridgeListeners
 *  - BridgeManager.dispatchEvent looking up bridge by name instead of channelId
 *  - job.delivery being stripped by a schema change (causing no-bridge path)
 *  - chunk buffering logic swallowing or doubling messages
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { BridgeManager } from '../bridge/index.ts'
import type { IBridge, DaemonEvent } from '../bridge/types.ts'
import { AIService } from '../services/aiService.ts'
import type { CronJob } from '../utils/cronStore.ts'

// ─── Fake Discord Bridge ───────────────────────────────────────────────────────

/**
 * Implements IBridge without any real Discord SDK.
 * Captures every event delivered by handleDaemonEvent for later assertion.
 */
class FakeDiscordBridge implements IBridge {
	name: string
	platform = 'discord'
	platformAccountId?: string

	receivedEvents: Array<{ event: DaemonEvent; ctx: unknown }> = []

	constructor({ name = 'discord:main', platformAccountId = 'bot-snowflake-123' } = {}) {
		this.name = name
		this.platformAccountId = platformAccountId
	}

	async initialize(_config: unknown, _onMessage: unknown) {
		// No-op — already "logged in" (platformAccountId set in constructor)
	}

	async handleDaemonEvent(event: DaemonEvent, ctx: unknown) {
		this.receivedEvents.push({ event, ctx })
	}

	async destroy() {}

	/** Helper: events of a specific type */
	eventsOfType<T extends DaemonEvent['type']>(type: T) {
		return this.receivedEvents
			.filter(e => e.event.type === type)
			.map(e => e.event as Extract<DaemonEvent, { type: T }>)
	}

	reset() {
		this.receivedEvents = []
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal onCronTrigger — mirrors start.ts delivery logic exactly, without the logging noise. */
async function triggerCronJob(
	job: CronJob,
	bridgeManager: BridgeManager,
	aiService: AIService,
) {
	if (!job.delivery) throw new Error('No delivery — use target-based tests for that path')

	const { platform, platformAccountId, channelId: targetChannelId, channelName } = job.delivery

	const bridge = bridgeManager.findBridgeByAccount(platform, platformAccountId)
	if (!bridge) throw new Error(`No active bridge for platform="${platform}" accountId="${platformAccountId ?? 'any'}"`)

	const bridgeName = bridge.name

	let session = aiService.getSessionForBridge(bridgeName, targetChannelId)
	if (!session) {
		session = aiService.createSession({ channelId: bridgeName, channelUserId: targetChannelId, channelName })
	}

	if (job.type === 'message') {
		session.emitter.emit('event', { type: 'start', sessionId: session.id })
		session.emitter.emit('event', { type: 'chunk', text: job.prompt })
		session.emitter.emit('event', { type: 'done', sessionId: session.id })
	} else {
		throw new Error('AI cron type requires a live LLM — not suitable for this test')
	}
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
	return {
		id: 'cron-e2e-1',
		name: 'E2E Pipeline Test',
		schedule: '1h',
		type: 'message',
		prompt: 'Hello from cron!',
		delivery: {
			platform: 'discord',
			platformAccountId: 'bot-snowflake-123',
			channelId: '1234567890',
			channelName: '#general',
		},
		target: 'last',
		enabled: true,
		createdAt: new Date().toISOString(),
		...overrides,
	}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Cron → Discord delivery (end-to-end pipeline)', () => {
	let fakeDiscord: FakeDiscordBridge
	let bridgeManager: BridgeManager
	let aiService: AIService

	beforeEach(() => {
		fakeDiscord = new FakeDiscordBridge()
		bridgeManager = new BridgeManager()
		bridgeManager.registerBridge(fakeDiscord)
		aiService = new AIService(bridgeManager)
	})

	// ── Happy path ─────────────────────────────────────────────────────────────

	test('message cron delivers chunk + done to the fake Discord bridge', async () => {
		const job = makeJob()
		await triggerCronJob(job, bridgeManager, aiService)

		const chunks = fakeDiscord.eventsOfType('chunk')
		const dones = fakeDiscord.eventsOfType('done')

		expect(chunks.length).toBe(1)
		expect(chunks[0].text).toBe('Hello from cron!')
		expect(dones.length).toBe(1)
	})

	test('delivered events carry the correct session context', async () => {
		const job = makeJob()
		await triggerCronJob(job, bridgeManager, aiService)

		// Every event delivered to the bridge should have the session context
		// that identifies the Discord channel (channelId = bridge name, channelUserId = Discord channel snowflake)
		const { ctx } = fakeDiscord.receivedEvents.find(e => e.event.type === 'chunk')!
		expect((ctx as any).channelId).toBe('discord:main')
		expect((ctx as any).channelUserId).toBe('1234567890')
		expect((ctx as any).channelName).toBe('#general')
	})

	test('start event is dispatched through to the bridge (not just chunk/done)', async () => {
		const job = makeJob()
		await triggerCronJob(job, bridgeManager, aiService)

		// attachBridgeListeners passes non-chunk/done events straight through
		const starts = fakeDiscord.eventsOfType('start')
		expect(starts.length).toBe(1)
	})

	// ── Multi-chunk buffering ──────────────────────────────────────────────────

	test('multiple chunks are all flushed to the bridge on done', async () => {
		const job = makeJob({ prompt: 'Line 1\nLine 2\nLine 3' })

		// Manually drive session so we can emit multiple chunk events
		const bridge = bridgeManager.findBridgeByAccount('discord', 'bot-snowflake-123')!
		const session = aiService.createSession({ channelId: bridge.name, channelUserId: '1234567890' })

		session.emitter.emit('event', { type: 'chunk', text: 'Line 1' })
		session.emitter.emit('event', { type: 'chunk', text: 'Line 2' })
		session.emitter.emit('event', { type: 'chunk', text: 'Line 3' })
		session.emitter.emit('event', { type: 'done', sessionId: session.id })

		const chunks = fakeDiscord.eventsOfType('chunk')
		expect(chunks.map(c => c.text)).toEqual(['Line 1', 'Line 2', 'Line 3'])
		expect(fakeDiscord.eventsOfType('done').length).toBe(1)
	})

	test('suppressed done flushes NO chunks to bridge', async () => {
		const bridge = bridgeManager.findBridgeByAccount('discord', 'bot-snowflake-123')!
		const session = aiService.createSession({ channelId: bridge.name, channelUserId: '9999' })

		session.emitter.emit('event', { type: 'chunk', text: 'Should not appear' })
		session.emitter.emit('event', { type: 'done', sessionId: session.id, suppressed: true })

		expect(fakeDiscord.eventsOfType('chunk').length).toBe(0)
		// done is still dispatched even when suppressed — bridge decides what to do
		expect(fakeDiscord.eventsOfType('done').length).toBe(1)
	})

	// ── Session reuse ──────────────────────────────────────────────────────────

	test('second cron trigger for same channel reuses the existing session', async () => {
		const job = makeJob()

		await triggerCronJob(job, bridgeManager, aiService)
		const sessionAfterFirst = aiService.getSessionForBridge('discord:main', '1234567890')
		expect(sessionAfterFirst).toBeDefined()
		const firstSessionId = sessionAfterFirst!.id

		fakeDiscord.reset()
		await triggerCronJob(job, bridgeManager, aiService)
		const sessionAfterSecond = aiService.getSessionForBridge('discord:main', '1234567890')

		// Same session object — no new session created
		expect(sessionAfterSecond!.id).toBe(firstSessionId)
		// Events still delivered on the second trigger
		expect(fakeDiscord.eventsOfType('chunk').length).toBe(1)
	})

	// ── Bridge resolution ──────────────────────────────────────────────────────

	test('findBridgeByAccount resolves bridge by platform + platformAccountId', () => {
		const found = bridgeManager.findBridgeByAccount('discord', 'bot-snowflake-123')
		expect(found).toBe(fakeDiscord)
		expect(found?.name).toBe('discord:main')
	})

	test('findBridgeByAccount falls back to platform-only match if platformAccountId omitted', () => {
		const found = bridgeManager.findBridgeByAccount('discord')
		expect(found).toBe(fakeDiscord)
	})

	test('findBridgeByAccount returns undefined for unknown platform', () => {
		expect(bridgeManager.findBridgeByAccount('telegram')).toBeUndefined()
	})

	test('triggerCronJob throws (not crashes silently) when no bridge is registered for the platform', async () => {
		const job = makeJob({ delivery: { platform: 'telegram', channelId: 'some-chat', channelName: 'chat' } })
		await expect(triggerCronJob(job, bridgeManager, aiService)).rejects.toThrow(
			'No active bridge for platform="telegram"'
		)
	})

	// ── Multiple bridge instances ──────────────────────────────────────────────

	test('multiple discord bridges are routed to the correct bot account', async () => {
		const secondDiscord = new FakeDiscordBridge({ name: 'discord:secondary', platformAccountId: 'bot-snowflake-456' })
		bridgeManager.registerBridge(secondDiscord)

		// Job targeting the FIRST bot
		const job1 = makeJob({ delivery: { platform: 'discord', platformAccountId: 'bot-snowflake-123', channelId: '1234567890' } })
		await triggerCronJob(job1, bridgeManager, aiService)

		// Job targeting the SECOND bot
		const job2 = makeJob({
			delivery: { platform: 'discord', platformAccountId: 'bot-snowflake-456', channelId: '9876543210' },
		})
		await triggerCronJob(job2, bridgeManager, aiService)

		// Each bridge received only its own message
		expect(fakeDiscord.eventsOfType('chunk').length).toBe(1) // primary
		expect(secondDiscord.eventsOfType('chunk').length).toBe(1) // secondary
		expect(fakeDiscord.receivedEvents.every(e => (e.ctx as any).channelUserId === '1234567890')).toBe(true)
		expect(secondDiscord.receivedEvents.every(e => (e.ctx as any).channelUserId === '9876543210')).toBe(true)
	})
})
