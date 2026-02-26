/**
 * Tests for the sub-agent lifecycle system:
 *
 * - Session creation: task/status fields set correctly
 * - attachBridgeListeners: sub-agents suppress raw chunks, emit subagent-status on start
 * - reportSubagentResult: structured report injected into parent with continuation instruction
 * - markSubagentCallbackCalled: prevents double-reporting from auto-finish
 * - updateSubagentProgress: emits subagent-status:progress to bridge and updates session.progress
 * - Error path: failed sub-agent notifies parent (tested via reportSubagentResult directly)
 * - DaemonEvent type: subagent-status shape
 */

import { expect, test, describe, beforeEach } from 'bun:test'
import { EventEmitter } from 'events'
import { writeFileSync } from 'fs'
import { AIService } from '../services/aiService'
import { BridgeManager } from '../bridge'
import type { DaemonEvent } from '../bridge/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeConfig() {
	return {
		version: '1.0',
		connections: {
			'test-conn': {
				nickname: 'test-conn',
				provider: 'openai',
				envKeyName: 'OPENAI_API_KEY',
				selectedModels: ['gpt-4o'],
			},
		},
		defaultModels: ['test-conn/gpt-4o'],
		bridges: { terminal: { enabled: true } },
	}
}

/**
 * Creates an AIService with all real-network/LLM calls stubbed out.
 * `processSession` is replaced with a function that immediately emits
 * the given response text, then fires `done` — just like the real path does.
 */
function makeAIService(responseText = 'sub-agent result text') {
	process.env.OPENAI_API_KEY = 'sk-test'
	writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(makeConfig()))

	const bridgeManager = new BridgeManager()
	const aiService = new AIService(bridgeManager)

	const m = aiService as any
	m.refreshTools = async () => {}
	m.activeTools = {}
	m.toolDocs = ''

	// Track dispatched bridge events per channelId
	const bridgeEvents: DaemonEvent[] = []
	;(bridgeManager as any).dispatchEvent = async (
		_channelId: string,
		event: DaemonEvent,
		_ctx: any
	) => {
		bridgeEvents.push(event)
	}

	// Replace processSession with a lightweight simulation that emits start→chunk→done.
	// For parent/non-sub-agent sessions we return early so queue items stay visible to tests.
	m.processSession = async (session: any) => {
		if (!session.isSubagent) {
			// Parent sessions: don't consume the queue in tests — lets assertions inspect it
			return
		}
		if (session.processing || session.queue.length === 0) return
		session.processing = true
		session.queue.shift() // consume the job
		session.emitter.emit('event', { type: 'start', sessionId: session.id })
		session.emitter.emit('event', { type: 'chunk', text: responseText })
		session.emitter.emit('event', { type: 'done', sessionId: session.id, suppressed: false })
		// Simulate the subagent auto-finish logic from the real processSession
		if (session.isSubagent && session.parentSessionId) {
			session.subagentStatus = 'completed'
			session.completedAt = new Date()
			const parentSession = (aiService as any).sessions.get(session.parentSessionId)
			if (parentSession) {
				if (session.channelId !== 'terminal') {
					await bridgeManager.dispatchEvent(session.channelId, {
						type: 'subagent-status',
						subagentId: session.id,
						task: session.task || 'sub-task',
						status: 'completed',
						message: session.task || 'sub-task',
					}, session)
				}
				if (!session.subagentCallbackCalled) {
					await (aiService as any).reportSubagentResult(session.id, {
						task: session.task || 'sub-task',
						status: 'completed',
						outcome: responseText,
					})
				}
			}
		}
		session.processing = false
	}

	return { aiService, bridgeManager, bridgeEvents }
}

// ── 1. Session creation fields ────────────────────────────────────────────────

