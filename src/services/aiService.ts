import { EventEmitter } from 'events'
import { streamText, generateText, stepCountIs } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { loadConfig, getApiKeyForConnection, type ConnectionConfig, getDefaultModel } from '../utils/config'
import { buildActiveTools } from '../utils/toolRegistry'
import { buildSystemPrompt, updatePersonaFiles, scaffoldFromTemplates } from '../utils/memory'
import { saveSessionToDisk, type SessionPersist, listAllStoredSessions, loadSessionFromDisk } from '../utils/sessions'
import { logAiRequest } from '../utils/logger'
import type { DaemonEvent, BridgeMessage } from '../bridge/types'
import { BridgeManager } from '../bridge'

export interface MessageJob {
	sessionId: string
	content: string
}

export interface Session {
	id: string
	name?: string
	model: string
	connectionNickname: string
	modelId: string
	createdAt: Date
	updatedAt: Date
	queue: MessageJob[]
	processing: boolean
	messages: Array<{ role: 'user' | 'assistant'; content: string }>
	summary?: string
	emitter: EventEmitter
	heartbeatTimer: ReturnType<typeof setInterval> | null
	channelId: string
	channelUserId?: string
}

export class AIService {
	private sessions = new Map<string, Session>()
	private bridgeSessionMap = new Map<string, string>()
	private activeTools: Record<string, unknown> = {}
	private mcpClients: Array<{ close: () => Promise<void> }> = []
	private bridgeManager: BridgeManager

	constructor(bridgeManager: BridgeManager) {
		this.bridgeManager = bridgeManager
	}

	public async initialize() {
		scaffoldFromTemplates()
		this.loadAllSessions()
		try {
			const { tools, mcpClients } = await buildActiveTools()
			this.activeTools = tools
			this.mcpClients = mcpClients
		} catch (err) {
			console.error('[AIService] Failed to load tools:', err)
		}
	}

	private loadAllSessions() {
		const stored = listAllStoredSessions()
		for (const s of stored) {
			const full = loadSessionFromDisk(s.id, s.monthDir)
			if (full) {
				const [nickname, ...rest] = full.model.split('/')
				const session: Session = {
					id: full.id,
					name: full.name,
					model: full.model,
					connectionNickname: nickname,
					modelId: rest.join('/'),
					createdAt: new Date(full.createdAt),
					updatedAt: new Date(full.updatedAt),
					queue: [],
					processing: false,
					messages: full.messages,
					summary: full.summary,
					emitter: new EventEmitter(),
					heartbeatTimer: null,
					channelId: 'terminal', // default
				}
				this.sessions.set(full.id, session)
			}
		}
	}

	public getSession(id: string): Session | undefined {
		return this.sessions.get(id)
	}

	public getAllSessions() {
		return [...this.sessions.values()]
	}

	public createSession(options: { model?: string; channelId?: string; channelUserId?: string }): Session {
		const config = loadConfig()
		const modelStr = options.model ?? getDefaultModel() ?? Object.keys(config.connections)[0] // simplified fallback
		const [nickname, ...rest] = modelStr.split('/')
		const modelId = rest.join('/')

		const session: Session = {
			id: `sess_${Math.random().toString(36).slice(2, 10)}`,
			model: modelStr,
			connectionNickname: nickname,
			modelId,
			createdAt: new Date(),
			updatedAt: new Date(),
			queue: [],
			processing: false,
			messages: [],
			emitter: new EventEmitter(),
			heartbeatTimer: null,
			channelId: options.channelId || 'terminal',
			channelUserId: options.channelUserId,
		}

		if (session.channelId !== 'terminal') {
			const buffer: string[] = []
			session.emitter.on('event', (evt: DaemonEvent) => {
				if (evt.type === 'chunk') {
					buffer.push(evt.text)
					return
				}
				if (evt.type === 'done') {
					if (!evt.suppressed) {
						// Flush buffer
						for (const chunk of buffer) {
							this.bridgeManager.dispatchEvent(session.channelId, { type: 'chunk', text: chunk }, session).catch(console.error)
						}
					}
					this.bridgeManager.dispatchEvent(session.channelId, evt, session).catch(console.error)
					buffer.length = 0 // clear
					return
				}
				this.bridgeManager.dispatchEvent(session.channelId, evt, session).catch(console.error)
			})
		}

		this.sessions.set(session.id, session)
		if (options.channelId && options.channelUserId) {
			this.bridgeSessionMap.set(`${options.channelId}:${options.channelUserId}`, session.id)
		}

		return session
	}

	public deleteSession(id: string) {
		const session = this.sessions.get(id)
		if (session) {
			if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
			session.emitter.removeAllListeners('event')
			this.sessions.delete(id)
		}
	}

	public getSessionForBridge(channelId: string, channelUserId: string): Session | undefined {
		const sessionId = this.bridgeSessionMap.get(`${channelId}:${channelUserId}`)
		return sessionId ? this.sessions.get(sessionId) : undefined
	}

	public async enqueueMessage(sessionId: string, content: string) {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error('Session not found')
		session.queue.push({ sessionId, content })
		this.processSession(session).catch(console.error)
	}

