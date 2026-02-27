import { describe, expect, test } from 'bun:test'
import type { Session } from '../services/aiService.ts'

type MockJob = { sessionId: string; content: string; authorName?: string }

function makeSession(partial: Partial<Session> & { id: string }): Session {
	return {
		id: partial.id,
		model: partial.model ?? 'openai/gpt-4o',
		connectionNickname: partial.connectionNickname ?? 'openai',
		modelId: partial.modelId ?? 'gpt-4o',
		createdAt: partial.createdAt ?? new Date(),
		updatedAt: partial.updatedAt ?? new Date(),
		queue: partial.queue ?? [],
		processing: partial.processing ?? false,
		messages: partial.messages ?? [],
		emitter: partial.emitter ?? ({} as any),
		heartbeatTimer: partial.heartbeatTimer ?? null,
		channelId: partial.channelId ?? 'terminal',
		channelUserId: partial.channelUserId,
		channelName: partial.channelName,
		name: partial.name,
		summary: partial.summary,
		parentSessionId: partial.parentSessionId,
		isSubagent: partial.isSubagent,
		task: partial.task,
		taskSlug: partial.taskSlug,
		subagentStatus: partial.subagentStatus,
		spawnedAt: partial.spawnedAt,
		completedAt: partial.completedAt,
		progress: partial.progress,
		subagentCallbackCalled: partial.subagentCallbackCalled,
		agentId: partial.agentId,
		agentSlug: partial.agentSlug,
		agentDir: partial.agentDir,
		projectSlug: partial.projectSlug,
	}
}

function makeMockAI() {
	const sessions = new Map<string, Session>()
	let nextId = 0

	const parent = makeSession({
		id: 'parent_sess',
		channelId: 'discord',
		channelUserId: 'u_123',
		channelName: 'general',
	})
	sessions.set(parent.id, parent)

	return {
		sessions,
		getSession: (id: string) => sessions.get(id),
		createSession: (options: Partial<Session> & { model?: string; channelId?: string; channelUserId?: string; channelName?: string }) => {
			nextId += 1
			const created = makeSession({
				id: `sess_${nextId}`,
				model: options.model ?? 'openai/gpt-4o',
				channelId: options.channelId,
				channelUserId: options.channelUserId,
				channelName: options.channelName,
			})
			sessions.set(created.id, created)
			return created
		},
		enqueueMessage: async (sessionId: string, content: string, authorName?: string) => {
			const target = sessions.get(sessionId)
			if (!target) throw new Error('Session not found')
			;(target.queue as MockJob[]).push({ sessionId, content, authorName })
		},
	}
}

describe('Session Tools', () => {
	test('create_thread creates a session and inherits channel from current session', async () => {
		const { createSessionTools, SESSION_TOOL_NAME } = await import('../tools/session.ts')
		expect(SESSION_TOOL_NAME).toBe('session')

		const mockAI = makeMockAI()
		const tools = createSessionTools(mockAI as any, 'parent_sess')

		const result = await (tools.create_thread.execute as any)({
			initialMessage: 'hello new thread',
		})

		expect(result.success).toBe(true)
		expect(result.created).toBe(true)
		expect(result.enqueued).toBe(true)
		expect(result.threadId).toBe('sess_1')
		expect(result.streamPath).toBe('/session/sess_1/stream')

		const created = mockAI.getSession('sess_1')!
		expect(created.channelId).toBe('discord')
		expect(created.channelUserId).toBe('u_123')
		expect(created.channelName).toBe('general')
		expect(created.queue.length).toBe(1)
	})

	test('send_message defaults to current session when no threadId/sessionId provided', async () => {
		const { createSessionTools } = await import('../tools/session.ts')
		const mockAI = makeMockAI()
		const tools = createSessionTools(mockAI as any, 'parent_sess')

		const result = await (tools.send_message.execute as any)({
			message: 'message to current session',
		})

		expect(result.success).toBe(true)
		expect(result.enqueued).toBe(true)
		expect(result.threadId).toBe('parent_sess')
		expect(result.streamPath).toBe('/session/parent_sess/stream')
		expect(mockAI.getSession('parent_sess')!.queue.length).toBe(1)
	})

	test('send_message accepts sessionId alias and reports missing sessions safely', async () => {
		const { createSessionTools } = await import('../tools/session.ts')
		const mockAI = makeMockAI()
		const tools = createSessionTools(mockAI as any, 'parent_sess')

		const createResult = await (tools.create_thread.execute as any)({
			channelId: 'terminal',
		})
		expect(createResult.success).toBe(true)

		const aliasResult = await (tools.send_message.execute as any)({
			sessionId: createResult.threadId,
			message: 'hello alias',
			authorName: 'tester',
		})

		expect(aliasResult.success).toBe(true)
		expect(aliasResult.threadId).toBe(createResult.threadId)
		expect(mockAI.getSession(createResult.threadId)!.queue.length).toBe(1)

		const missingResult = await (tools.send_message.execute as any)({
			threadId: 'sess_missing',
			message: 'will fail',
		})

		expect(missingResult.success).toBe(false)
		expect(missingResult.error).toContain("Session 'sess_missing' not found")
	})
})