describe('Sub-agent session creation fields', () => {
	beforeEach(() => {
		writeFileSync(process.env.TAMIAS_CONFIG_PATH!, JSON.stringify(makeConfig()))
	})

	test('non-sub-agent session has no lifecycle fields', () => {
		const { aiService } = makeAIService()
		const session = aiService.createSession({ channelId: 'terminal' })
		expect(session.isSubagent).toBe(false)
		expect(session.subagentStatus).toBeUndefined()
		expect(session.task).toBeUndefined()
		expect(session.spawnedAt).toBeUndefined()
	})

	test('sub-agent session sets isSubagent, subagentStatus=pending, spawnedAt, task', () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'chan-1' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'chan-1',
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'Summarise the docs',
		})
		expect(sub.isSubagent).toBe(true)
		expect(sub.parentSessionId).toBe(parent.id)
		expect(sub.task).toBe('Summarise the docs')
		expect(sub.subagentStatus).toBe('pending')
		expect(sub.spawnedAt).toBeInstanceOf(Date)
		expect(sub.completedAt).toBeUndefined()
	})

	test('sub-agent without task still initialises with pending status', () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({
			parentSessionId: parent.id,
			isSubagent: true,
		})
		expect(sub.subagentStatus).toBe('pending')
		expect(sub.task).toBeUndefined()
	})
})

// ── 2. attachBridgeListeners — sub-agent suppresses raw chunks ────────────────

describe('attachBridgeListeners — sub-agent output suppression', () => {
	test('sub-agent start event emits subagent-status:started to bridge, no raw chunks', async () => {
		const { aiService, bridgeEvents } = makeAIService()

		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'user-1' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'user-1',
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'Find top 3 files',
		})

		// Manually emit start to trigger attachBridgeListeners
		sub.emitter.emit('event', { type: 'start', sessionId: sub.id } as DaemonEvent)

		// Wait for the async dispatchEvent (it's .catch'd, so microtask)
		await new Promise(r => setTimeout(r, 10))

		const statusEvents = bridgeEvents.filter(e => e.type === 'subagent-status')
		expect(statusEvents).toHaveLength(1)
		const started = statusEvents[0] as any
		expect(started.status).toBe('started')
		expect(started.task).toBe('Find top 3 files')
		expect(started.subagentId).toBe(sub.id)

		// Chunks should NOT be forwarded to bridge
		sub.emitter.emit('event', { type: 'chunk', text: 'some internal thinking...' } as DaemonEvent)
		await new Promise(r => setTimeout(r, 10))
		const chunkEvents = bridgeEvents.filter(e => e.type === 'chunk')
		expect(chunkEvents).toHaveLength(0)
	})

	test('non-sub-agent session forwards chunks to bridge as normal', async () => {
		const { aiService, bridgeManager } = makeAIService()

		const capturedEvents: DaemonEvent[] = []
		;(bridgeManager as any).dispatchEvent = async (_: string, evt: DaemonEvent) => {
			capturedEvents.push(evt)
		}

		const session = aiService.createSession({ channelId: 'discord', channelUserId: 'u2' })
		session.emitter.emit('event', { type: 'start', sessionId: session.id })
		session.emitter.emit('event', { type: 'chunk', text: 'Hello world' })
		session.emitter.emit('event', { type: 'done', sessionId: session.id, suppressed: false })
		await new Promise(r => setTimeout(r, 10))

		const chunks = capturedEvents.filter(e => e.type === 'chunk')
		expect(chunks.length).toBeGreaterThan(0)
	})
})

// ── 3. reportSubagentResult — parent injection ────────────────────────────────