	private async processSession(session: Session) {
		if (session.processing || session.queue.length === 0) return
		session.processing = true

		const job = session.queue.shift()!
		session.messages.push({ role: 'user', content: job.content })

		const config = loadConfig()
		const connection = config.connections[session.connectionNickname]
		if (!connection) {
			session.processing = false
			return
		}

		try {
			const model = this.buildModel(connection, session.modelId)
			const toolNamesList = Object.keys(this.activeTools)
			const systemPrompt = buildSystemPrompt(toolNamesList, session.summary)

			session.emitter.emit('event', { type: 'start', sessionId: session.id } as DaemonEvent)

			const startTime = Date.now()
			const result = streamText({
				model,
				system: systemPrompt,
				messages: session.messages,
				tools: toolNamesList.length > 0 ? (this.activeTools as any) : undefined,
				stopWhen: stepCountIs(20),
				onStepFinish: async ({ toolCalls }) => {
					if (toolCalls?.length) {
						for (const tc of toolCalls) {
							session.emitter.emit('event', { type: 'tool_call', name: tc.toolName, input: (tc as any).input ?? {} } as DaemonEvent)
						}
					}
				},
			})

			let fullResponse = ''
			let suppressed = false

			for await (const chunk of result.textStream) {
				fullResponse += chunk
				// If the very first chunk (or accumulation) starts with HEARTBEAT_OK, we might consider suppressing.
				// But let's check the full response for simplicity first, or just start streaming.
				session.emitter.emit('event', { type: 'chunk', text: chunk } as DaemonEvent)
			}

			// Heartbeat suppression logic
			if (fullResponse.trim() === 'HEARTBEAT_OK') {
				suppressed = true
				// We already sent the chunks via SSE, but for Bridges we might want to handle it differently.
				// Actually, HEARTBEAT_OK is intended to be internal.
			}

			const usage = await Promise.race([
				result.usage,
				new Promise(resolve => setTimeout(() => resolve({}), 2000))
			]).catch(() => ({})) as any

			logAiRequest({
				timestamp: new Date().toISOString(),
				sessionId: session.id,
				model: session.model,
				provider: session.connectionNickname,
				action: 'chat',
				durationMs: Date.now() - startTime,
				tokens: {
					prompt: usage?.inputTokens,
					completion: usage?.outputTokens,
					total: usage?.totalTokens,
				},
				messages: [
					{ role: 'system', content: systemPrompt },
					...session.messages,
				],
				response: fullResponse,
			})

			session.messages.push({ role: 'assistant', content: fullResponse })
			session.updatedAt = new Date()
			saveSessionToDisk(this.toPersist(session))

			session.emitter.emit('event', { type: 'done', sessionId: session.id, suppressed } as DaemonEvent)

			if (session.messages.length >= 20) {
				this.compactSession(session, model).then(() => {
					saveSessionToDisk(this.toPersist(session))
				}).catch(() => { })
			}
		} catch (err) {
			session.emitter.emit('event', { type: 'error', message: String(err) } as DaemonEvent)
		} finally {
			session.processing = false
			if (session.queue.length > 0) {
				setImmediate(() => this.processSession(session))
			}
		}
	}

	private buildModel(connection: ConnectionConfig, modelId: string) {
		const apiKey = getApiKeyForConnection(connection.nickname)
		switch (connection.provider) {
			case 'openai': return createOpenAI({ apiKey })(modelId)
			case 'anthropic': return createAnthropic({ apiKey })(modelId) as any
			case 'google': return createGoogleGenerativeAI({ apiKey })(modelId) as any
			case 'openrouter': return createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey })(modelId)
			case 'ollama': {
				let baseURL = (connection as any).baseUrl || 'http://127.0.0.1:11434'
				baseURL = baseURL.replace(/\/$/, '')
				if (!baseURL.endsWith('/v1')) baseURL += '/v1'
				return createOpenAI({ baseURL, apiKey: apiKey || 'ollama' })(modelId)
			}
			default: throw new Error(`Unsupported provider: ${connection.provider}`)
		}
	}

	private async compactSession(session: Session, model: any) {
		if (session.messages.length < 20) return
		try {
			const compactionPrompt = `You are a memory compaction agent... (summary omitted for brevity)`
			const { text } = await generateText({
				model,
				system: compactionPrompt,
				prompt: `Current history:\n${JSON.stringify(session.messages)}`,
			})
			const result = JSON.parse(text.replace(/```json\n?|\n?```/g, ''))
			session.summary = result.summary
			if (result.sessionName && (!session.name || session.name.startsWith('sess_'))) {
				session.name = result.sessionName
			}
			if (result.insights) updatePersonaFiles(result.insights)
			session.messages = session.messages.slice(-4)
		} catch (err) {
			console.error('Failed to compact session:', err)
		}
	}

	private toPersist(session: Session): SessionPersist {
		return {
			id: session.id,
			name: session.name,
			createdAt: session.createdAt.toISOString(),
			updatedAt: session.updatedAt.toISOString(),
			model: session.model,
			summary: session.summary,
			messages: session.messages,
		}
	}

	public async shutdown() {
		for (const client of this.mcpClients) await client.close().catch(() => { })
	}
}
