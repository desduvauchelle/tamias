import * as p from '@clack/prompts'
import pc from 'picocolors'
import { join } from 'path'
import { homedir } from 'os'
import { findFreePort, writeDaemonInfo, clearDaemonInfo, readDaemonInfo } from '../utils/daemon.ts'
import { loadConfig, getDefaultModel, getAllModelOptions } from '../utils/config.ts'
import { autoUpdateDaemon } from '../utils/update.ts'
import { VERSION } from '../utils/version.ts'
import { AIService, type Session } from '../services/aiService.ts'
import { BridgeManager } from '../bridge/index.ts'
import { watchSkills } from '../utils/skills.ts'
import { loadCronJobs, recordCronJobRun } from '../utils/cronStore.ts'
import { runCronJobsOnce, buildPrompt } from './cron.ts'
import { getProjects, getProjectCrons, updateProjectCron, getProjectByDiscordChannel } from '../core/projects.ts'
import { scaffoldFromTemplates, isOnboarded } from '../utils/memory.ts'
import { loadAgents } from '../utils/agentsStore.ts'
import { db } from '../utils/db.ts'
import { getEstimatedCost } from '../utils/pricing.ts'
import { runDatabaseMaintenance } from '../utils/maintenance.ts'
import { buildUsageSummary } from '../utils/usageRolling.ts'
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

