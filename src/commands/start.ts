import * as p from '@clack/prompts'
import pc from 'picocolors'
import { join } from 'path'
import { homedir } from 'os'
import { findFreePort, writeDaemonInfo, clearDaemonInfo } from '../utils/daemon.ts'
import { loadConfig, getDefaultModel, getAllModelOptions } from '../utils/config.ts'
import { autoUpdateDaemon } from '../utils/update.ts'
import { VERSION } from '../utils/version.ts'
import { AIService, type Session } from '../services/aiService.ts'
import { BridgeManager } from '../bridge/index.ts'
import { CronManager } from '../bridge/cronManager.ts'
import { watchSkills } from '../utils/skills.ts'
import type { CronJob } from '../utils/cronStore.ts'
import { loadCronJobs } from '../utils/cronStore.ts'
import { scaffoldFromTemplates } from '../utils/memory.ts'
import { db } from '../utils/db.ts'
import { getEstimatedCost } from '../utils/pricing.ts'
import { runDatabaseMaintenance } from '../utils/maintenance.ts'
import type { DaemonEvent, BridgeMessage } from '../bridge/types.ts'


// --- Caffeinate integration ---
let caffeinateProc: ReturnType<typeof Bun.spawn> | undefined

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

export const runStartCommand = async (opts: { daemon?: boolean; verbose?: boolean } = {}) => {
	const isDaemon = opts.daemon ?? false
	const isVerbose = opts.verbose ?? false

	if (!isDaemon) {
		p.intro(pc.bgGreen(pc.black(' Tamias — Starting Daemon ')))
		const config = loadConfig()
		const connections = Object.values(config.connections)
		const numProviders = connections.length
		const numModels = connections.reduce((acc, c) => acc + (c.selectedModels?.length || 0), 0)
		const defaultModel = getDefaultModel() || 'Not set'

		try {
			const { isDaemonRunning, autoStartDaemon, readDaemonInfo } = await import('../utils/daemon.ts')
			if (await isDaemonRunning()) {
				if (isVerbose) {
					// Restart with verbose flag
					p.note('Stopping current daemon to restart with verbose logging...', 'Verbose')
					const info = readDaemonInfo()
					if (info?.pid) {
						try { process.kill(info.pid, 'SIGTERM') } catch { }
						await new Promise(r => setTimeout(r, 1500))
					}
				} else {
					p.outro(pc.green(`✅ Daemon is already running`))
					process.exit(0)
				}
			}
			p.note(isVerbose ? 'Spawning background process with TAMIAS_DEBUG=1...' : 'Spawning background process...', 'Status')
			const info = await autoStartDaemon({ verbose: isVerbose })
			p.outro(pc.green(`✅ Daemon started (PID: ${info.pid}, Port: ${info.port})`))
			if (isVerbose) {
				p.note(`Verbose logging active — tail with:\n  tamias logs`, 'Debug')
			}
			if (info.dashboardPort) {
				const url = `http://localhost:${info.dashboardPort}${info.token ? `?token=${info.token}` : ''}`
				p.outro(pc.green(`✅ Dashboard running at ${pc.bold(url)}`))
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

	// Start caffeinate to keep system awake (macOS only)
	try {
		if (process.platform === 'darwin') {
			caffeinateProc = Bun.spawn(['caffeinate', '-dimsu'], {
				stdout: 'ignore',
				stderr: 'ignore',
				env: process.env,
			})
			caffeinateProc.unref()
		}
	} catch (err) {
		console.warn('[start] Failed to launch caffeinate:', err)
	}

	// Ensure dashboard port is free before starting
	try {
		const { execSync } = await import('child_process')
		const dashboardResult = execSync(
			`lsof -i :${dashboardPort} -t || true`,
			{ encoding: 'utf8' }
		).trim()
		if (dashboardResult) {
			const pids = dashboardResult.split('\n').map(Number).filter(pid => pid && pid !== process.pid)
			for (const pid of pids) {
				try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
			}
			console.log(`[Daemon] Killed zombie dashboard process(es) on port ${dashboardPort}`)
		}
	} catch (err) {
		/* ignore errors if tools aren't available */
	}

	// Start Next.js dashboard
	const fs = require('fs')

	// Priority order:
	//  1. ~/.tamias/src/dashboard  — canonical location for installed users
	//  2. src/dashboard relative to CWD          — dev mode (running from project root)
	//  3. src/dashboard relative to binary dir   — rare edge case
	const candidatePaths = [
		join(homedir(), '.tamias', 'src', 'dashboard'),
		join(process.cwd(), 'src', 'dashboard'),
		join(import.meta.dir ?? '', '..', 'dashboard'),
	]
	const dashboardDir = candidatePaths.find((p) => fs.existsSync(p)) ?? ''

	const dashboardLogPath = join(homedir(), '.tamias', 'dashboard.log')
	const dashboardLogFile = Bun.file(dashboardLogPath)

	if (!dashboardDir) {
		const installPath = join(homedir(), '.tamias', 'src', 'dashboard')
		console.error(pc.red('Dashboard not found.'))
		console.error(pc.yellow(`Expected it at: ${installPath}`))
		console.error('')
		console.error(pc.dim('Re-run the installer to download it:'))
		console.error(pc.cyan('  curl -fsSL https://raw.githubusercontent.com/desduvauchelle/tamias/main/install.sh | bash'))
		process.exit(1)
	}

	// Robust bun discovery
	let bunPath = 'bun'
	try {
		const whichBun = Bun.which('bun')
		if (whichBun && !whichBun.includes('tamias')) {
			bunPath = whichBun
		} else {
			const commonBunPaths = [
				join(homedir(), '.bun', 'bin', 'bun'),
				'/usr/local/bin/bun',
				'/opt/homebrew/bin/bun',
				'/usr/bin/bun'
			]
			for (const p of commonBunPaths) {
				if (fs.existsSync(p)) {
					bunPath = p
					break
				}
			}
		}
	} catch (err) {
		console.warn('[start] Bun executable discovery failed, falling back to "bun":', err)
	}

	// Use standalone server if the dashboard was installed via the prebuilt tarball,
	// production mode (bun run start) if only .next exists, or dev mode as fallback.
	// Next.js standalone output mirrors the project directory structure, so server.js
	// is at .next/standalone/src/dashboard/server.js — not .next/standalone/server.js
	const standaloneServer = join(dashboardDir, '.next', 'standalone', 'src', 'dashboard', 'server.js')
	const isStandalone = fs.existsSync(standaloneServer)
	const isBuilt = isStandalone || fs.existsSync(join(dashboardDir, '.next'))
	const isDev = process.env.TAMIAS_DEV === 'true' || !isBuilt

	// Generate a secure random token for dashboard authentication
	const { randomBytes } = await import('crypto')
	const dashboardToken = randomBytes(24).toString('hex')

	let dashboardProc: ReturnType<typeof Bun.spawn>
	if (isStandalone) {
		// Standalone server: bun <path/server.js> — no package.json scripts needed
		dashboardProc = Bun.spawn([bunPath, standaloneServer], {
			cwd: join(dashboardDir, '.next', 'standalone', 'src', 'dashboard'),
			stdout: dashboardLogFile,
			stderr: dashboardLogFile,
			env: { ...process.env, PORT: dashboardPort.toString(), HOSTNAME: '0.0.0.0', TAMIAS_DASHBOARD_TOKEN: dashboardToken },
		})
	} else {
		const dashboardScript = isDev ? 'dev' : 'start'
		dashboardProc = Bun.spawn([bunPath, 'run', dashboardScript, '-p', dashboardPort.toString()], {
			cwd: dashboardDir,
			stdout: dashboardLogFile,
			stderr: dashboardLogFile,
			env: { ...process.env, TAMIAS_DASHBOARD_TOKEN: dashboardToken }
		})
	}
	dashboardProc.unref()


	// Store caffeinatePid in daemon info for cleanup
	writeDaemonInfo({
		pid: process.pid,
		port,
		startedAt: new Date().toISOString(),
		dashboardPort,
		dashboardPid: dashboardProc.pid,
		caffeinatePid: caffeinateProc?.pid, // <-- used by stop.ts
		token: dashboardToken
	})

	// Print dashboard token and URL for user
	if (dashboardPort && dashboardToken) {
		const url = `http://localhost:${dashboardPort}/configs?token=${dashboardToken}`
		console.log(pc.green('\nDashboard Authentication Token:'))
		console.log(pc.bold(dashboardToken))
		console.log(pc.green('\nDashboard URL:'))
		console.log(pc.bold(url))
		console.log('\nPaste this token in the dashboard if prompted.')
	}

	// Log version and binary path so daemon.log always shows which binary is running
	console.log(`[Daemon v${VERSION}] Starting from ${process.execPath}`)
	console.log(`[Daemon] TAMIAS_DEBUG=${process.env.TAMIAS_DEBUG ?? '0'}`)
	const startupConfig = loadConfig()
	const startupConns = Object.keys(startupConfig.connections)
	console.log(`[Daemon] Connections in config: [${startupConns.join(', ') || 'NONE'}]`)
	const startupDefaults = startupConfig.defaultModels ?? []
	console.log(`[Daemon] Default models: [${startupDefaults.join(', ') || 'NONE (will auto-select)'}]`)

	// Initialize components
	const bridgeManager = new BridgeManager()
	const aiService = new AIService(bridgeManager)
	if (dashboardPort) aiService.setDashboardPort(dashboardPort)
	await aiService.initialize()
	await watchSkills()

	// Ensure memory files (HEARTBEAT.md, AGENTS.md, etc.) exist before cron starts
	scaffoldFromTemplates()

	// Cron setup
	const onCronTrigger = async (job: CronJob) => {
		const now = new Date().toISOString()
		console.log(`[Cron] ${now} Triggering job: "${job.name}" (id=${job.id}, type=${job.type ?? 'ai'}, target=${job.target})`)
		let session: Session | undefined

		try {
			if (job.target === 'last') {
				const allSessions = aiService.getAllSessions()
				console.log(`[Cron] ${now} target=last — ${allSessions.length} session(s) available`)
				session = allSessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
				if (session) {
					console.log(`[Cron] ${now} Using last session: ${session.id} (channelId=${session.channelId}, updatedAt=${session.updatedAt.toISOString()})`)
				} else {
					console.log(`[Cron] ${now} No existing sessions found — will create a new one`)
				}
			} else if (job.target?.includes(':')) {
				const [channelId, channelUserId] = job.target.split(':')
				console.log(`[Cron] ${now} target split → channelId="${channelId}", channelUserId="${channelUserId}"`)
				session = aiService.getSessionForBridge(channelId, channelUserId)
				if (!session) {
					console.log(`[Cron] ${now} No existing session for bridge — creating new session`)
					session = aiService.createSession({ channelId, channelUserId })
				} else {
					console.log(`[Cron] ${now} Found existing session: ${session.id}`)
				}
			} else {
				console.log(`[Cron] ${now} Unrecognised target format: "${job.target}" — creating bare session`)
			}

			if (!session) {
				session = aiService.createSession({})
				console.log(`[Cron] ${now} Created bare session: ${session.id}`)
			}

			if (job.type === 'message') {
				// Send the prompt text directly to the channel — no AI involved
				console.log(`[Cron] ${now} Sending direct message to session ${session.id}: "${job.prompt.slice(0, 80)}..."`)
				session.emitter.emit('event', { type: 'start', sessionId: session.id })
				session.emitter.emit('event', { type: 'chunk', text: job.prompt })
				session.emitter.emit('event', { type: 'done', sessionId: session.id })
				console.log(`[Cron] ${now} Direct message emitted for job "${job.name}"`)
			} else {
				// AI path — send prompt to AI, deliver generated response to channel
				console.log(`[Cron] ${now} Enqueuing AI prompt for session ${session.id}: "${job.prompt.slice(0, 80)}..."`)
				await aiService.enqueueMessage(session.id, job.prompt, undefined, undefined, { source: 'from-cron' })
				console.log(`[Cron] ${now} AI prompt enqueued successfully for job "${job.name}"`)
			}
		} catch (err) {
			console.error(`[Cron] ${now} ERROR executing job "${job.name}" (id=${job.id}):`, err)
		}
	}
	const cronManager = new CronManager(onCronTrigger)
	cronManager.start()

	const onBridgeMessage = async (msg: BridgeMessage): Promise<boolean> => {
		console.log(`[Bridge] Message from ${msg.channelId}:${msg.channelUserId} (${msg.channelName}) - "${msg.content.slice(0, 80)}"`)

		// Built-in diagnostic command — works regardless of AI config
		const trimmed = msg.content.trim().toLowerCase()
		if (trimmed === '!diag' || trimmed === '!version') {
			const diagConfig = loadConfig()
			const connNames = Object.keys(diagConfig.connections)
			const diagMsg = [
				`🐿️ **Tamias Diagnostics**`,
				`Version: v${VERSION}`,
				`Binary: ${process.execPath}`,
				`Connections: ${connNames.length > 0 ? connNames.join(', ') : 'NONE'}`,
				`Default models: ${diagConfig.defaultModels?.join(', ') || 'not set'}`,
			].join('\n')
			await bridgeManager.broadcastToChannel(msg.channelId, diagMsg).catch(console.error)
			return false // Returning false tells the bridge NOT to queue this message for AI (avoids desync)
		}

		if (trimmed === '!subagents' || trimmed === '!agents') {
			const allSessions = aiService.getAllSessions()
			const subagents = allSessions.filter(s => s.isSubagent)
			if (subagents.length === 0) {
				await bridgeManager.broadcastToChannel(msg.channelId, '🧠 No sub-agents currently active.').catch(console.error)
			} else {
				const lines = ['🧠 **Active Sub-agents**']
				for (const sub of subagents) {
					const statusIcon = sub.subagentStatus === 'running' ? '⏳'
						: sub.subagentStatus === 'completed' ? '✅'
						: sub.subagentStatus === 'failed' ? '❌'
						: '⌛'
					const elapsed = sub.spawnedAt
						? ` (${Math.round((Date.now() - sub.spawnedAt.getTime()) / 1000)}s)`
						: ''
					const progressLine = sub.progress ? `\n  └ ${sub.progress}` : ''
					lines.push(`${statusIcon} \`${sub.id}\`${elapsed}\n  Task: ${sub.task || 'unknown'}${progressLine}`)
				}
				await bridgeManager.broadcastToChannel(msg.channelId, lines.join('\n\n')).catch(console.error)
			}
			return false
		}

		let session = aiService.getSessionForBridge(msg.channelId, msg.channelUserId)
		if (!session) {
			console.log(`[Bridge] Creating new session for ${msg.channelId}:${msg.channelUserId}`)
			session = aiService.createSession({
				channelId: msg.channelId,
				channelUserId: msg.channelUserId,
				channelName: msg.channelName
			})
		} else {
			console.log(`[Bridge] Reusing existing session ${session.id} for ${msg.channelId}:${msg.channelUserId}`)
			if (msg.channelName && session.channelName !== msg.channelName) {
				// Update channel name if it changed (e.g. channel renamed)
				session.channelName = msg.channelName
			}
		}
		await aiService.enqueueMessage(session.id, msg.content, msg.authorName, msg.attachments, { source: 'from-chat' })
		return true // Message accepted for AI processing
	}
	await bridgeManager.initializeAll(config, onBridgeMessage).catch(console.error)

	// Background update loop
	setInterval(() => autoUpdateDaemon(bridgeManager).catch(console.error), 24 * 60 * 60 * 1000)

	// Database Maintenance (run once on start, then every 24h)
	runDatabaseMaintenance().catch(console.error)
	setInterval(() => runDatabaseMaintenance().catch(console.error), 24 * 60 * 60 * 1000)

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

			if (method === 'GET' && url.pathname === '/debug') {
				const dbgConfig = loadConfig()
				const sessions = aiService.getAllSessions().map(s => ({
					id: s.id,
					model: s.model,
					connectionNickname: s.connectionNickname,
					modelId: s.modelId,
					channelId: s.channelId,
					channelUserId: s.channelUserId,
					connectionExistsInConfig: !!dbgConfig.connections[s.connectionNickname],
				}))
				return json({
					version: VERSION,
					execPath: process.execPath,
					pid: process.pid,
					verboseMode: process.env.TAMIAS_DEBUG === '1',
					connections: Object.keys(dbgConfig.connections),
					defaultModels: dbgConfig.defaultModels ?? [],
					allModelOptions: getAllModelOptions(),
					sessions,
				})
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
					channelId: s.channelId,
					channelUserId: s.channelUserId,
					channelName: s.channelName,
					isSubagent: s.isSubagent || false,
					parentSessionId: s.parentSessionId,
					task: s.task,
					subagentStatus: s.subagentStatus,
					spawnedAt: s.spawnedAt?.toISOString(),
					completedAt: s.completedAt?.toISOString(),
					progress: s.progress,
				}))
				return json(list)
			}

			if (method === 'GET' && url.pathname === '/history') {
				const rawLogs = db.query<{ id: number, timestamp: string, sessionId: string, model: string, provider: string, action: string, durationMs: number, promptTokens: number | null, completionTokens: number | null, totalTokens: number | null, requestMessagesJson: string, response: string }, []>(`
                    SELECT id, timestamp, sessionId, model, provider, action, durationMs,
                        promptTokens, completionTokens, totalTokens, requestMessagesJson, response
                    FROM ai_logs ORDER BY id DESC LIMIT 100
                `).all()

				const extractMsgText = (content: unknown): string => {
					if (typeof content === 'string') return content
					if (Array.isArray(content)) {
						return content.map((part: any) => {
							if (typeof part === 'string') return part
							if (part?.type === 'text' && typeof part.text === 'string') return part.text
							return ''
						}).filter(Boolean).join(' ')
					}
					return String(content ?? '')
				}

				const logs = rawLogs.map((r) => {
					let msgs: any[] = []
					try {
						msgs = JSON.parse(r.requestMessagesJson || '[]')
					} catch (e) {
						console.error('Failed to parse logs messages:', e)
					}
					const systemMsg = extractMsgText(msgs.find(m => m.role === 'system')?.content || '')
					const userMsgs = msgs.filter(m => m.role === 'user').map(m => extractMsgText(m.content))

					const inputSnippet = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : ''
					const cost = getEstimatedCost(r.model, r.promptTokens || 0, r.completionTokens || 0)

					return {
						id: r.id,
						timestamp: r.timestamp,
						initiator: r.sessionId,
						model: r.model,
						systemPromptSnippet: systemMsg,
						inputSnippet: inputSnippet,
						outputSnippet: r.response,
						estimatedCostUsd: cost,
						tokensPrompt: r.promptTokens || 0,
						tokensCompletion: r.completionTokens || 0,
						fullHistory: msgs
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

			if (method === 'GET' && url.pathname === '/session') {
				const body = await req.json() as any
				const session = aiService.createSession({ id: body.id, model: body.model, channelId: body.channelId, channelUserId: body.channelUserId })
				return json({ sessionId: session.id, model: session.model })
			}

			if (method === 'GET' && url.pathname.startsWith('/session/') && url.pathname.endsWith('/messages')) {
				const id = url.pathname.split('/')[2]!
				const messages = db.query('SELECT role, content FROM messages WHERE sessionId = ? ORDER BY id ASC').all(id)
				return json({ messages })
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

			if (method === 'POST' && url.pathname === '/cron-test') {
				try {
					const body = await req.json() as any
					const { cronId, target } = body
					const jobs = loadCronJobs()
					const job = jobs.find(j => j.id === cronId)
					if (!job) return json({ error: `Cron job '${cronId}' not found` }, 404)
					const testJob = target ? { ...job, target } : job
					onCronTrigger(testJob).catch(err => console.error('[cron-test] Error:', err))
					return json({ ok: true, jobName: job.name, target: testJob.target })
				} catch (err) {
					return json({ error: String(err) }, 500)
				}
			}

			if (method === 'POST' && url.pathname === '/message') {
				const body = await req.json() as any
				let attachments: BridgeMessage['attachments'] | undefined
				if (Array.isArray(body.attachments) && body.attachments.length > 0) {
					attachments = body.attachments.map((a: any) => ({
						type: (a.mimeType?.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
						mimeType: a.mimeType ?? 'application/octet-stream',
						buffer: Buffer.from(a.base64 ?? '', 'base64'),
						url: a.name,
					}))
				}
				await aiService.enqueueMessage(body.sessionId, body.content ?? '', body.authorName, attachments, body.metadata)
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
