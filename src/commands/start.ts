import * as p from '@clack/prompts'
import pc from 'picocolors'
import { findFreePort, writeDaemonInfo, clearDaemonInfo } from '../utils/daemon.ts'
import { loadConfig, getDefaultModel, getAllModelOptions } from '../utils/config.ts'
import { autoUpdateDaemon } from '../utils/update.ts'
import { AIService, type Session } from '../services/aiService.ts'
import { BridgeManager } from '../bridge/index.ts'
import { CronManager } from '../bridge/cronManager.ts'
import { ensureDefaultHeartbeat, type CronJob } from '../utils/cronStore.ts'
import type { DaemonEvent, BridgeMessage } from '../bridge/types.ts'

const encoder = new TextEncoder()

function sseEvent(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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

export const runStartCommand = async (opts: { daemon?: boolean } = {}) => {
	const isDaemon = opts.daemon ?? false

	if (!isDaemon) {
		p.intro(pc.bgGreen(pc.black(' Tamias — Starting Daemon ')))
		const config = loadConfig()
		const connections = Object.values(config.connections)
		const numProviders = connections.length
		const numModels = connections.reduce((acc, c) => acc + (c.selectedModels?.length || 0), 0)
		const defaultModel = getDefaultModel() || 'Not set'

		try {
			const { isDaemonRunning, autoStartDaemon } = await import('../utils/daemon.ts')
			if (await isDaemonRunning()) {
				p.outro(pc.green(`✅ Daemon is already running`))
				process.exit(0)
			}
			p.note('Spawning background process...', 'Status')
			const info = await autoStartDaemon()
			p.outro(pc.green(`✅ Daemon started in background (PID: ${info.pid}, Port: ${info.port})`))
			process.exit(0)
		} catch (err) {
			p.cancel(pc.red(`Failed to start daemon: ${err}`))
			process.exit(1)
		}
		return
	}

	const config = loadConfig()
	const allOptions = getAllModelOptions()
	if (allOptions.length === 0) {
		console.error(pc.yellow('No models configured. Run `tamias config` first.'))
		process.exit(1)
	}

	const port = await findFreePort(9001)
	writeDaemonInfo({ pid: process.pid, port, startedAt: new Date().toISOString() })

	// Initialize components
	const bridgeManager = new BridgeManager()
	const aiService = new AIService(bridgeManager)
	await aiService.initialize()

	// Cron setup
	ensureDefaultHeartbeat()
	const onCronTrigger = async (job: CronJob) => {
		console.log(`[Cron] Triggering job: ${job.name}`)
		let session: Session | undefined

		if (job.target === 'last') {
			const allSessions = aiService.getAllSessions()
			session = allSessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
		} else if (job.target?.includes(':')) {
			const [channelId, channelUserId] = job.target.split(':')
			session = aiService.getSessionForBridge(channelId, channelUserId)
			if (!session) {
				session = aiService.createSession({ channelId, channelUserId })
			}
		}

		if (!session) {
			session = aiService.createSession({})
		}

		await aiService.enqueueMessage(session.id, job.prompt)
	}
	const cronManager = new CronManager(onCronTrigger)
	cronManager.start()

	const onBridgeMessage = async (msg: BridgeMessage) => {
		let session = aiService.getSessionForBridge(msg.channelId, msg.channelUserId)
		if (!session) {
			session = aiService.createSession({ channelId: msg.channelId, channelUserId: msg.channelUserId })
		}
		await aiService.enqueueMessage(session.id, msg.content)
	}
	await bridgeManager.initializeAll(config, onBridgeMessage).catch(console.error)

	// Background update loop
	setInterval(() => autoUpdateDaemon(bridgeManager).catch(console.error), 24 * 60 * 60 * 1000)

	Bun.serve({
		port,
		hostname: '127.0.0.1',
		idleTimeout: 0,
		async fetch(req) {
			const url = new URL(req.url)
			const method = req.method

			if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() })
			if (method === 'GET' && url.pathname === '/health') {
				return json({ status: 'ok', port, pid: process.pid, sessions: aiService.getAllSessions().length })
			}

			if (method === 'GET' && url.pathname === '/sessions') {
				const list = aiService.getAllSessions().map(s => ({
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

			if (method === 'POST' && url.pathname === '/session') {
				const body = await req.json() as any
				const session = aiService.createSession({ model: body.model, channelId: body.channelId, channelUserId: body.channelUserId })
				return json({ sessionId: session.id, model: session.model })
			}

			if (method === 'DELETE' && url.pathname.startsWith('/session/') && !url.pathname.endsWith('/stream')) {
				const id = url.pathname.split('/')[2]!
				aiService.deleteSession(id)
				return json({ ok: true })
			}

			if (method === 'GET' && url.pathname.startsWith('/session/') && url.pathname.endsWith('/stream')) {
				const id = url.pathname.split('/')[2]!
				const session = aiService.getSession(id)
				if (!session) return json({ error: 'Session not found' }, 404)

				const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
				const writer = writable.getWriter()

				const onEvent = async (evt: DaemonEvent) => {
					await writer.write(sseEvent(evt.type, evt)).catch(() => { })
				}
				session.emitter.on('event', onEvent)

				const heartbeatTimer = setInterval(async () => {
					await writer.write(encoder.encode('event: heartbeat\ndata: {}\n\n')).catch(() => clearInterval(heartbeatTimer))
				}, 15_000)

				req.signal?.addEventListener('abort', () => {
					session.emitter.off('event', onEvent)
					clearInterval(heartbeatTimer)
				})

				return new Response(readable, {
					headers: cors({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }),
				})
			}

			if (method === 'POST' && url.pathname === '/message') {
				const body = await req.json() as any
				await aiService.enqueueMessage(body.sessionId, body.content)
				return json({ ok: true })
			}

			if (method === 'DELETE' && url.pathname === '/daemon') {
				await bridgeManager.destroyAll()
				await aiService.shutdown()
				cronManager.stop()
				clearDaemonInfo()
				setTimeout(() => process.exit(0), 200)
				return json({ ok: true })
			}

			return json({ error: 'Not found' }, 404)
		},
	})

	process.on('SIGTERM', () => { clearDaemonInfo(); process.exit(0) })
	process.on('SIGINT', () => { clearDaemonInfo(); process.exit(0) })
	await new Promise<void>(() => { })
}
