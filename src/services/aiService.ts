import { EventEmitter } from 'events'
import { streamText, generateText, generateObject, stepCountIs } from 'ai'

// Verbose debug logger — enabled by setting TAMIAS_DEBUG=1 or launching with `tamias start --verbose`
const DEBUG = process.env.TAMIAS_DEBUG === '1'
function debug(...args: unknown[]) {
	if (DEBUG) console.log('[DEBUG]', ...args)
}
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { loadConfig, getApiKeyForConnection, type ConnectionConfig, getDefaultModel, getDefaultModels, getAllModelOptions } from '../utils/config'
import { buildActiveTools } from '../utils/toolRegistry'
import { buildSystemPrompt, updatePersonaFiles, writePersonaFile, appendDailyLog, scaffoldFromTemplates, readAllPersonaFiles } from '../utils/memory'
import { saveSessionToDisk, type SessionPersist, listAllStoredSessions, loadSessionFromDisk } from '../utils/sessions'
import { db } from '../utils/db'
import { logAiRequest } from '../utils/logger'
import type { DaemonEvent, BridgeMessage } from '../bridge/types'
import { BridgeManager } from '../bridge'

export interface MessageJob {
	sessionId: string
	content: string
	authorName?: string
	attachments?: BridgeMessage['attachments']
	metadata?: {
		source: string
	}
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
	messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | any[] }>
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
	private dashboardPort?: number

	constructor(bridgeManager: BridgeManager) {
		this.bridgeManager = bridgeManager
	}

	public async initialize() {
		scaffoldFromTemplates()
		const config = loadConfig()
		debug(`initialize(): connections in config: [${Object.keys(config.connections).join(', ') || 'NONE'}]`)
		const allOpts = getAllModelOptions()
		debug(`initialize(): all model options: [${allOpts.join(', ') || 'NONE'}]`)
		debug(`initialize(): default models: [${getDefaultModels().join(', ') || 'NONE'}]`)
		this.healStaleSessionModels()
		this.loadAllSessions()
		// We can't refresh tools globally anymore since it depends on sessionId
	}

	public setDashboardPort(port: number) {
		this.dashboardPort = port
	}

	/** Directly update sessions in SQLite whose connectionNickname no longer exists in config */
	private healStaleSessionModels() {
		const config = loadConfig()
		const validNicknames = new Set(Object.keys(config.connections))
		if (validNicknames.size === 0) return

		const replacement = getDefaultModels().find(m => {
			const [nick] = m.split('/')
			return validNicknames.has(nick)
		}) ?? getAllModelOptions()[0]

		if (!replacement) return

		const [repNick, ...repRest] = replacement.split('/')
		const repModelId = repRest.join('/')

		// Find sessions with dead connectionNickname and update them in the DB
		try {
			const placeholders = [...validNicknames].map(() => '?').join(',')
			const staleSessions = db.query<{ id: string, model: string }, string[]>(
				`SELECT id, model FROM sessions WHERE connectionNickname NOT IN (${placeholders})`
			).all(...validNicknames)

			if (staleSessions.length > 0) {
				console.log(`[AIService] Healing ${staleSessions.length} stale session(s) in DB: ${staleSessions.map(s => `${s.id}(${s.model})`).join(', ')} → ${replacement}`)
				const stmt = db.prepare(`UPDATE sessions SET model = ?, connectionNickname = ?, modelId = ? WHERE id = ?`)
				for (const s of staleSessions) {
					stmt.run(replacement, repNick, repModelId, s.id)
				}
			}
		} catch (err) {
			console.error('[AIService] healStaleSessionModels failed:', err)
		}
	}

	public async refreshTools(sessionId: string) {
		try {
			const { tools, mcpClients, toolDocs } = await buildActiveTools(this, sessionId)
			this.activeTools = tools
			this.toolDocs = toolDocs
			// Close old clients before replacing
			for (const c of this.mcpClients) await c.close().catch((err) => console.error('[AIService] Failed to close MCP client:', err))
			this.mcpClients = mcpClients
		} catch (err) {
			console.error('[AIService] Failed to load tools:', err)
		}
	}

	private loadAllSessions() {
		const stored = listAllStoredSessions()
		const config = loadConfig()
		const availableModels = getAllModelOptions()
		const defaultModels = getDefaultModels()
		for (const s of stored) {
			const full = loadSessionFromDisk(s.id)
			if (full) {
				// Heal stale model — if the stored connection no longer exists on this machine,
				// update to the first available model so the session works immediately.
				let resolvedModel = full.model
				const [storedNick] = resolvedModel.split('/')
				if (!config.connections[storedNick]) {
					const replacement = defaultModels.find(m => {
						const [nick] = m.split('/')
						return !!config.connections[nick]
					}) ?? availableModels[0]
					if (replacement) {
						console.log(`[AIService] Session ${full.id}: healing stale model "${resolvedModel}" → "${replacement}"`)
						resolvedModel = replacement
					}
				}
				const [nickname, ...rest] = resolvedModel.split('/')
				const session: Session = {
					id: full.id,
					name: full.name,
					model: resolvedModel,
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
				// Persist healed model back to DB so it survives next restart
				if (resolvedModel !== full.model) {
					saveSessionToDisk(this.toPersist(session))
				}
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
		const config = loadConfig()
		debug(`createSession(): options.model=${options.model}, getDefaultModel()=${getDefaultModel()}`)
		debug(`createSession(): connections in config: [${Object.keys(config.connections).join(', ') || 'NONE'}]`)
		let modelStr = options.model ?? getDefaultModel()
		// If the requested model's connection doesn't exist, fall back to any configured one
		if (modelStr) {
			const [nick] = modelStr.split('/')
			if (!config.connections[nick]) {
				debug(`createSession(): connection "${nick}" not found — attempting fallback`)
				const fallback = getDefaultModels().find(m => {
					const [n] = m.split('/')
					return !!config.connections[n]
				}) ?? getAllModelOptions()[0]
				if (fallback) {
					console.log(`[AIService] createSession: model "${modelStr}" connection not found, using "${fallback}" instead`)
					modelStr = fallback
				} else {
					console.warn(`[AIService] createSession: no fallback found either! connections=[${Object.keys(config.connections).join(', ')}]`)
				}
			}
		}
		modelStr = modelStr ?? getAllModelOptions()[0] ?? 'openai/gpt-4o'
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

	public async reportSubagentResult(sessionId: string, data: { task: string; status: 'completed' | 'failed'; reason?: string; outcome?: string; context?: any }) {
		const session = this.sessions.get(sessionId)
		if (!session || !session.parentSessionId) return

		const parentSession = this.sessions.get(session.parentSessionId)
		if (!parentSession) return

		let report = `### 🧠 Sub-agent Report\n\n`
		report += `**Task:** ${data.task}\n`
		report += `**Status:** ${data.status === 'completed' ? '✅ completed' : '❌ failed'}\n`
		if (data.reason) report += `**Reason:** ${data.reason}\n`
		if (data.outcome) report += `\n**Outcome:**\n${data.outcome}\n`
		if (data.context) {
			report += `\n**Context:**\n\`\`\`json\n${JSON.stringify(data.context, null, 2)}\n\`\`\`\n`
		}

		await this.enqueueMessage(parentSession.id, report)
	}

	public async enqueueMessage(sessionId: string, content: string, authorName?: string, attachments?: BridgeMessage['attachments'], metadata?: { source: string }) {
		const session = this.sessions.get(sessionId)
		if (!session) throw new Error('Session not found')
		session.queue.push({ sessionId, content, authorName, attachments, metadata })
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

		// Build multimodal content when image attachments are present
		const imageAttachments = job.attachments?.filter(att => att.type === 'image' && att.buffer) ?? []
		let userContent: string | any[]
		if (imageAttachments.length > 0) {
			const parts: any[] = [{ type: 'text', text: messageContent }]
			for (const img of imageAttachments) {
				parts.push({ type: 'image', image: new Uint8Array(img.buffer!), mimeType: img.mimeType })
			}
			userContent = parts
		} else {
			userContent = messageContent
		}
		session.messages.push({ role: 'user', content: userContent })

		const config = loadConfig()
		// Priority order: configured default models → session's stored model → any other configured model
		// Only include models whose connection actually exists on this machine.
		const currentDefaults = getDefaultModels()
		const allConfiguredModels = getAllModelOptions()
		debug(`processSession(${session.id}): session.model=${session.model} connectionNickname=${session.connectionNickname}`)
		debug(`processSession(${session.id}): config connections=[${Object.keys(config.connections).join(', ') || 'NONE'}]`)
		debug(`processSession(${session.id}): currentDefaults=[${currentDefaults.join(', ') || 'NONE'}]`)
		debug(`processSession(${session.id}): allConfiguredModels=[${allConfiguredModels.join(', ') || 'NONE'}]`)
		const modelsToTry = [
			...currentDefaults,
			session.model,
			...allConfiguredModels,
		].filter((m, i, arr) => {
			if (!m) return false
			if (arr.indexOf(m) !== i) return false // deduplicate
			const [nick] = m.split('/')
			if (!config.connections[nick]) {
				console.log(`[AIService] Skipping model "${m}" — connection "${nick}" not in config [${Object.keys(config.connections).join(', ')}]`)
				return false
			}
			return true
		})
		console.log(`[AIService] session=${session.id} modelsToTry=[${modelsToTry.join(', ') || 'NONE'}]`)
		if (modelsToTry.length === 0) {
			const configuredConns = Object.keys(config.connections)
			const diagMsg = configuredConns.length === 0
				? `No AI connections configured. Run \`tamias models\` on the server to set one up.`
				: `Session model "${session.model}" uses connection "${session.connectionNickname}" which is not in config. Configured connections: ${configuredConns.join(', ')}. Run \`tamias stop && tamias start\` on the server.`
			console.error(`[AIService] No valid models to try for session ${session.id}. Config connections: [${configuredConns.join(', ')}]`)
			session.messages.pop() // remove the user message we pushed since we can't respond
			session.emitter.emit('event', { type: 'error', message: diagMsg } as DaemonEvent)
			session.processing = false
			if (session.queue.length > 0) setImmediate(() => this.processSession(session))
			return
		}

		let lastError: any = null
		const failures: Array<{ model: string; error: string }> = []

		// Emit 'start' once per message job, BEFORE the model-retry loop.
		// Emitting inside the loop caused a second 'start' on retry, which
		// popped the next queued Discord message prematurely, resulting in
		// that message receiving two responses.
		session.emitter.emit('event', { type: 'start', sessionId: session.id } as DaemonEvent)

		for (const currentModelStr of modelsToTry) {
			const [nickname, ...rest] = currentModelStr.split('/')
			const modelId = rest.join('/') || currentModelStr
			const connection = config.connections[nickname]

			if (!connection) {
				console.warn(`[AIService] No connection object for "${nickname}" (model="${currentModelStr}") — skipping`)
				lastError = new Error(`No AI connection configured for "${nickname}"`)
				failures.push({ model: currentModelStr, error: `No connection config for "${nickname}"` })
				continue
			}

			console.log(`[AIService] Attempting session ${session.id} via ${currentModelStr} (provider=${connection.provider})`)
			debug(`  API key present: ${!!getApiKeyForConnection(connection.nickname)}, modelId=${modelId}`)
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

				const startTime = Date.now()
				const source = job.metadata?.source || 'from-chat'
				const headers: Record<string, string> = {
					'X-Title': `Tamias (${source})`,
					'X-Tamias-Source': source,
				}

				const result = streamText({
					model,
					system: systemPrompt,
					messages: session.messages as any,
					tools: toolNamesList.length > 0 ? (this.activeTools as any) : undefined,
					stopWhen: stepCountIs(20),
					headers,
					onStepFinish: async ({ toolCalls, toolResults }) => {
						if (toolCalls?.length) {
							for (const tc of toolCalls) {
								session.emitter.emit('event', { type: 'tool_call', name: tc.toolName, input: (tc as any).input ?? {} } as DaemonEvent)
							}
						}
						if (toolResults?.length) {
							for (const tr of (toolResults as any)) {
								// Emit tool_result event
								session.emitter.emit('event', { type: 'tool_result', name: tr.toolName, result: tr.result } as DaemonEvent)

								// Also emit file events for tools returning { __tamias_file__: true, name, buffer, mimeType }
								const res = tr?.result
								if (res?.__tamias_file__ === true && res.name && res.buffer) {
									session.emitter.emit('event', {
										type: 'file',
										name: res.name,
										buffer: Buffer.isBuffer(res.buffer) ? res.buffer : Buffer.from(res.buffer),
										mimeType: res.mimeType ?? 'application/octet-stream',
									} as DaemonEvent)
								}
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

				const usage = await Promise.race([
					result.usage,
					new Promise(resolve => setTimeout(() => resolve({}), 2000))
				]).catch((err) => { console.warn('[AIService] Failed to retrieve usage stats:', err); return {} }) as any

				const response = await Promise.resolve(result.response).catch(() => null)
				const fullMessages = response?.messages ?? []

				const logId = logAiRequest({
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
						...fullMessages,
					],
					response: fullResponse,
				})

				if (config.debug) {
					const debugMeta = [
						'',
						'--- DEBUG INFO ---',
						`Model: ${currentModelStr}`,
						`Tokens: ${usage?.totalTokens || 0} (Prompt: ${usage?.inputTokens || 0}, Completion: ${usage?.outputTokens || 0})`,
					]
					if (this.dashboardPort && logId) {
						debugMeta.push(`Log: http://localhost:${this.dashboardPort}/history?log=${logId}`)
					}
					debugMeta.push('---')

					const footer = debugMeta.join('\n')
					fullResponse += footer
					session.emitter.emit('event', { type: 'chunk', text: footer } as DaemonEvent)
				}

				session.messages.push({ role: 'assistant', content: fullResponse })
				session.updatedAt = new Date()

				// If we used a fallback model, update the session so next messages use it directly
				if (currentModelStr !== session.model) {
					console.log(`[AIService] Permanently updating session ${session.id} model from ${session.model} to ${currentModelStr}`)
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
						const report = `[Subagent finished: ${session.id}]\n${fullResponse}`
						this.enqueueMessage(parentSession.id, report).catch(console.error)
					}
				}

				if (session.messages.length >= 20) {
					this.compactSession(session, model).then(() => {
						saveSessionToDisk(this.toPersist(session))
					}).catch((err) => console.error(`[AIService] Session compaction failed for ${session.id}:`, err))
				}

				session.processing = false
				if (session.queue.length > 0) {
					setImmediate(() => this.processSession(session))
				}
				return // Success!
			} catch (err: any) {
				const errStr = err?.message || String(err)
				console.error(`[AIService] Failed with model ${currentModelStr}: ${errStr}`)
				failures.push({ model: currentModelStr, error: errStr })
				lastError = err
				// Continue to next model
			}
		}

		// If we get here, all models failed
		const failureSummary = failures.map(f => `${f.model}: ${f.error}`).join(' | ')
		console.error(`[AIService] All models failed for session ${session.id}: ${failureSummary}`)
		session.emitter.emit('event', { type: 'error', message: `All AI models failed:\n${failures.map(f => `• ${f.model}: ${f.error}`).join('\n')}` } as DaemonEvent)
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
			case 'openrouter': {
				return createOpenRouter({ apiKey })(`${modelId}:online`)
			}
			case 'ollama': {
				let baseURL = (connection as any).baseUrl || 'http://127.0.0.1:11434'
				baseURL = baseURL.replace(/\/$/, '')
				if (!baseURL.endsWith('/v1')) baseURL += '/v1'
				return createOpenAI({ baseURL, apiKey: apiKey || 'ollama' }).chat(modelId)
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

			const today = new Date().toISOString().slice(0, 10)
			const compactionPrompt = `You are a memory compaction agent for Tamias, an AI assistant.
Your goal is to summarize the current conversation and keep the user's persistent memory files accurate and up-to-date.

# Existing Persona Context
The user's persistent memory currently contains:
${existingContext}

# Instructions
1. **Summary**: Write a concise, high-level summary of the conversation so far. Focus on what was discussed, any decisions made, and current progress.
2. **Session Name**: Suggest a short (2-4 words) descriptive name for this session (e.g., "Refactoring Auth Layer").
3. **Memory Update (MEMORY.md)**: Rewrite the FULL content of MEMORY.md to reflect the latest known facts about the user — their projects, preferences, habits, and anything worth remembering long-term. Merge the existing MEMORY.md content with any new facts from this conversation. This field replaces MEMORY.md entirely, so include everything relevant, not just new items.
4. **Identity Insights** (optional): Only if the conversation revealed something genuinely NEW about the user's identity, preferences, or personality that is NOT already in the existing context above, add a brief note to the appropriate file:
   - "USER.md" — new facts about who they are, what they work on, how they prefer to communicate
   - "IDENTITY.md" — new preferences for how the AI should behave or address them
   - "SOUL.md" — new personality traits or values
   Leave this array EMPTY if nothing meaningfully new was learned. DO NOT repeat what is already in the existing context.

Return a structured object.`

			const { object, usage } = await generateObject({
				model,
				schema: z.object({
					summary: z.string().describe('A concise summary of the conversation history.'),
					sessionName: z.string().describe('A short, descriptive name for the session.'),
					memoryUpdate: z.string().describe('Full replacement content for MEMORY.md, merging existing facts with anything new from this conversation.'),
					insights: z.array(z.object({
						filename: z.enum(['USER.md', 'IDENTITY.md', 'SOUL.md']).describe('The persona file to update.'),
						content: z.string().describe('The new insight to append.')
					})).describe('Genuinely new identity/preference insights to append. Leave empty if nothing new was learned.')
				}),
				system: compactionPrompt,
				prompt: `Current history to compact:\n${JSON.stringify(session.messages)}`,
				headers: {
					'X-Title': 'Tamias (from-compacting)',
					'X-Tamias-Source': 'from-compacting',
				}
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
			// Append a one-liner to today's raw daily log (feeds the nightly digest)
			const sessionLabel = session.name || session.id
			const oneLiner = object.summary.split(/[.\n]/)[0].trim()
			appendDailyLog(`- **${sessionLabel}**: ${oneLiner}.`)
			// Rewrite MEMORY.md entirely with the merged content
			if (object.memoryUpdate?.trim()) {
				writePersonaFile('MEMORY.md', object.memoryUpdate.trim() + '\n')
			}
			// Only append genuinely new identity/preference insights, dated
			if (object.insights && object.insights.length > 0) {
				const insightsRecord: Record<string, string> = {}
				for (const item of object.insights) {
					insightsRecord[item.filename] = item.content
				}
				updatePersonaFiles(insightsRecord, today)
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
		for (const client of this.mcpClients) await client.close().catch((err) => console.error('[AIService] Failed to close MCP client during shutdown:', err))
	}
}
