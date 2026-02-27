import { tool } from 'ai'
import { z } from 'zod'
import type { AIService, Session } from '../services/aiService.ts'

export const SESSION_TOOL_NAME = 'session'
export const SESSION_TOOL_LABEL = '🧵 Session (create threads and route messages)'

function toThreadSuccess(session: Session) {
	return {
		success: true,
		threadId: session.id,
		streamPath: `/session/${session.id}/stream`,
		queue: {
			length: session.queue.length,
			processing: session.processing,
		},
	}
}

export function createSessionTools(aiService: AIService, sessionId: string) {
	return {

		create_thread: tool({
			description: 'Create a new thread/session, optionally overriding model/channel and enqueueing an initial message.',
			inputSchema: z.object({
				model: z.string().optional().describe('Optional model override, e.g. "openai/gpt-4o" or "nickname/modelId".'),
				channelId: z.string().optional().describe('Optional channel override (defaults to current session channel when available).'),
				channelUserId: z.string().optional().describe('Optional channel user identifier override.'),
				channelName: z.string().optional().describe('Optional channel display name override.'),
				initialMessage: z.string().optional().describe('Optional first message to enqueue immediately in the new thread.'),
			}),
			execute: async ({ model, channelId, channelUserId, channelName, initialMessage }) => {
				const current = aiService.getSession(sessionId)

				const created = aiService.createSession({
					model,
					channelId: channelId ?? current?.channelId,
					channelUserId: channelUserId ?? current?.channelUserId,
					channelName: channelName ?? current?.channelName,
				})

				if (initialMessage && initialMessage.trim()) {
					try {
						await aiService.enqueueMessage(created.id, initialMessage)
					} catch (err) {
						return { success: false, error: err instanceof Error ? err.message : String(err) }
					}
				}

				return {
					...toThreadSuccess(created),
					created: true,
					enqueued: !!(initialMessage && initialMessage.trim()),
				}
			},
		}),

		send_message: tool({
			description: 'Enqueue a message to a target thread/session. Accepts threadId or sessionId; defaults to current session.',
			inputSchema: z.object({
				threadId: z.string().optional().describe('Target thread identifier (alias of sessionId).'),
				sessionId: z.string().optional().describe('Target session identifier (alias of threadId).'),
				message: z.string().describe('Message content to enqueue.'),
				authorName: z.string().optional().describe('Optional author prefix.'),
			}),
			execute: async ({ threadId, sessionId: targetSessionId, message, authorName }) => {
				const resolvedThreadId = threadId ?? targetSessionId ?? sessionId
				const target = aiService.getSession(resolvedThreadId)

				if (!target) {
					return { success: false, error: `Session '${resolvedThreadId}' not found.` }
				}

				try {
					await aiService.enqueueMessage(target.id, message, authorName)
				} catch (err) {
					return { success: false, error: err instanceof Error ? err.message : String(err) }
				}

				return {
					...toThreadSuccess(target),
					enqueued: true,
				}
			},
		}),
	}
}
