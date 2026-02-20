import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findFreePort, writeDaemonInfo, clearDaemonInfo } from '../utils/daemon.ts'
import { loadConfig, getDefaultModel, getAllModelOptions, type ConnectionConfig } from '../utils/config.ts'
import { buildActiveTools } from '../utils/toolRegistry.ts'
import { buildSystemPrompt, updatePersonaFiles } from '../utils/memory.ts'
import { saveSessionToDisk, type SessionPersist, listAllStoredSessions, loadSessionFromDisk } from '../utils/sessions.ts'
import { logAiRequest } from '../utils/logger.ts'
import { streamText, generateText, stepCountIs } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { EventEmitter } from 'events'
import type { DaemonEvent, BridgeMessage } from '../bridge/types.ts'
import { BridgeManager } from '../bridge/index.ts'

// ─── Session store ─────────────────────────────────────────────────────────────

interface MessageJob {
	sessionId: string
	content: string
}

interface Session {
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

const sessions = new Map<string, Session>()
const encoder = new TextEncoder()

function loadAllSessions() {
	const stored = listAllStoredSessions()
	for (const s of stored) {
		const full = loadSessionFromDisk(s.id, s.monthDir)
		if (full) {
			const [nickname, ...rest] = full.model.split('/')
			sessions.set(full.id, {
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
				channelId: 'terminal',
			})
		}
	}
}

function sseEvent(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// ─── AI engine ────────────────────────────────────────────────────────────────

function toPersist(session: Session): SessionPersist {
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

async function compactSession(session: Session, model: any) {
	// Only compact if we have enough history
	if (session.messages.length < 20) return

	try {
		const compactionPrompt = `
You are a memory compaction agent. Your job is to summarise the conversation so far and extract key insights about the user and your own persona.

TASKS:
1. Provide a concise summary of the conversation.
2. Extract new facts about the user (USER.md), your persona rules (SOUL.md), or technical env (TOOLS.md).
3. Suggest a short, descriptive name for this session if it doesn't have a good one.

Output RAW JSON only:
{
  "summary": "...",
  "insights": {
    "USER.md": "discovered fact...",
    "SOUL.md": "new rule..."
  },
  "sessionName": "..."
}`

		const startTime = Date.now()
		const { text, usage } = await generateText({
			model,
			system: compactionPrompt,
			prompt: `Current history:\n${JSON.stringify(session.messages)}`,
		})
		const durationMs = Date.now() - startTime

		logAiRequest({
			timestamp: new Date().toISOString(),
			sessionId: session.id,
			model: session.model,
			provider: session.connectionNickname,
			action: 'compact',
			durationMs,
			tokens: {
				prompt: (usage as any)?.inputTokens,
				completion: (usage as any)?.outputTokens,
				total: (usage as any)?.totalTokens,
			},
			messages: [{ role: 'system', content: compactionPrompt }, { role: 'user', content: `Current history:\n${JSON.stringify(session.messages)}` }],
			response: text,
		})

		const result = JSON.parse(text.replace(/```json\n?|\n?```/g, ''))

		session.summary = result.summary
		if (result.sessionName && (!session.name || session.name.startsWith('sess_'))) {
			session.name = result.sessionName
		}

		if (result.insights && Object.keys(result.insights).length > 0) {
			updatePersonaFiles(result.insights)
		}

		// Truncate history but keep the context moving
		session.messages = session.messages.slice(-4)

	} catch (err) {
		console.error('Failed to compact session:', err)
	}
}

function buildModel(connection: ConnectionConfig, modelId: string) {
	switch (connection.provider) {
		case 'openai': return createOpenAI({ apiKey: connection.apiKey })(modelId)
		case 'anthropic': return createAnthropic({ apiKey: connection.apiKey })(modelId) as ReturnType<ReturnType<typeof createOpenAI>>
		case 'google': return createGoogleGenerativeAI({ apiKey: connection.apiKey })(modelId) as ReturnType<ReturnType<typeof createOpenAI>>
		case 'openrouter': return createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: connection.apiKey })(modelId)
		default: throw new Error(`Unsupported provider: ${connection.provider}`)
	}
}

async function processSession(session: Session, tools: Record<string, unknown>, config: ReturnType<typeof loadConfig>) {
	if (session.processing || session.queue.length === 0) return
	session.processing = true

	const job = session.queue.shift()!
	session.messages.push({ role: 'user', content: job.content })

	// Wait up to 3s for the SSE client to connect before processing (terminal client only)
	if (session.channelId === 'terminal') {
		for (let i = 0; i < 30 && session.emitter.listenerCount('event') === 0; i++) {
			await new Promise((r) => setTimeout(r, 100))
		}
	}

	const connection = config.connections[session.connectionNickname]
	if (!connection) {
		session.processing = false
		return
	}

	try {
		const model = buildModel(connection, session.modelId)
		const toolNamesList = Object.keys(tools)
		const systemPrompt = buildSystemPrompt(toolNamesList, session.summary)

		// Signal start of response
		session.emitter.emit('event', { type: 'start', sessionId: session.id } as DaemonEvent)

		const startTime = Date.now()
		const result = streamText({
			model,
			system: systemPrompt,
			messages: session.messages,
			tools: toolNamesList.length > 0 ? (tools as Parameters<typeof streamText>[0]['tools']) : undefined,
			stopWhen: stepCountIs(20),
			onStepFinish: async ({ toolCalls }) => {
				if (toolCalls?.length) {
					for (const tc of toolCalls) {
						session.emitter.emit('event', { type: 'tool_call', name: tc.toolName, input: (tc as { input?: unknown }).input ?? {} } as DaemonEvent)
					}
				}
			},
		})

		let fullResponse = ''
		for await (const chunk of result.textStream) {
			fullResponse += chunk
			session.emitter.emit('event', { type: 'chunk', text: chunk } as DaemonEvent)
		}

		// Log request after stream is done (with timeout for usage promise)
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
				prompt: (usage as any)?.inputTokens,
				completion: (usage as any)?.outputTokens,
				total: (usage as any)?.totalTokens,
			},
			messages: [
				{ role: 'system', content: systemPrompt },
				...session.messages,
			],
			response: fullResponse,
		})

		session.messages.push({ role: 'assistant', content: fullResponse })
		session.updatedAt = new Date()
		saveSessionToDisk(toPersist(session))

		session.emitter.emit('event', { type: 'done', sessionId: session.id } as DaemonEvent)

		// Trigger compaction background
		if (session.messages.length >= 20) {
			compactSession(session, model).then(() => {
				saveSessionToDisk(toPersist(session))
			}).catch(() => { })
		}
	} catch (err) {
		session.emitter.emit('event', { type: 'error', message: String(err) } as DaemonEvent)
	} finally {
		session.processing = false
		// Process next job if any
		if (session.queue.length > 0) {
			setImmediate(() => processSession(session, tools, config))
		}
	}
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

