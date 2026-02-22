import { EventEmitter } from 'events'
import { streamText, generateText, generateObject, stepCountIs } from 'ai'
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { loadConfig, getApiKeyForConnection, type ConnectionConfig, getDefaultModel, getDefaultModels } from '../utils/config'
import { buildActiveTools } from '../utils/toolRegistry'
import { buildSystemPrompt, updatePersonaFiles, scaffoldFromTemplates, readAllPersonaFiles } from '../utils/memory'
import { saveSessionToDisk, type SessionPersist, listAllStoredSessions, loadSessionFromDisk } from '../utils/sessions'
import { logAiRequest } from '../utils/logger'
import type { DaemonEvent, BridgeMessage } from '../bridge/types'
import { BridgeManager } from '../bridge'

export interface MessageJob {
	sessionId: string
	content: string
	authorName?: string
	attachments?: BridgeMessage['attachments']
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
	messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
	summary?: string
	emitter: EventEmitter
	heartbeatTimer: ReturnType<typeof setInterval> | null
	channelId: string
	channelUserId?: string
	channelName?: string
	parentSessionId?: string
	isSubagent?: boolean
}

export interface CreateSessionOptions {
	model?: string
	channelId?: string
	channelUserId?: string
	channelName?: string
	parentSessionId?: string
	isSubagent?: boolean
	id?: string
}

export class AIService {
	private sessions = new Map<string, Session>()
	private bridgeSessionMap = new Map<string, string>()
	private activeTools: Record<string, unknown> = {}
	private mcpClients: Array<{ close: () => Promise<void> }> = []
	private toolDocs = ''
	private bridgeManager: BridgeManager

	constructor(bridgeManager: BridgeManager) {
		this.bridgeManager = bridgeManager
	}

	public async initialize() {
		scaffoldFromTemplates()
		this.loadAllSessions()
		// We can't refresh tools globally anymore since it depends on sessionId
	}

	public async refreshTools(sessionId: string) {
		try {
			const { tools, mcpClients, toolDocs } = await buildActiveTools(this, sessionId)
			this.activeTools = tools
			this.toolDocs = toolDocs
			// Close old clients before replacing
			for (const c of this.mcpClients) await c.close().catch(() => { })
			this.mcpClients = mcpClients
		} catch (err) {
			console.error('[AIService] Failed to load tools:', err)
		}
	}