export const runStartCommand = async (opts: { daemon?: boolean; verbose?: boolean; ngrok?: boolean } = {}) => {
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
				const baseUrl = `http://localhost:${info.dashboardPort}`
				const dashboardUrl = `${baseUrl}${info.token ? `?token=${info.token}` : ''}`
				const onboardingUrl = `${baseUrl}/onboarding${info.token ? `?token=${info.token}` : ''}`
				p.outro(pc.green(`✅ Dashboard running at ${pc.bold(dashboardUrl)}`))
				if (!isOnboarded()) {
					p.note(
						`Looks like your first time! Run through the setup wizard:\n\n  ${pc.bold(pc.cyan(onboardingUrl))}`,
						pc.yellow('⚡ First time setup')
					)
				}
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
		console.warn(pc.yellow('No models configured. Run `tamias config` first. Dashboard will still start.'))
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
	const dashboardLogFd = fs.openSync(dashboardLogPath, 'a')

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

	// Load or create a persistent dashboard token (reused across restarts)
	const { getOrCreateDashboardToken } = await import('../utils/token.ts')
	const dashboardToken = await getOrCreateDashboardToken()

	const noDashboard = process.env.TAMIAS_NO_DASHBOARD === 'true'
	const shouldEnableNgrok = opts.ngrok ?? config.ngrok?.enabled ?? false

	let dashboardProc: ReturnType<typeof Bun.spawn> | undefined
	if (noDashboard) {
		console.log('[Daemon] Dashboard not launched (TAMIAS_NO_DASHBOARD=true) — run `next dev` separately')
	} else if (isStandalone) {
		// Standalone server: bun <path/server.js> — no package.json scripts needed
		dashboardProc = Bun.spawn([bunPath, standaloneServer], {
			cwd: join(dashboardDir, '.next', 'standalone', 'src', 'dashboard'),
			stdout: dashboardLogFd,
			stderr: dashboardLogFd,
			env: { ...process.env, PORT: dashboardPort.toString(), HOSTNAME: '0.0.0.0', TAMIAS_DASHBOARD_TOKEN: dashboardToken },
		})
	} else {
		const dashboardScript = isDev ? 'dev' : 'start'
		dashboardProc = Bun.spawn([bunPath, 'run', dashboardScript, '-p', dashboardPort.toString()], {
			cwd: dashboardDir,
			stdout: dashboardLogFd,
			stderr: dashboardLogFd,
			env: { ...process.env, TAMIAS_DASHBOARD_TOKEN: dashboardToken }
		})
	}
	dashboardProc?.unref()

	let ngrokProc: ReturnType<typeof Bun.spawn> | undefined
	if (!noDashboard && shouldEnableNgrok) {
		const ngrokBin = Bun.which('ngrok') || 'ngrok'
		try {
			ngrokProc = Bun.spawn([ngrokBin, 'http', dashboardPort.toString()], {
				stdout: dashboardLogFd,
				stderr: dashboardLogFd,
				env: process.env,
			})
			ngrokProc.unref()
			console.log(`[Daemon] ngrok tunnel started for dashboard on port ${dashboardPort}`)
		} catch (err) {
			console.warn('[Daemon] Failed to start ngrok tunnel:', err)
		}
	}


	// Store caffeinatePid in daemon info for cleanup
	writeDaemonInfo({
		pid: process.pid,
		port,
		startedAt: new Date().toISOString(),
		dashboardPort,
		dashboardPid: dashboardProc?.pid,
		ngrokPid: ngrokProc?.pid,
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

	// Run startup health checks (auto-fix what we can, log the rest)
	try {
		const { runHealthChecks, formatHealthReport } = await import('../utils/health/index.ts')
		const healthReport = await runHealthChecks({ autoFix: true })
		if (healthReport.fixedCount > 0) {
			console.log(`[Daemon] Health checks auto-fixed ${healthReport.fixedCount} issue(s)`)
		}
		if (healthReport.hasErrors) {
			console.warn(`[Daemon] Health check errors found:\n${formatHealthReport(healthReport)}`)
		} else if (healthReport.hasWarnings) {
			console.log(`[Daemon] Health check warnings:\n${formatHealthReport(healthReport)}`)
		} else {
			console.log(`[Daemon] All health checks passed`)
		}
	} catch (err) {
		console.warn('[Daemon] Health checks failed to run:', err)
	}

	// Run pending migrations on startup
	try {
		const { runMigrations } = await import('../utils/migrations/index.ts')
		const { TAMIAS_DIR } = await import('../utils/config.ts')
		const migrationResults = await runMigrations(TAMIAS_DIR)
		const applied = migrationResults.applied
		if (applied.length > 0) {
			console.log(`[Daemon] Applied ${applied.length} migration(s): ${applied.map((r: { domain: string; version: number; description: string }) => `${r.domain}-v${r.version}`).join(', ')}`)
		}
	} catch (err) {
		console.warn('[Daemon] Migrations failed:', err)
	}

	// Ensure memory files (HEARTBEAT.md, AGENTS.md, etc.) exist before cron starts
	scaffoldFromTemplates()

	/**
	 * In-process cron executor — runs entirely inside the daemon.
	 *
	 * WHY this exists instead of the HTTP-based executeCronJob in cron.ts:
	 *
	 * The HTTP path builds `channelId = "platform:numericChannelId"` (e.g. "discord:1234567890")
	 * which never matches any bridge in BridgeManager (bridges are keyed by config name, e.g.
	 * "discord:main"). Events dispatched with the wrong key are silently dropped.
	 *
	 * This executor mirrors the pattern from cron-discord-pipeline.test.ts:
	 *   1. Look up the live bridge via findBridgeByAccount → gets the correct bridge name.
	 *   2. Create/reuse a session with channelId=bridge.name, channelUserId=delivery.channelId.
	 *   3. For type=message: emit events directly (no AI).
	 *      For type=ai: enqueue to AI.
	 */
	function createCronExecutor() {
		return async (job: import('../utils/cronStore.ts').CronJob, _daemonUrl: string | null, _token: string): Promise<void> => {
			if (!job.delivery) {
				// No delivery (target:'last' heartbeat-style jobs) — run in a background terminal session
				const sessionKey = job.sessionKey || `cron:${job.id}`
				let session = aiService.getAllSessions().find(s => s.channelId === 'terminal' && s.channelUserId === sessionKey)
				if (!session) {
					session = aiService.createSession({ channelId: 'terminal', channelUserId: sessionKey })
				}
				await aiService.enqueueMessage(session.id, buildPrompt(job), undefined, undefined, {
					source: 'from-cron', cronJobId: job.id, skills: job.skills,
				} as any)
				return
			}

			const { platform, platformAccountId, channelId: deliveryChannelId, channelName } = job.delivery
			const bridge = bridgeManager.findBridgeByAccount(platform, platformAccountId)
			if (!bridge) {
				throw new Error(`No active bridge for platform="${platform}" accountId="${platformAccountId ?? 'any'}" — is the bot running?`)
			}

			let session = aiService.getSessionForBridge(bridge.name, deliveryChannelId)
			if (!session) {
				session = aiService.createSession({ channelId: bridge.name, channelUserId: deliveryChannelId, channelName })
				console.log(`[cron run] Created session ${session.id} for "${job.name}" → ${bridge.name}:${deliveryChannelId}`)
			} else {
				console.log(`[cron run] Reusing session ${session.id} for "${job.name}" → ${bridge.name}:${deliveryChannelId}`)
			}

			if (job.type === 'message') {
				session.emitter.emit('event', { type: 'start', sessionId: session.id })
				session.emitter.emit('event', { type: 'chunk', text: job.prompt })
				session.emitter.emit('event', { type: 'done', sessionId: session.id })
			} else {
				await aiService.enqueueMessage(session.id, buildPrompt(job), undefined, undefined, {
					source: 'from-cron', cronJobId: job.id, skills: job.skills,
				} as any)
			}
		}
	}

	const runProjectCronsOnce = async (options: { dryRun?: boolean } = {}): Promise<{ dueCount: number; executedCount: number; failedCount: number }> => {
		const daemonInfo = readDaemonInfo()
		const daemonUrl = daemonInfo ? `http://127.0.0.1:${daemonInfo.port}` : null
		const daemonToken = daemonInfo?.token ?? ''
		const projects = Object.values(getProjects())
		let dueCount = 0
		let executedCount = 0
		let failedCount = 0

		for (const project of projects) {
			const projectJobs = getProjectCrons(project.id)
			if (projectJobs.length === 0) continue
			const result = await runCronJobsOnce({
				dryRun: options.dryRun,
				daemonUrl,
				daemonToken,
				executeJobFn: createCronExecutor(),
				loadJobsFn: () => projectJobs,
				recordRunFn: (id, runResult) => {
					const updated = updateProjectCron(project.id, id, {
						lastRun: new Date().toISOString(),
						lastStatus: runResult.status,
						lastError: runResult.status === 'error' ? (runResult.error ?? 'Unknown cron execution error') : undefined,
					})
					return updated
				},
				logPrefix: `[cron run][project:${project.id}]`,
			})
			dueCount += result.dueCount
			executedCount += result.executedCount
			failedCount += result.failedCount
		}

		return { dueCount, executedCount, failedCount }
	}

	const runAllCronsOnce = async (options: { dryRun?: boolean } = {}): Promise<void> => {
		const daemonInfo = readDaemonInfo()
		const daemonUrl = daemonInfo ? `http://127.0.0.1:${daemonInfo.port}` : null
		const daemonToken = daemonInfo?.token ?? ''

		await runCronJobsOnce({
			dryRun: options.dryRun,
			daemonUrl,
			daemonToken,
			executeJobFn: createCronExecutor(),
		})
		await runProjectCronsOnce(options)
	}

	console.log(`[Daemon] Internal cron scheduler enabled (checks every minute).`)
	runAllCronsOnce({ dryRun: false }).catch(err => console.error('[cron scheduler] Initial run failed:', err))
	const cronSchedulerTimer = setInterval(() => {
		runAllCronsOnce({ dryRun: false }).catch(err => console.error('[cron scheduler] Run failed:', err))
	}, 60_000)

	const onBridgeMessage = async (msg: BridgeMessage): Promise<boolean> => {
		console.log(`[Bridge] Message from ${msg.channelId}:${msg.channelUserId} (${msg.channelName}) - "${msg.content.slice(0, 80)}"`)

		// Built-in diagnostic command — works regardless of AI config
		const trimmed = msg.content.trim().toLowerCase()

		// !ping — tests the full channel response path without going through AI
		if (trimmed === '!ping') {
			console.log(`[Bridge] !ping received from ${msg.channelId}:${msg.channelUserId} — sending pong`)
			await bridgeManager.broadcastToChannel(msg.channelId, `🏓 pong! v${VERSION} — channel response path is working.`, msg.channelUserId).catch(console.error)
			return false
		}

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
			await bridgeManager.broadcastToChannel(msg.channelId, diagMsg, msg.channelUserId).catch(console.error)
			return false // Returning false tells the bridge NOT to queue this message for AI (avoids desync)
		}

		if (trimmed === '!subagents' || trimmed === '!agents') {
			const allSessions = aiService.getAllSessions()
			// Only show sessions that are actively running (completed ones are cleaned up automatically)
			const subagents = allSessions.filter(s => s.isSubagent && s.subagentStatus !== 'completed' && s.subagentStatus !== 'failed')
			if (subagents.length === 0) {
				await bridgeManager.broadcastToChannel(msg.channelId, '🧠 No sub-agents currently running.', msg.channelUserId).catch(console.error)
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
					const taskDisplay = sub.task ? (sub.task.split('\n')[0].slice(0, 80) + (sub.task.length > 80 ? '…' : '')) : 'unknown'
					lines.push(`${statusIcon} \`${sub.id}\`${elapsed}\n  Task: ${taskDisplay}${progressLine}`)
				}
				await bridgeManager.broadcastToChannel(msg.channelId, lines.join('\n\n'), msg.channelUserId).catch(console.error)
			}
			return false
		}

		let session = aiService.getSessionForBridge(msg.channelId, msg.channelUserId)

		// ── Named-agent routing ──────────────────────────────────────────────────
		const namedAgents = loadAgents().filter(a => a.enabled)

		// 1. Channel-binding: if this channel is dedicated to a specific agent, always route to it.
		const boundAgent = namedAgents.find(a => a.channels?.includes(msg.channelId))
		if (boundAgent) {
			const virtualUserId = `agent:${boundAgent.slug}`
			let agentSession = aiService.getSessionForBridge(msg.channelId, virtualUserId)
			if (!agentSession) {
				console.log(`[Bridge] Creating channel-bound session for agent "${boundAgent.slug}" in ${msg.channelId}`)
				agentSession = aiService.createSession({
					channelId: msg.channelId,
					channelUserId: virtualUserId,
					channelName: msg.channelName,
					agentId: boundAgent.id,
				})
			}
			await aiService.enqueueMessage(agentSession.id, msg.content, msg.authorName, msg.attachments, { source: 'from-chat' })
			return true
		}

		// 2. Name-mention routing: message starts with @<slug> or <slug>: or <slug><space>
		const contentTrimmed = msg.content.trimStart()
		const mentionedAgent = namedAgents.find(a => {
			const lower = contentTrimmed.toLowerCase()
			return (
				lower.startsWith(`@${a.slug} `) ||
				lower.startsWith(`@${a.slug}:`) ||
				lower.startsWith(`${a.slug}: `) ||
				lower.startsWith(`${a.slug} `)
			)
		})
		if (mentionedAgent) {
			const stripped = contentTrimmed
				.replace(new RegExp(`^@?${mentionedAgent.slug}[:\s]+`, 'i'), '')
				.trimStart()
			const virtualUserId = `agent:${mentionedAgent.slug}`
			let agentSession = aiService.getSessionForBridge(msg.channelId, virtualUserId)
			if (!agentSession) {
				console.log(`[Bridge] Creating mention-routed session for agent "${mentionedAgent.slug}" in ${msg.channelId}`)
				agentSession = aiService.createSession({
					channelId: msg.channelId,
					channelUserId: virtualUserId,
					channelName: msg.channelName,
					agentId: mentionedAgent.id,
				})
			}
			await aiService.enqueueMessage(agentSession.id, stripped, msg.authorName, msg.attachments, { source: 'from-chat' })
			return true
		}
		// ─────────────────────────────────────────────────────────────────────────

		if (!session) {
			console.log(`[Bridge] Creating new session for ${msg.channelId}:${msg.channelUserId}`)
			// Resolve project from channel ID (actual channel snowflake / chat ID)
			const linkedProject = msg.channelUserId ? getProjectByDiscordChannel(msg.channelUserId) : undefined
			session = aiService.createSession({
				channelId: msg.channelId,
				channelUserId: msg.channelUserId,
				channelName: msg.channelName,
				projectSlug: linkedProject?.id,
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
	// Check if restarted after an update — notify the requesting channel
	const { checkPendingRestart } = await import('../utils/pendingRestart.ts')
	await checkPendingRestart(bridgeManager).catch(console.error)

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
				const rawLogs = db.query<{
					id: number
					timestamp: string
					sessionId: string
					model: string
					provider: string | null
					action: string | null
					durationMs: number | null
					promptTokens: number | null
					completionTokens: number | null
					totalTokens: number | null
					requestMessagesJson: string | null
					systemPromptText: string | null
					requestInputMessagesJson: string | null
					toolCallsJson: string | null
					toolResultsJson: string | null
					usageJson: string | null
					response: string | null
					estimatedCostUsd: number | null
					providerCostUsd: number | null
				}, []>(`
                    SELECT id, timestamp, sessionId, model, provider, action, durationMs,
                        promptTokens, completionTokens, totalTokens, requestMessagesJson,
						systemPromptText, requestInputMessagesJson, toolCallsJson, toolResultsJson, usageJson,
						response, estimatedCostUsd, providerCostUsd
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

				const parseJson = <T = any>(value: string | null, fallback: T): T => {
					if (!value) return fallback
					try {
						return JSON.parse(value) as T
					} catch {
						return fallback
					}
				}

				const logs = rawLogs.map((r) => {
					let msgs: any[] = []
					try {
						msgs = JSON.parse(r.requestMessagesJson || '[]')
					} catch (e) {
						console.error('Failed to parse logs messages:', e)
					}
					const systemMsg = r.systemPromptText || extractMsgText(msgs.find(m => m.role === 'system')?.content || '')
					const sentMessages = parseJson<any[]>(r.requestInputMessagesJson, [])
					const toolCalls = parseJson<any[]>(r.toolCallsJson, [])
					const toolResults = parseJson<any[]>(r.toolResultsJson, [])
					const usage = parseJson<Record<string, unknown>>(r.usageJson, {})
					const userMsgs = msgs.filter(m => m.role === 'user').map(m => extractMsgText(m.content))

					const inputSnippet = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : ''
					const estimatedFallbackCost = getEstimatedCost(r.model, r.promptTokens || 0, r.completionTokens || 0)
					const estimatedCostUsd = r.estimatedCostUsd ?? estimatedFallbackCost
					const providerCostUsd = r.providerCostUsd ?? null
					const finalCostUsd = providerCostUsd ?? estimatedCostUsd

					return {
						id: r.id,
						timestamp: r.timestamp,
						initiator: r.sessionId,
						model: r.model,
						provider: r.provider,
						action: r.action,
						durationMs: r.durationMs,
						systemPromptSnippet: systemMsg,
						systemPrompt: systemMsg,
						sentMessages,
						toolCalls,
						toolResults,
						usage,
						inputSnippet: inputSnippet,
						outputSnippet: r.response,
						response: r.response,
						estimatedCostUsd,
						providerCostUsd,
						finalCostUsd,
						tokensPrompt: r.promptTokens || 0,
						tokensCompletion: r.completionTokens || 0,
						tokensTotal: r.totalTokens || 0,
						fullHistory: msgs
					}
				})

				return json({ logs })
			}

			if (method === 'GET' && url.pathname === '/usage') {
				return json(buildUsageSummary())
			}

			if ((method === 'GET' || method === 'POST') && url.pathname === '/session') {
				const body = await req.json() as any
				const session = aiService.createSession({ id: body.id, model: body.model, channelId: body.channelId, channelUserId: body.channelUserId, agentId: body.agentId })
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
					const { cronId, target, projectId: cronProjectId } = body
					let job: any
					let isProjectCron = false

					// Search project crons first if projectId provided, then global
					if (cronProjectId) {
						const { getProjectCrons } = await import('../core/projects.js')
						const projectCrons = getProjectCrons(cronProjectId)
						job = projectCrons.find((j: any) => j.id === cronId)
						if (job) isProjectCron = true
					}
					if (!job) {
						const jobs = loadCronJobs()
						job = jobs.find(j => j.id === cronId)
					}
					if (!job) return json({ error: `Cron job '${cronId}' not found` }, 404)

					// Override target for testing
					const testJob = { ...job }
					if (target) {
						testJob.target = target
						if (target === 'last') {
							testJob.delivery = undefined
						} else if (target.includes(':')) {
							const [platform, ...rest] = target.split(':')
							testJob.delivery = { platform, channelId: rest.join(':') }
						}
					}

					// Build prompt
					const promptStr = testJob.context ? `[Context]\n${testJob.context}\n\n${testJob.prompt}` : testJob.prompt
					const promptBody = testJob.skills?.length ? `[Active Skills: ${testJob.skills.join(', ')}]\n${promptStr}` : promptStr

					let session: Session | undefined
					if (testJob.delivery) {
						const { platform, platformAccountId, channelId: targetChannelId } = testJob.delivery
						const bridge = bridgeManager.findBridgeByAccount(platform, platformAccountId)
						if (bridge) {
							const bridgeName = bridge.name
							session = aiService.getSessionForBridge(bridgeName, targetChannelId)
							if (!session) {
								session = aiService.createSession({ channelId: bridgeName, channelUserId: targetChannelId })
							}
						}
					}

					if (!session) {
						const parts = testJob.target && testJob.target !== 'last' ? testJob.target.split(':') : []
						let channelId = parts[0] || 'terminal'
						let channelUserId: string | undefined = parts[1]

						if (!parts.length) {
							const allSessions = aiService.getAllSessions()
							const latest = [...allSessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
							if (latest) {
								channelId = latest.channelId
								channelUserId = latest.channelUserId
							}
						}

						session = aiService.getSessionForBridge(channelId, channelUserId || '')
						if (!session) {
							session = aiService.createSession({ channelId, channelUserId: channelUserId || '' })
						}
					}

					// For project crons without explicit delivery, use the project session
					if (isProjectCron && cronProjectId && !session) {
						const projectSessionId = `project-${cronProjectId}`
						session = aiService.getSession(projectSessionId)
						if (!session) {
							session = aiService.createSession({ channelId: 'terminal', projectSlug: cronProjectId })
						}
					}

					if (testJob.type === 'message') {
						session.emitter.emit('event', { type: 'start', sessionId: session.id })
						session.emitter.emit('event', { type: 'chunk', text: promptBody })
						session.emitter.emit('event', { type: 'done', sessionId: session.id })
					} else {
						aiService.enqueueMessage(session.id, promptBody, undefined, undefined, {
							source: 'from-cron',
							skills: testJob.skills,
							cronJobId: testJob.id
						} as any).catch(err => console.error('[cron-test] Error:', err))
					}

					if (isProjectCron && cronProjectId) {
						const { updateProjectCron } = await import('../core/projects.js')
						try { updateProjectCron(cronProjectId, testJob.id, { lastRun: new Date().toISOString(), lastStatus: 'success' }) } catch { /* ignore */ }
					} else {
						recordCronJobRun(testJob.id, { status: 'success' })
					}
					return json({ ok: true, jobName: job.name, target: testJob.target })
				} catch (err) {
					return json({ error: String(err) }, 500)
				}
			}

			if (method === 'GET' && url.pathname === '/cron-targets') {
				try {
					const bridgeTargets = await bridgeManager.getCronTargets()
					const sessionTargets = aiService.getAllSessions()
						.filter(s => s.channelId?.startsWith('discord:') && s.channelUserId)
						.map(s => ({
							target: `discord:${s.channelUserId}`,
							label: s.channelName ? `Discord ${s.channelName}` : `Discord #${s.channelUserId}`,
							platform: 'discord',
							source: 'session',
						}))

					const merged = [...bridgeTargets, ...sessionTargets]
					const seen = new Set<string>()
					const targets = merged.filter(t => {
						if (seen.has(t.target)) return false
						seen.add(t.target)
						return true
					})

					return json({ targets })
				} catch (err) {
					return json({ error: String(err), targets: [] }, 500)
				}
			}

			if (method === 'GET' && url.pathname === '/discord-channels') {
				try {
					const channels = await bridgeManager.getAllDiscordChannels()
					return json({ channels })
				} catch (err) {
					return json({ error: String(err), channels: [] }, 500)
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

			if (method === 'POST' && url.pathname === '/project-event') {
				const body = await req.json() as any
				if (body.type === 'kanban_changed') {
					const { getProject, projectEvents } = await import('../core/projects.js')
					const project = getProject(body.projectId)
					if (project) {
						projectEvents.emit('kanban_changed', {
							project,
							oldKanban: body.oldKanban,
							newKanban: body.newKanban
						})
					}
				}
				return json({ ok: true })
			}

			if (method === 'DELETE' && url.pathname === '/daemon') {
				clearInterval(cronSchedulerTimer)
				await bridgeManager.destroyAll()
				await aiService.shutdown()
				if (dashboardProc) {
					try { dashboardProc.kill() } catch { /* ignore */ }
				}
				if (ngrokProc) {
					try { ngrokProc.kill() } catch { /* ignore */ }
				}
				clearDaemonInfo()
				setTimeout(() => process.exit(0), 200)
				return json({ ok: true })
			}

			// ── Update Endpoints ────────────────────────────────────────
			// GET  /update → check for updates (cached 24h in ~/.tamias/update-check.json)
			// POST /update → perform update and restart
			if (url.pathname === '/update') {
				const { checkForUpdate, performUpdate } = await import('../utils/update.ts')
				const UPDATE_CACHE_FILE = join(homedir(), '.tamias', 'update-check.json')

				if (method === 'GET') {
					// Read cache
					try {
						const cached = JSON.parse(Bun.file(UPDATE_CACHE_FILE).toString())
						const age = Date.now() - (cached.checkedAt || 0)
						if (age < 24 * 60 * 60 * 1000) {
							return json(cached)
						}
					} catch { /* no cache yet */ }

					try {
						const result = await checkForUpdate()
						const updateAvailable = result !== null && result.currentVersion !== result.latestVersion
						const payload = {
							updateAvailable,
							currentVersion: result?.currentVersion ?? VERSION,
							latestVersion: result?.latestVersion ?? VERSION,
							checkedAt: Date.now(),
						}
						Bun.write(UPDATE_CACHE_FILE, JSON.stringify(payload, null, 2)).catch(() => { })
						return json(payload)
					} catch (err) {
						return json({ updateAvailable: false, currentVersion: VERSION, error: String(err) })
					}
				}

				if (method === 'POST') {
					// Respond immediately, then perform update in background
					const progressLines: string[] = []
					const onProgress = (p: { message: string; type: string }) => {
						progressLines.push(`[${p.type}] ${p.message}`)
						console.log(`[Update] ${p.message}`)
					}

					// Notify channels before restart
					const msg = `🐿️ **Tamias Update Starting**\nUpdate requested via dashboard. Downloading and restarting…`
					for (const channelId of bridgeManager.getActiveChannelIds()) {
						await bridgeManager.broadcastToChannel(channelId, msg).catch(() => { })
					}

					performUpdate(onProgress).then(result => {
						if (result.success) {
							console.log(`[Update] Updated to v${result.latestVersion}. Restarting...`)
							clearDaemonInfo()
							setTimeout(() => process.exit(0), 1500)
						}
					}).catch(console.error)

					return json({ ok: true, message: 'Update started. Daemon will restart.' })
				}
			}

			// ── WhatsApp Webhook Routes ─────────────────────────────────
			// GET  /webhook/whatsapp/<key> → verification challenge
			// POST /webhook/whatsapp/<key> → incoming messages
			if (url.pathname.startsWith('/webhook/whatsapp/')) {
				const waBridge = bridgeManager.findWhatsAppByWebhookPath(url.pathname)
				if (waBridge) {
					if (method === 'GET') {
						const query: Record<string, string> = {}
						url.searchParams.forEach((v, k) => { query[k] = v })
						return waBridge.handleWebhookVerification(query)
					}
					if (method === 'POST') {
						const body = await req.json()
						await waBridge.handleWebhookPayload(body)
						return json({ ok: true })
					}
				}
				return json({ error: 'WhatsApp webhook not found' }, 404)
			}

			// ── WhatsApp Unofficial (Baileys) Routes ────────────────────
			if (url.pathname.startsWith('/whatsapp-unofficial/')) {
				const parts = url.pathname.split('/')
				const key = parts[2]
				const action = parts[3]

				if (!key) return json({ error: 'Missing instance key' }, 400)

				// GET /whatsapp-unofficial/<key>/status
				if (method === 'GET' && action === 'status') {
					const bridge = bridgeManager.findWhatsAppUnofficialByKey(key)
					if (!bridge) return json({ error: 'Instance not found', key }, 404)
					return json({
						key,
						status: bridge.getConnectionStatus(),
						mode: bridge.getMode(),
						allowedGroups: bridge.getAllowedGroups(),
						allowedContacts: bridge.getAllowedContacts(),
						availableGroups: bridge.listAvailableGroups(),
					})
				}

				// GET /whatsapp-unofficial/<key>/groups
				if (method === 'GET' && action === 'groups') {
					const bridge = bridgeManager.findWhatsAppUnofficialByKey(key)
					if (!bridge) return json({ error: 'Instance not found', key }, 404)
					const groups = await bridge.discoverGroups()
					return json({ groups })
				}

				// POST /whatsapp-unofficial/<key>/login
				if (method === 'POST' && action === 'login') {
					// Create or find existing bridge instance for login
					let bridge = bridgeManager.findWhatsAppUnofficialByKey(key)
					if (!bridge) {
						// Create ad-hoc bridge for QR login
						const { WhatsAppUnofficialBridge } = await import('../bridge/channels/whatsapp-unofficial')
						bridge = new WhatsAppUnofficialBridge(key)
						// Initialize with minimal config
						const { loadConfig, getBridgesConfig, setBridgesConfig } = await import('../utils/config.ts')
						const config = loadConfig()
						const bridges = getBridgesConfig()
						if (!bridges.whatsappUnofficials) bridges.whatsappUnofficials = {}
						bridges.whatsappUnofficials[key] = { enabled: true, mode: 'read-only' }
						setBridgesConfig(bridges)
						config.bridges = { ...(config.bridges || {}), whatsappUnofficials: bridges.whatsappUnofficials } as any
						await bridge.initialize(config, (msg: any) => true)
					}
					const qrResult = await bridge.loginWithQr()
					if (!qrResult) return json({ error: 'Already connected or QR generation failed' }, 400)
					const qrDataUrl = `data:image/png;base64,${qrResult.qrPng.toString('base64')}`
					return json({ qrDataUrl, message: 'Scan this QR code with WhatsApp on your phone' })
				}

				// POST /whatsapp-unofficial/<key>/select
				if (method === 'POST' && action === 'select') {
					const bridge = bridgeManager.findWhatsAppUnofficialByKey(key)
					if (!bridge) return json({ error: 'Instance not found', key }, 404)
					const body = await req.json()
					if (body.allowedGroups) await bridge.updateAllowedGroups(body.allowedGroups)
					if (body.allowedContacts) await bridge.updateAllowedContacts(body.allowedContacts)
					if (body.mode) await bridge.updateMode(body.mode)
					return json({ success: true })
				}

				// POST /whatsapp-unofficial/<key>/unlink
				if (method === 'POST' && action === 'unlink') {
					const bridge = bridgeManager.findWhatsAppUnofficialByKey(key)
					if (!bridge) return json({ error: 'Instance not found', key }, 404)
					await bridge.unlink()
					return json({ success: true, message: 'WhatsApp unlinked and auth cleared' })
				}

				// GET /whatsapp-unofficial/list — list all instances
				if (method === 'GET' && key === 'list') {
					const all = bridgeManager.getAllWhatsAppUnofficialBridges()
					return json({
						instances: all.map(({ key: k, bridge: b }) => ({
							key: k,
							status: b.getConnectionStatus(),
							mode: b.getMode(),
							allowedGroups: b.getAllowedGroups(),
							allowedContacts: b.getAllowedContacts(),
						}))
					})
				}

				return json({ error: 'Unknown action' }, 404)
			}

			// ── Browser Auth Endpoints ────────────────────────────────
			// GET  /browser/status → { installed: bool, headedOpen: bool }
			// POST /browser/launch → { url?: string } → open headed browser for auth
			// POST /browser/close  → close headed browser
			if (url.pathname === '/browser/status' && method === 'GET') {
				try {
					const { getBrowserInstallStatus, isAuthBrowserOpen } = await import('../tools/browser.ts')
					const { installed } = await getBrowserInstallStatus()
					return json({ installed, headedOpen: isAuthBrowserOpen() })
				} catch (err) {
					return json({ installed: false, headedOpen: false, error: String(err) })
				}
			}

			if (url.pathname === '/browser/launch' && method === 'POST') {
				try {
					const { launchAuthBrowser } = await import('../tools/browser.ts')
					const body = await req.json() as { url?: string }
					const result = await launchAuthBrowser(body?.url)
					return json(result)
				} catch (err) {
					return json({ ok: false, message: String(err) })
				}
			}

			if (url.pathname === '/browser/close' && method === 'POST') {
				try {
					const { closeAuthBrowser } = await import('../tools/browser.ts')
					const result = await closeAuthBrowser()
					return json(result)
				} catch (err) {
					return json({ ok: false, message: String(err) })
				}
			}

			return json({ error: 'Not found' }, 404)
		},
	})

	process.on('SIGTERM', () => {
		clearInterval(cronSchedulerTimer)
		if (dashboardProc) { try { dashboardProc.kill() } catch { /* ignore */ } }
		if (ngrokProc) { try { ngrokProc.kill() } catch { /* ignore */ } }
		clearDaemonInfo()
		process.exit(0)
	})
	process.on('SIGINT', () => {
		clearInterval(cronSchedulerTimer)
		if (dashboardProc) { try { dashboardProc.kill() } catch { /* ignore */ } }
		if (ngrokProc) { try { ngrokProc.kill() } catch { /* ignore */ } }
		clearDaemonInfo()
		process.exit(0)
	})
	await new Promise<void>(() => { })
}
