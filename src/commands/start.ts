import * as p from '@clack/prompts'
import pc from 'picocolors'
import { join } from 'path'
import { homedir } from 'os'
import { findFreePort, writeDaemonInfo, clearDaemonInfo } from '../utils/daemon.ts'
import { loadConfig, getDefaultModel, getAllModelOptions } from '../utils/config.ts'
import { autoUpdateDaemon } from '../utils/update.ts'
import { AIService, type Session } from '../services/aiService.ts'
import { BridgeManager } from '../bridge/index.ts'
import { CronManager } from '../bridge/cronManager.ts'
import { watchSkills } from '../utils/skills.ts'
import { ensureDefaultHeartbeat, type CronJob } from '../utils/cronStore.ts'
import { db } from '../utils/db.ts'
import { getEstimatedCost } from '../utils/pricing.ts'
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
			if (info.dashboardPort) {
				p.outro(pc.green(`✅ Dashboard running at http://localhost:${info.dashboardPort}`))
			}
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
	const dashboardPort = await findFreePort(5678)

	// Start Next.js dashboard
	const projectRoot = join(import.meta.dir, '../..')
	const dashboardDir = join(projectRoot, 'src', 'dashboard')
	const dashboardLogPath = join(homedir(), '.tamias', 'dashboard.log')
	const dashboardLogFile = Bun.file(dashboardLogPath)

	const dashboardProc = Bun.spawn(['bun', 'run', 'dev', '-p', dashboardPort.toString()], {
		cwd: dashboardDir,
		stdout: dashboardLogFile,
		stderr: dashboardLogFile,
	})
	dashboardProc.unref()

	writeDaemonInfo({
		pid: process.pid,
		port,
		startedAt: new Date().toISOString(),
		dashboardPort,
		dashboardPid: dashboardProc.pid
	})

	// Initialize components
	const bridgeManager = new BridgeManager()
	const aiService = new AIService(bridgeManager)
	await aiService.initialize()
	await watchSkills()

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

			if (method === 'GET' && url.pathname === '/logs') {
				const rawLogs = db.query<{ timestamp: string, sessionId: string, model: string, provider: string, action: string, durationMs: number, promptTokens: number | null, completionTokens: number | null, totalTokens: number | null, requestMessagesJson: string, response: string }, []>(`
                    SELECT timestamp, sessionId, model, provider, action, durationMs,
                        promptTokens, completionTokens, totalTokens, requestMessagesJson, response
                    FROM ai_logs ORDER BY id DESC LIMIT 100
                `).all()

				const logs = rawLogs.map((r, idx) => {
					let msgs: any[] = []
					try {
						msgs = JSON.parse(r.requestMessagesJson || '[]')
					} catch (e) {
						console.error('Failed to parse logs messages:', e)
					}
					const systemMsg = msgs.find(m => m.role === 'system')?.content || ''
					const userMsgs = msgs.filter(m => m.role === 'user').map(m => m.content)

					const inputSnippet = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : ''
					const cost = getEstimatedCost(r.model, r.promptTokens || 0, r.completionTokens || 0)

					return {
						id: `log-${idx}`,
						timestamp: r.timestamp,
						initiator: r.sessionId,
						model: r.model,
						systemPromptSnippet: systemMsg,
						inputSnippet: inputSnippet,
						outputSnippet: r.response,
						estimatedCostUsd: cost,
						tokensPrompt: r.promptTokens || 0,
						tokensCompletion: r.completionTokens || 0
					}
				})

				return json({ logs })
			}

			if (method === 'GET' && url.pathname === '/usage') {
				const rows = db.query<{ timestamp: string, model: string, sessionId: string, promptTokens: number | null, completionTokens: number | null }, []>(`
                    SELECT timestamp, model, sessionId, promptTokens, completionTokens
                    FROM ai_logs ORDER BY id DESC
                `).all()

				const now = new Date()
				const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
				const startOfYesterday = new Date(startOfToday.getTime() - 86400000)

				const day = now.getDay()
				const diff = now.getDate() - day + (day === 0 ? -6 : 1)
				const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff)
				const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

				let today = 0, yesterday = 0, thisWeek = 0, thisMonth = 0, total = 0

				// Time series and distributions
				const dailyMap: Record<string, number> = {}
				const modelMap: Record<string, number> = {}
				const initiatorMap: Record<string, number> = {}

				// Initialize last 14 days with 0
				for (let i = 0; i < 14; i++) {
					const d = new Date(startOfToday.getTime() - (i * 86400000))
					const key = d.toISOString().split('T')[0]
					dailyMap[key] = 0
				}

				for (const r of rows) {
					const cost = getEstimatedCost(r.model, r.promptTokens || 0, r.completionTokens || 0)
					const d = new Date(r.timestamp)
					const dateKey = d.toISOString().split('T')[0]

					total += cost
					if (d >= startOfToday) today += cost
					else if (d >= startOfYesterday) yesterday += cost

					if (d >= startOfWeek) thisWeek += cost
					if (d >= startOfMonth) thisMonth += cost

					// Time series (last 14 days)
					if (dailyMap[dateKey] !== undefined) {
						dailyMap[dateKey] += cost
					}

					// Distributions
					modelMap[r.model] = (modelMap[r.model] || 0) + cost

					// Basic initiator detection from sessionId
					let initiator = 'System'
					if (r.sessionId.startsWith('sess_')) initiator = 'CLI/Global'
					else if (r.sessionId.includes('discord')) initiator = 'Discord'
					else if (r.sessionId.includes('telegram')) initiator = 'Telegram'
					else initiator = 'Other'

					initiatorMap[initiator] = (initiatorMap[initiator] || 0) + cost
				}

				const dailySpend = Object.entries(dailyMap)
					.map(([date, cost]) => ({ date, cost }))
					.sort((a, b) => a.date.localeCompare(b.date))

				const modelDistribution = Object.entries(modelMap)
					.map(([name, value]) => ({ name, value }))
					.sort((a, b) => b.value - a.value)

				const initiatorDistribution = Object.entries(initiatorMap)
					.map(([name, value]) => ({ name, value }))
					.sort((a, b) => b.value - a.value)

				return json({
					today,
					yesterday,
					thisWeek,
					thisMonth,
					total,
					dailySpend,
					modelDistribution,
					initiatorDistribution
				})
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
				if (dashboardProc) {
					try { dashboardProc.kill() } catch { /* ignore */ }
				}
				clearDaemonInfo()
				setTimeout(() => process.exit(0), 200)
				return json({ ok: true })
			}

			return json({ error: 'Not found' }, 404)
		},
	})

	process.on('SIGTERM', () => {
		if (dashboardProc) { try { dashboardProc.kill() } catch { /* ignore */ } }
		clearDaemonInfo()
		process.exit(0)
	})
	process.on('SIGINT', () => {
		if (dashboardProc) { try { dashboardProc.kill() } catch { /* ignore */ } }
		clearDaemonInfo()
		process.exit(0)
	})
	await new Promise<void>(() => { })
}