describe('reportSubagentResult — parent notification', () => {
	test('injects structured markdown report into parent session queue', async () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'Find security issues',
		})

		await (aiService as any).reportSubagentResult(sub.id, {
			task: 'Find security issues',
			status: 'completed',
			outcome: 'Found 2 issues in auth.ts',
		})

		// Parent should have an item queued
		expect(parent.queue.length).toBe(1)
		const msg = parent.queue[0].content as string
		expect(msg).toContain('### 🧠 Sub-agent Report')
		expect(msg).toContain('Find security issues')
		expect(msg).toContain('✅ completed')
		expect(msg).toContain('Found 2 issues in auth.ts')
	})

	test('report includes continuation instruction for the main AI', async () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({ parentSessionId: parent.id, isSubagent: true, task: 't' })

		await (aiService as any).reportSubagentResult(sub.id, {
			task: 't',
			status: 'completed',
			outcome: 'done',
		})

		const msg = parent.queue[0].content as string
		expect(msg).toContain('integrate')
		expect(msg).toContain('continue')
	})

	test('failed status uses ❌ icon', async () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({ parentSessionId: parent.id, isSubagent: true })

		await (aiService as any).reportSubagentResult(sub.id, {
			task: 'risky task',
			status: 'failed',
			reason: 'network timeout',
		})

		const msg = parent.queue[0].content as string
		expect(msg).toContain('❌ failed')
		expect(msg).toContain('network timeout')
	})

	test('context is serialised as JSON block', async () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({ parentSessionId: parent.id, isSubagent: true })

		await (aiService as any).reportSubagentResult(sub.id, {
			task: 't',
			status: 'completed',
			context: { filesChanged: 3 },
		})

		const msg = parent.queue[0].content as string
		expect(msg).toContain('```json')
		expect(msg).toContain('"filesChanged": 3')
	})

	test('report metadata source is subagent-report', async () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({ parentSessionId: parent.id, isSubagent: true })

		await (aiService as any).reportSubagentResult(sub.id, {
			task: 't',
			status: 'completed',
		})

		expect(parent.queue[0].metadata?.source).toBe('subagent-report')
	})

	test('does nothing if session has no parentSessionId', async () => {
		const { aiService } = makeAIService()
		const orphan = aiService.createSession({ channelId: 'terminal' })

		// Should not throw
		await (aiService as any).reportSubagentResult(orphan.id, {
			task: 't',
			status: 'completed',
		})
		// No parent to push into
	})
})

// ── 4. markSubagentCallbackCalled — prevents double-reporting ─────────────────

describe('markSubagentCallbackCalled', () => {
	test('sets subagentCallbackCalled flag on session', () => {
		const { aiService } = makeAIService()
		const session = aiService.createSession({ isSubagent: true })
		expect((session as any).subagentCallbackCalled).toBeFalsy()
		aiService.markSubagentCallbackCalled(session.id)
		expect((session as any).subagentCallbackCalled).toBe(true)
	})

	test('auto-finish does not double-inject when callback already called', async () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'task',
		})

		// Simulate the sub-agent explicitly calling callback
		aiService.markSubagentCallbackCalled(sub.id)

		// Simulate auto-finish path (which checks the flag)
		if (!sub.subagentCallbackCalled) {
			await (aiService as any).reportSubagentResult(sub.id, {
				task: 'task',
				status: 'completed',
				outcome: 'auto-injected',
			})
		}

		// Parent queue should be empty — callback already handled it
		expect(parent.queue.length).toBe(0)
	})
})

// ── 5. updateSubagentProgress ─────────────────────────────────────────────────