	private loadAllSessions() {
		const stored = listAllStoredSessions()
		for (const s of stored) {
			const full = loadSessionFromDisk(s.id)
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
					channelId: full.channelId || 'terminal',
					channelUserId: full.channelUserId,
					channelName: full.channelName,
					parentSessionId: (full as any).parentSessionId,
					isSubagent: (full as any).isSubagent || false,
				}
				this.sessions.set(full.id, session)
				if (session.channelId && session.channelUserId) {
					this.bridgeSessionMap.set(`${session.channelId}:${session.channelUserId}`, session.id)
				}
				this.attachBridgeListeners(session)
			}
		}
	}

	public getSession(id: string): Session | undefined {
		return this.sessions.get(id)
	}

	public getAllSessions() {
		return [...this.sessions.values()]
	}

	public getSessionForBridge(channelId: string, channelUserId: string): Session | undefined {
		const sessionId = this.bridgeSessionMap.get(`${channelId}:${channelUserId}`)
		return sessionId ? this.sessions.get(sessionId) : undefined
	}

	public createSession(options: CreateSessionOptions): Session {
		const modelStr = options.model ?? getDefaultModel() ?? 'openai/gpt-4o'
		const [nickname, ...rest] = modelStr.split('/')
		const modelId = rest.join('/') || modelStr

		const session: Session = {
			id: options.id ?? `sess_${Math.random().toString(36).slice(2, 10)}`,
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
			channelName: options.channelName,
			parentSessionId: options.parentSessionId,
			isSubagent: options.isSubagent || false,
		}

		if (session.channelId && session.channelUserId) {
			this.bridgeSessionMap.set(`${session.channelId}:${session.channelUserId}`, session.id)
		}

		this.attachBridgeListeners(session)
		this.sessions.set(session.id, session)
		return session
	}

	private attachBridgeListeners(session: Session) {
		if (session.channelId === 'terminal') return

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

	public deleteSession(id: string) {
		const session = this.sessions.get(id)
		if (session) {
			if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
			session.emitter.removeAllListeners('event')
			this.sessions.delete(id)
		}
	}

	public async enqueueMessage(sessionId: string, content: string, authorName?: string, attachments?: BridgeMessage['attachments']) {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error('Session not found')
		session.queue.push({ sessionId, content, authorName, attachments })
		this.processSession(session).catch(console.error)
	}

	private async processSession(session: Session) {
		if (session.processing || session.queue.length === 0) return
		session.processing = true

		const job = session.queue.shift()!
		let messageContent = job.authorName ? `[${job.authorName}]: ${job.content}` : job.content

		// Handle attachments (especially text files)
		if (job.attachments && job.attachments.length > 0) {
			for (const att of job.attachments) {
				if (att.type === 'file' && att.buffer && (att.mimeType.startsWith('text/') || att.mimeType === 'application/json' || att.mimeType === 'application/javascript' || att.mimeType === 'application/typescript' || att.mimeType === 'application/octet-stream')) {
					// Check if it looks like text even if octet-stream
					const text = att.buffer.toString('utf-8')
					// Rough check for binary
					const isLikelyText = !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text.slice(0, 1024))
					if (isLikelyText) {
						messageContent += `\n\n--- ATTACHED FILE: ${att.url?.split('/').pop() || 'unknown'} ---\n${text}\n--- END ATTACHED FILE ---`
					}
				}
			}
		}

		session.messages.push({ role: 'user', content: messageContent })

		const config = loadConfig()
		// Priority: Current default models -> session's persisted model -> hardcoded safety fallbacks
		// We avoid anything starting with 'lc-openai' if it's not actually configured, as it's from another machine.
		const currentDefaults = getDefaultModels()
		const fallbacks = ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet', 'google/gemini-pro']
		const modelsToTry = [
			...currentDefaults,
			session.model,
			...fallbacks
		].filter((m, i, arr) => {
			if (!m) return false
			if (arr.indexOf(m) !== i) return false
			const [nick] = m.split('/')
			// If we don't have this connection configured, skip it entirely.
			// This avoids "No connection found" errors for old models from other machines.
			if (!config.connections[nick] && !fallbacks.includes(m)) {
				if (nick === 'lc-openai') {
					console.log(`[AIService] Skipping dead connection "${nick}" from another computer.`)
				}
				return false
			}
			return true
		})
		let lastError: any = null

		for (const currentModelStr of modelsToTry) {
			const [nickname, ...rest] = currentModelStr.split('/')
			const modelId = rest.join('/') || currentModelStr
			const connection = config.connections[nickname]

			if (!connection) {
				lastError = new Error(`No AI connection configured for "${nickname}"`)
				continue
			}

			console.log(`[AIService] Attempting processing for session ${session.id} via ${currentModelStr}`)

			try {
				await this.refreshTools(session.id)
				const model = this.buildModel(connection, modelId)
				const toolNamesList = Object.keys(this.activeTools)
				const systemPrompt = buildSystemPrompt(toolNamesList, this.toolDocs, session.summary, {
					id: session.channelId,
					userId: session.channelUserId,
					name: session.channelName,
					authorName: job.authorName,
					isSubagent: session.isSubagent
				})

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
					session.emitter.emit('event', { type: 'chunk', text: chunk } as DaemonEvent)
				}

				if (fullResponse.trim() === 'HEARTBEAT_OK') {
					suppressed = true
				}

				// If we successfuly used a fallback model, update the session so it sticks
				if (session.model !== currentModelStr) {
					console.log(`[AIService] Permanently updating session ${session.id} model from ${session.model} to ${currentModelStr}`)
					session.model = currentModelStr
					const { saveSessionToDisk } = await import('../utils/sessions.ts')
					saveSessionToDisk(this.toPersist(session))
				}

				const usage = await Promise.race([
					result.usage,
					new Promise(resolve => setTimeout(() => resolve({}), 2000))
				]).catch(() => ({})) as any

				logAiRequest({
					timestamp: new Date().toISOString(),
					sessionId: session.id,
					model: currentModelStr,
					provider: nickname,
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

				// Update session model if it was a fallback
				if (currentModelStr !== session.model) {
					session.model = currentModelStr
					session.modelId = modelId
					session.connectionNickname = nickname
				}

				saveSessionToDisk(this.toPersist(session))
				session.emitter.emit('event', { type: 'done', sessionId: session.id, suppressed } as DaemonEvent)

				// If this is a subagent, report back to parent session if it exists
				if (session.isSubagent && session.parentSessionId) {
					const parentSession = this.sessions.get(session.parentSessionId)
					if (parentSession) {
						const report = `[Subagent Report from ${session.id}]:\n${fullResponse}`
						this.enqueueMessage(parentSession.id, report).catch(console.error)
					}
				}

				if (session.messages.length >= 20) {
					this.compactSession(session, model).then(() => {
						saveSessionToDisk(this.toPersist(session))
					}).catch(() => { })
				}

				session.processing = false
				if (session.queue.length > 0) {
					setImmediate(() => this.processSession(session))
				}
				return // Success!
			} catch (err: any) {
				console.error(`[AIService] Failed with model ${currentModelStr}:`, err)
				lastError = err
				// Continue to next model
			}
		}

		// If we get here, all models failed
		console.error(`[AIService] All models failed for session ${session.id}:`, lastError)
		session.emitter.emit('event', { type: 'error', message: `All AI models failed. Last error: ${String(lastError)}` } as DaemonEvent)
		session.processing = false
		if (session.queue.length > 0) {
			setImmediate(() => this.processSession(session))
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
		const startTime = Date.now()
		try {
			const personaFiles = readAllPersonaFiles()
			const existingContext = Object.entries(personaFiles)
				.map(([file, content]) => `### ${file}\n${content}`)
				.join('\n\n')

			const compactionPrompt = `You are a memory compaction agent for Tamias, an AI coding assistant.
Your goal is to summarize the current conversation and extract new, IMPORTANT insights about the user to keep their persona files up-to-date.

# Existing Persona Context
The user's persistent memory currently contains:
${existingContext}

# Instructions
1. **Summary**: Create a concise, high-level summary of the conversation so far. Focus on the core objective and current progress.
2. **Session Name**: Suggest a short (2-4 words) descriptive name for this session (e.g., "Refactoring Auth Layer").
3. **Insights**: Extract NEW facts, preferences, or recurring patterns about the user.
   - DO NOT repeat information already present in the "Existing Persona Context".
   - Be extremely brief and specific.
   - Target files like "USER.md" (preferences/facts), "IDENTITY.md" (how they want to be addressed), or "SOUL.md" (personality traits).

Return a structured object.`

			const { object, usage } = await generateObject({
				model,
				schema: z.object({
					summary: z.string().describe('A concise summary of the conversation history.'),
					sessionName: z.string().describe('A short, descriptive name for the session.'),
					insights: z.record(z.string(), z.string()).describe('New insights to append to persona files (e.g., {"USER.md": "Prefers functional programming"}).')
				}),
				system: compactionPrompt,
				prompt: `Current history to compact:\n${JSON.stringify(session.messages)}`,
			})

			logAiRequest({
				timestamp: new Date().toISOString(),
				sessionId: session.id,
				model: session.model,
				provider: session.connectionNickname,
				action: 'compact',
				durationMs: Date.now() - startTime,
				tokens: {
					total: usage?.totalTokens,
				},
				messages: [
					{ role: 'system', content: compactionPrompt },
					{ role: 'user', content: `Current history to compact:\n${JSON.stringify(session.messages)}` }
				],
				response: JSON.stringify(object),
			})

			session.summary = object.summary
			if (object.sessionName && (!session.name || session.name.startsWith('sess_'))) {
				session.name = object.sessionName
			}
			if (object.insights && Object.keys(object.insights).length > 0) {
				updatePersonaFiles(object.insights as Record<string, string>)
			}
			session.messages = session.messages.slice(-10)
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
			channelId: session.channelId,
			channelUserId: session.channelUserId,
			messages: session.messages,
			parentSessionId: session.parentSessionId,
			isSubagent: session.isSubagent,
		} as any
	}

	public async shutdown() {
		for (const client of this.mcpClients) await client.close().catch(() => { })
	}
}
