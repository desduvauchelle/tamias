import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import type { DaemonEvent } from '../bridge/types.ts'
import { isDaemonRunning, readDaemonInfo, getDaemonUrl } from '../utils/daemon.ts'
import { loadConfig, getWorkspacePath, TAMIAS_DIR } from '../utils/config.ts'
import { buildSystemPrompt } from '../utils/memory.ts'

export const DAEMON_TOOL_NAME = 'daemon'
export const DAEMON_TOOL_LABEL = '🔧 Daemon (status, lifecycle, usage, introspection)'

export function createDaemonTools(aiService: AIService, sessionId: string) {
	return {

		daemon_status: tool({
			description: 'Get the current daemon status: running, port, PID, uptime.',
			inputSchema: z.object({}),
			execute: async () => {
				const running = await isDaemonRunning()
				const info = readDaemonInfo()
				if (!running || !info) return { running: false }
				const uptimeSec = Math.floor((Date.now() - new Date(info.startedAt).getTime()) / 1000)
				return { running: true, port: info.port, pid: info.pid, uptimeSec, startedAt: info.startedAt }
			},
		}),

		stop_daemon: tool({
			description: 'Stop the running Tamias daemon gracefully.',
			inputSchema: z.object({}),
			execute: async () => {
				const running = await isDaemonRunning()
				if (!running) return { success: false, error: 'Daemon is not running.' }
				await fetch(`${getDaemonUrl()}/daemon`, { method: 'DELETE' })
				return { success: true, message: 'Daemon shutdown initiated.' }
			},
		}),

		update_tamias: tool({
			description: 'Check for and install Tamias updates. Downloads the latest binary and dashboard, then restarts the daemon automatically. After restart, sends a confirmation message with the version and changelog to the channel that requested the update.',
			inputSchema: z.object({}),
			execute: async () => {
				const { checkForUpdate, performUpdateAndRestart } = await import('../utils/update.ts')

				let updateInfo: Awaited<ReturnType<typeof checkForUpdate>>
				try {
					updateInfo = await checkForUpdate()
				} catch (err) {
					return { success: false, error: `Failed to check for updates: ${err}` }
				}

				if (!updateInfo) {
					return { success: false, error: 'Could not reach GitHub releases.' }
				}

				const { currentVersion, latestVersion, release } = updateInfo

				if (currentVersion === latestVersion) {
					return { success: true, message: `Already up to date (v${currentVersion})` }
				}

				const session = aiService.getSession(sessionId)
				if (!session) {
					console.warn('[UpdateRestart] Session not found — post-restart notification will not be delivered')
				}
				const channelId = session?.channelId ?? 'unknown'
				const channelUserId = session?.channelUserId

				const rawChangelog = (release.body as string | undefined) ?? ''
				const changelog = rawChangelog.length > 800 ? rawChangelog.slice(0, 797) + '…' : rawChangelog

				// Schedule update+restart 4 seconds from now so the AI has time to deliver this response
				setTimeout(() => {
					performUpdateAndRestart({
						channelId,
						channelUserId,
						fromVersion: currentVersion,
						toVersion: latestVersion,
						changelog,
					}).catch((err: unknown) => console.error('[UpdateRestart] Error:', err))
				}, 4000)

				return {
					success: true,
					message: `Updating from v${currentVersion} to v${latestVersion} — restarting in ~5 seconds. I'll send you a message in this channel when I'm back online.`,
				}
			},
		}),

		get_usage: tool({
			description: 'Get AI usage statistics (tokens and estimated cost) for a given period.',
			inputSchema: z.object({
				period: z.enum(['today', 'yesterday', 'week', 'month', 'all']).default('all'),
			}),
			execute: async ({ period }) => {
				const { db } = await import('../utils/db.ts')
				const { getEstimatedCost, formatCurrency } = await import('../utils/pricing.ts')

				const rows = db.query<{ timestamp: string, model: string, promptTokens: number | null, completionTokens: number | null }, []>(`
				SELECT timestamp, model, promptTokens, completionTokens FROM ai_logs
			`).all()

				const now = new Date()
				const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
				const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
				const day = now.getDay()
				const diff = now.getDate() - day + (day === 0 ? -6 : 1)
				const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff)
				const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

				let filtered = rows
				if (period === 'today') filtered = rows.filter(r => new Date(r.timestamp) >= startOfToday)
				else if (period === 'yesterday') filtered = rows.filter(r => {
					const d = new Date(r.timestamp)
					return d >= startOfYesterday && d < startOfToday
				})
				else if (period === 'week') filtered = rows.filter(r => new Date(r.timestamp) >= startOfWeek)
				else if (period === 'month') filtered = rows.filter(r => new Date(r.timestamp) >= startOfMonth)

				let totalIn = 0, totalOut = 0, totalCost = 0
				for (const r of filtered) {
					const tin = r.promptTokens || 0
					const tout = r.completionTokens || 0
					totalIn += tin
					totalOut += tout
					totalCost += getEstimatedCost(r.model, tin, tout)
				}

				return {
					period,
					requestCount: filtered.length,
					tokensIn: totalIn,
					tokensOut: totalOut,
					estimatedCost: formatCurrency(totalCost),
				}
			}
		}),

		refresh_tools: tool({
			description: 'Reload the internal and external MCP tools. Use this after configuration changes.',
			inputSchema: z.object({}),
			execute: async () => {
				return { success: true, message: 'Tool refresh requested. If new tools do not appear, please restart the Tamias daemon.' }
			},
		}),

		get_system_prompt: tool({
			description: 'Return the fully compiled system prompt that is currently used for this session. This is the exact prompt that would be sent to the AI model, including all persona files, memory, channel context, project context, and all other tiers assembled by the token budget system.',
			inputSchema: z.object({}),
			execute: async () => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const config = loadConfig()
					const connection = config.connections[session.connectionNickname]
					const contextWindow = connection?.contextWindow ?? 128000

					// Build project context (same logic as processSession)
					let projectContext: string | undefined
					try {
						const { buildProjectContext, buildActiveProjectContext } = await import('../utils/projects')
						const parts: string[] = []
						if (session.projectSlug) {
							const activeCtx = buildActiveProjectContext(session.projectSlug)
							if (activeCtx) parts.push(activeCtx)
						}
						const shallowCtx = buildProjectContext()
						if (shallowCtx) parts.push(shallowCtx)
						if (parts.length > 0) projectContext = parts.join('\n\n---\n\n')
					} catch { /* projects module may not exist yet */ }

					const systemPrompt = buildSystemPrompt(session.summary, {
						id: session.channelId,
						userId: session.channelUserId,
						name: session.channelName,
						isSubagent: session.isSubagent,
					}, session.agentDir, { projectContext, modelContextWindow: contextWindow, sessionWorkspacePath: session.workspacePath })

					return { success: true, systemPrompt }
				} catch (err: any) {
					return { success: false, error: err.message ?? String(err) }
				}
			},
		}),

		inspect_context: tool({
			description: 'Generate a debug report showing the current system prompt, all available tools with descriptions and input schemas, session metadata, and configuration snapshot. Sends the report as a downloadable .md file attachment.',
			inputSchema: z.object({}),
			execute: async () => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const { generateInspectReport, writeInspectReport } = await import('../utils/inspectReport.ts')
					const { buildActiveTools } = await import('../utils/toolRegistry.ts')

					// Build live tool catalog with real descriptions
					let liveCatalog: Map<string, { description: string; paramsMd: string }> | undefined
					try {
						const { tools: activeTools, mcpClients } = await buildActiveTools(aiService, sessionId)
						liveCatalog = new Map()
						for (const [fullName, t] of Object.entries(activeTools)) {
							const anyT = t as any
							const description = anyT.description ?? ''
							const shape = anyT.inputSchema?._def?.shape ?? anyT.inputSchema?.def?.shape ?? {}
							const paramLines: string[] = []
							for (const [pName, field] of Object.entries(shape)) {
								const anyF = field as any
								const isOpt = (anyF.def ?? anyF._def)?.type === 'optional'
								const inner = isOpt ? (anyF.def ?? anyF._def).innerType : anyF
								const type = inner?.type ?? (inner?.def ?? inner?._def)?.type ?? 'unknown'
								const desc = anyF.meta?.()?.description ?? inner?.meta?.()?.description ?? ''
								paramLines.push(`  - \`${pName}\` (${type}${isOpt ? '?' : ''})${desc ? ` — ${desc}` : ''}`)
							}
							liveCatalog.set(fullName, { description, paramsMd: paramLines.join('\n') })
						}
						await Promise.all(mcpClients.map(c => c.close()))
					} catch {
						// Falls back to static catalog inside generateInspectReport
					}

					const report = await generateInspectReport(session, liveCatalog)
					const filePath = writeInspectReport(report, session.workspacePath)

					const buffer = Buffer.from(report, 'utf-8')
					session.emitter.emit('event', {
						type: 'file',
						name: 'inspect-context.md',
						buffer,
						mimeType: 'text/markdown',
					} as DaemonEvent)

					return { success: true, filePath, message: 'Inspection report generated and sent as a file attachment.' }
				} catch (err: unknown) {
					return { success: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		}),
	}
}