describe('updateSubagentProgress', () => {
	test('updates session.progress and emits subagent-status:progress to bridge', async () => {
		const capturedEvents: DaemonEvent[] = []
		const { aiService, bridgeManager } = makeAIService()
		;(bridgeManager as any).dispatchEvent = async (_: string, evt: DaemonEvent) => {
			capturedEvents.push(evt)
		}

		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'u3' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'u3',
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'Long task',
		})

		aiService.updateSubagentProgress(sub.id, 'Halfway through 10 files')
		await new Promise(r => setTimeout(r, 10))

		expect(sub.progress).toBe('Halfway through 10 files')
		const progressEvents = capturedEvents.filter(e => e.type === 'subagent-status') as any[]
		expect(progressEvents).toHaveLength(1)
		expect(progressEvents[0].status).toBe('progress')
		expect(progressEvents[0].message).toBe('Halfway through 10 files')
		expect(progressEvents[0].task).toBe('Long task')
	})

	test('does nothing for non-sub-agent sessions', () => {
		const { aiService } = makeAIService()
		const session = aiService.createSession({ channelId: 'terminal' })
		// Should not throw, and session.progress remains undefined
		aiService.updateSubagentProgress(session.id, 'ignored')
		expect(session.progress).toBeUndefined()
	})

	test('does nothing for terminal sub-agents (no channel to notify)', async () => {
		const capturedEvents: DaemonEvent[] = []
		const { aiService, bridgeManager } = makeAIService()
		;(bridgeManager as any).dispatchEvent = async (_: string, evt: DaemonEvent) => {
			capturedEvents.push(evt)
		}

		const parent = aiService.createSession({ channelId: 'terminal' })
		const sub = aiService.createSession({
			channelId: 'terminal',
			parentSessionId: parent.id,
			isSubagent: true,
		})

		aiService.updateSubagentProgress(sub.id, 'progress update')
		await new Promise(r => setTimeout(r, 10))
		expect(capturedEvents).toHaveLength(0)
	})
})

// ── 6. Auto-finish: completed sub-agent emits subagent-status + notifies parent ──

describe('Auto-finish: sub-agent lifecycle via simulated processSession', () => {
	test('sub-agent completes → subagent-status:completed sent to bridge + report queued in parent', async () => {
		const capturedBridgeEvents: DaemonEvent[] = []
		const { aiService, bridgeManager } = makeAIService('The answer is 42')
		;(bridgeManager as any).dispatchEvent = async (_: string, evt: DaemonEvent) => {
			capturedBridgeEvents.push(evt)
		}

		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'ux' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'ux',
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'Count to 42',
		})

		// Trigger processSession (stubbed in makeAIService to simulate full run)
		await aiService.enqueueMessage(sub.id, 'start working')
		await new Promise(r => setTimeout(r, 50))

		// Bridge should have received subagent-status:started (from attachBridgeListeners)
		// and subagent-status:completed (from the processSession auto-finish stub)
		const statusEvents = capturedBridgeEvents.filter(e => e.type === 'subagent-status') as any[]
		const statuses = statusEvents.map(e => e.status)
		expect(statuses).toContain('started')
		expect(statuses).toContain('completed')

		// Parent should have the report queued
		expect(parent.queue.length).toBe(1)
		const report = parent.queue[0].content as string
		expect(report).toContain('Count to 42')
		expect(report).toContain('✅ completed')
		expect(report).toContain('The answer is 42')
	})

	test('sub-agent callback already called → no auto-inject into parent', async () => {
		const { aiService, bridgeManager } = makeAIService('result')
		;(bridgeManager as any).dispatchEvent = async () => {}

		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'uy' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'uy',
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'task',
		})

		// Mark callback as already called before processSession finishes
		aiService.markSubagentCallbackCalled(sub.id)

		await aiService.enqueueMessage(sub.id, 'go')
		await new Promise(r => setTimeout(r, 50))

		// Parent queue should still be empty (callback handled it, auto-finish skipped)
		expect(parent.queue.length).toBe(0)
	})
})

// ── 7. DaemonEvent type — subagent-status shape ───────────────────────────────

describe('DaemonEvent subagent-status type', () => {
	test('subagent-status event satisfies the DaemonEvent union', () => {
		const evt: DaemonEvent = {
			type: 'subagent-status',
			subagentId: 'sub_abc',
			task: 'Do something',
			status: 'progress',
			message: 'Step 2 of 5',
		}
		expect(evt.type).toBe('subagent-status')
		expect((evt as any).status).toBe('progress')
		expect((evt as any).message).toBe('Step 2 of 5')
	})

	test('all status values are valid', () => {
		const statuses: Array<'started' | 'progress' | 'completed' | 'failed'> = [
			'started', 'progress', 'completed', 'failed',
		]
		for (const status of statuses) {
			const evt: DaemonEvent = {
				type: 'subagent-status',
				subagentId: 'x',
				task: 'y',
				status,
				message: status,
			}
			expect(evt.type).toBe('subagent-status')
		}
	})
})