function nanoid(): string {
	return `sess_${Math.random().toString(36).slice(2, 10)}`
}

function cors(headers: Record<string, string> = {}): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		...headers,
	}
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: cors({ 'Content-Type': 'application/json' }),
	})
}

// ─── Start command ─────────────────────────────────────────────────────────────

export const runStartCommand = async (opts: { daemon?: boolean } = {}) => {
	const isDaemon = opts.daemon ?? false

	if (!isDaemon) {
		p.intro(pc.bgGreen(pc.black(' Tamias — Starting Daemon ')))
		const config = loadConfig()
		const connections = Object.values(config.connections)
		const numProviders = connections.length
		const numModels = connections.reduce((acc, c) => acc + (c.selectedModels?.length || 0), 0)
		const defaultModel = getDefaultModel() || 'Not set'

		const { toolNames } = await buildActiveTools()
		const numInternalTools = toolNames.filter(t => t.startsWith('internal:')).length
		const numMcp = toolNames.filter(t => t.startsWith('mcp:')).length

		const stats = [
			`Port:              ${pc.bold('9001+')}`,
			`File locations:    ${pc.dim('~/.tamias')}`,
			`Internal tools:    ${pc.cyan(String(numInternalTools))}`,
			`MCP servers:       ${pc.cyan(String(numMcp))}`,
			`Providers:         ${pc.cyan(String(numProviders))}`,
			`Total models:      ${pc.cyan(String(numModels))}`,
			`Default model:     ${pc.yellow(defaultModel)}`,
		].join('\n')

		const tips = [
			`• Chat:          ${pc.bold('tamias chat')}`,
			`• Manage Models: ${pc.bold('tamias models')}`,
			`• Set Default:   ${pc.bold('tamias model set')}`,
			`• Stop Daemon:   ${pc.bold('tamias stop')}`,
		].join('\n')

		try {
			// If already running, just say so
			const { isDaemonRunning, readDaemonInfo, autoStartDaemon } = await import('../utils/daemon.ts')
			if (await isDaemonRunning()) {
				const info = readDaemonInfo()
				p.note(stats, 'Configuration Stats')
				p.note(tips, 'Next Steps')
				p.outro(pc.green(`✅ Daemon is already running (PID: ${info?.pid}, Port: ${info?.port})`))
				await new Promise(r => setTimeout(r, 100))
				process.exit(0)
			}
			p.note('Spawning background process...', 'Status')
			const info = await autoStartDaemon()
			p.note(stats, 'Configuration Stats')
			p.note(tips, 'Next Steps')
			p.outro(pc.green(`✅ Daemon started in background (PID: ${info.pid}, Port: ${info.port})`))

			await new Promise(r => setTimeout(r, 100))
			process.exit(0)
		} catch (err) {
			p.cancel(pc.red(`Failed to start daemon: ${err}`))
			process.exit(1)
		}
		return
	}

	const config = loadConfig()
	loadAllSessions()

	// Pick default model (if not set or doesn't exist, pick first available)
	const allOptions = getAllModelOptions()
	if (allOptions.length === 0) {
		p.cancel(pc.yellow('No models configured. Run `tamias config` first.'))
		process.exit(1)
	}

	const port = await findFreePort(9001)

	// Load tools
	let activeTools: Record<string, unknown> = {}
	let mcpClients: Array<{ close: () => Promise<void> }> = []
	try {
		; ({ tools: activeTools, mcpClients } = await buildActiveTools())
	} catch {
		// tools optional
	}

	writeDaemonInfo({ pid: process.pid, port, startedAt: new Date().toISOString() })

	// Init bridge manager
	const bridgeManager = new BridgeManager()
	/** Map of channelId:channelUserId → sessionId for persistent bridge sessions */
	const bridgeSessionMap = new Map<string, string>()

	const onBridgeMessage = async (msg: BridgeMessage, _targetSessionId: string) => {
		const bridgeKey = `${msg.channelId}:${msg.channelUserId}`

		// Look up existing session for this channel + user
		let sessionId = bridgeSessionMap.get(bridgeKey)
		let session = sessionId ? sessions.get(sessionId) : undefined

		// Auto-create a session if none exists
		if (!session) {
			const modelStr = getDefaultModel() ?? allOptions[0]
			if (!modelStr) {
				console.error(`[Bridge] No model available for auto-session creation`)
				return
			}
			const [nickname, ...rest] = modelStr.split('/')
			const modelId = rest.join('/')
			if (!nickname || !modelId) return
			const connection = config.connections[nickname]
			if (!connection) return

			session = {
				id: nanoid(),
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
				channelId: msg.channelId,
				channelUserId: msg.channelUserId,
			}

			// Wire events back to bridge manager
			session.emitter.on('event', (evt: DaemonEvent) => {
				bridgeManager.dispatchEvent(session!.channelId, evt, session).catch(console.error)
			})

			sessions.set(session.id, session)
			bridgeSessionMap.set(bridgeKey, session.id)
			console.log(`[Bridge] Auto-created session ${session.id} for ${bridgeKey} using ${modelStr}`)
		}

		session.queue.push({ sessionId: session.id, content: msg.content })
		processSession(session, activeTools, config).catch(() => { })
	}
	await bridgeManager.initializeAll(config, onBridgeMessage).catch(console.error)

	const server = Bun.serve({
		port,
		hostname: '127.0.0.1',
		idleTimeout: 0, // disable idle timeout — SSE connections must stay open indefinitely
		async fetch(req) {
			const url = new URL(req.url)
			const method = req.method

			// CORS preflight
			if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() })

			// ── Health ──────────────────────────────────────────────────────
			if (method === 'GET' && url.pathname === '/health') {
				return json({ status: 'ok', port, pid: process.pid, sessions: sessions.size })
			}

			// ── List sessions ───────────────────────────────────────────────
			if (method === 'GET' && url.pathname === '/sessions') {
				const list = [...sessions.values()].map((s) => ({
					id: s.id,
					name: s.name,
					model: s.model,
					createdAt: s.createdAt.toISOString(),
					updatedAt: s.updatedAt.toISOString(),
					summary: s.summary,
					queueLength: s.queue.length,
				}))
				return json(list)
			}

			// ── Create session ──────────────────────────────────────────────
			if (method === 'POST' && url.pathname === '/session') {
				const body = await req.json() as { model?: string; channelId?: string; channelUserId?: string }
				const modelStr = body.model ?? getDefaultModel() ?? allOptions[0]!
				const [nickname, ...rest] = modelStr.split('/')
				const modelId = rest.join('/')
				if (!nickname || !modelId) return json({ error: 'Invalid model format: expected nickname/modelId' }, 400)
				const connection = config.connections[nickname]
				if (!connection) return json({ error: `Connection '${nickname}' not found` }, 404)

				const session: Session = {
					id: nanoid(),
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
					channelId: body.channelId || 'terminal',
					channelUserId: body.channelUserId,
				}

				if (session.channelId !== 'terminal') {
					session.emitter.on('event', (evt: DaemonEvent) => {
						bridgeManager.dispatchEvent(session.channelId, evt, session).catch(console.error)
					})
				}

				sessions.set(session.id, session)
				return json({ sessionId: session.id, model: modelStr })
			}

			// ── Delete session ──────────────────────────────────────────────
			if (method === 'DELETE' && url.pathname.startsWith('/session/') && !url.pathname.endsWith('/stream')) {
				const id = url.pathname.split('/')[2]!
				const session = sessions.get(id)
				if (!session) return json({ error: 'Session not found' }, 404)
				if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
				session.emitter.removeAllListeners('event')
				sessions.delete(id)
				return json({ ok: true })
			}

			// ── SSE stream ──────────────────────────────────────────────────
			if (method === 'GET' && url.pathname.startsWith('/session/') && url.pathname.endsWith('/stream')) {
				const id = url.pathname.split('/')[2]!
				const session = sessions.get(id)
				if (!session) return json({ error: 'Session not found' }, 404)

				if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)

				const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
				const writer = writable.getWriter()

				const onEvent = async (evt: DaemonEvent) => {
					await writer.write(sseEvent(evt.type, evt)).catch(() => { })
				}
				session.emitter.on('event', onEvent)

				// Heartbeat every 15s to keep the connection alive (Bun idle timeout)
				session.heartbeatTimer = setInterval(async () => {
					await writer.write(encoder.encode('event: heartbeat\ndata: {}\n\n')).catch(() => {
						if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
					})
				}, 15_000)

				req.signal?.addEventListener('abort', () => {
					session.emitter.off('event', onEvent)
					if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
				})

				return new Response(readable, {
					headers: cors({
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						'Connection': 'keep-alive',
					}),
				})
			}

			// ── Post message ────────────────────────────────────────────────
			if (method === 'POST' && url.pathname === '/message') {
				const body = await req.json() as { sessionId?: string; content?: string }
				if (!body.sessionId || !body.content) return json({ error: 'sessionId and content are required' }, 400)
				const session = sessions.get(body.sessionId)
				if (!session) return json({ error: 'Session not found' }, 404)
				session.queue.push({ sessionId: body.sessionId, content: body.content })
				// Kick off processing (non-blocking)
				processSession(session, activeTools, config).catch(() => { })
				return json({ ok: true, queueLength: session.queue.length })
			}

			// ── Shutdown ────────────────────────────────────────────────────
			if (method === 'DELETE' && url.pathname === '/daemon') {
				for (const s of sessions.values()) {
					s.emitter.removeAllListeners('event')
				}
				await bridgeManager.destroyAll()
				for (const client of mcpClients) await client.close().catch(() => { })
				clearDaemonInfo()
				setTimeout(() => process.exit(0), 200)
				return json({ ok: true, message: 'Shutting down...' })
			}

			return json({ error: 'Not found' }, 404)
		},
	})

	// Background: just keep process alive silently
	process.on('SIGTERM', () => { clearDaemonInfo(); process.exit(0) })
	process.on('SIGINT', () => { clearDaemonInfo(); process.exit(0) })

	// Keep alive
	await new Promise<void>(() => { })
}