// ── 8. bridgeSessionMap — sub-agents must not overwrite parent entry ──────────

describe('bridgeSessionMap isolation', () => {
	test('parent session is registered in bridgeSessionMap', () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'u99' })
		const mapped = aiService.getSessionForBridge('discord', 'u99')
		expect(mapped?.id).toBe(parent.id)
	})

	test('sub-agent does NOT overwrite parent session in bridgeSessionMap', () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'u99' })

		// Spawn a sub-agent with the same channelId/channelUserId
		aiService.createSession({
			channelId: 'discord',
			channelUserId: 'u99',
			parentSessionId: parent.id,
			isSubagent: true,
			task: 'Some task',
		})

		// The map must still point to the parent, not the sub-agent
		const mapped = aiService.getSessionForBridge('discord', 'u99')
		expect(mapped?.id).toBe(parent.id)
		expect(mapped?.isSubagent).toBe(false)
	})

	test('multiple sub-agents with same channel do not break parent mapping', () => {
		const { aiService } = makeAIService()
		const parent = aiService.createSession({ channelId: 'telegram', channelUserId: 'tg-1' })

		aiService.createSession({ channelId: 'telegram', channelUserId: 'tg-1', parentSessionId: parent.id, isSubagent: true, task: 'Task A' })
		aiService.createSession({ channelId: 'telegram', channelUserId: 'tg-1', parentSessionId: parent.id, isSubagent: true, task: 'Task B' })

		const mapped = aiService.getSessionForBridge('telegram', 'tg-1')
		expect(mapped?.id).toBe(parent.id)
	})
})

// ── 9. Task truncation ────────────────────────────────────────────────────────

describe('Task truncation in sub-agent notifications', () => {
	test('subagent-status started event shows truncated task (≤80 chars)', async () => {
		const { aiService, bridgeEvents } = makeAIService()
		const longTask = 'A'.repeat(200)

		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'u-trunc' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'u-trunc',
			parentSessionId: parent.id,
			isSubagent: true,
			task: longTask,
		})

		sub.emitter.emit('event', { type: 'start', sessionId: sub.id } as DaemonEvent)
		await new Promise(r => setTimeout(r, 10))

		const started = bridgeEvents.find(e => e.type === 'subagent-status' && (e as any).status === 'started') as any
		expect(started).toBeDefined()
		expect(started.task.length).toBeLessThanOrEqual(81) // 80 chars + '…'
		expect(started.task.endsWith('…')).toBe(true)
	})

	test('short task is not truncated', async () => {
		const { aiService, bridgeEvents } = makeAIService()
		const shortTask = 'Find the bug in auth.ts'

		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'u-short' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'u-short',
			parentSessionId: parent.id,
			isSubagent: true,
			task: shortTask,
		})

		sub.emitter.emit('event', { type: 'start', sessionId: sub.id } as DaemonEvent)
		await new Promise(r => setTimeout(r, 10))

		const started = bridgeEvents.find(e => e.type === 'subagent-status' && (e as any).status === 'started') as any
		expect(started?.task).toBe(shortTask)
	})

	test('multiline task shows only first line', async () => {
		const { aiService, bridgeEvents } = makeAIService()
		const multilineTask = 'First line of task\nSecond line\nThird line'

		const parent = aiService.createSession({ channelId: 'discord', channelUserId: 'u-multi' })
		const sub = aiService.createSession({
			channelId: 'discord',
			channelUserId: 'u-multi',
			parentSessionId: parent.id,
			isSubagent: true,
			task: multilineTask,
		})

		sub.emitter.emit('event', { type: 'start', sessionId: sub.id } as DaemonEvent)
		await new Promise(r => setTimeout(r, 10))

		const started = bridgeEvents.find(e => e.type === 'subagent-status' && (e as any).status === 'started') as any
		expect(started?.task).toBe('First line of task')
		expect(started?.task).not.toContain('\n')
	})
})
