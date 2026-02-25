import { tool } from 'ai'
import { z } from 'zod'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AIService } from '../services/aiService.ts'
import type { DaemonEvent } from '../bridge/types.ts'
import {
	getDefaultModel,
	setDefaultModel,
	getDefaultImageModels,
	setDefaultImageModels,
	getAllModelOptions,
	getAllConnections,
	getAllMcpServers,
	getInternalToolConfig,
	setInternalToolConfig,
	setMcpServerConfig,
	deleteMcpServer,
	addConnection,
	deleteConnection,
	getWorkspacePath,
	setWorkspacePath,
	getDebugMode,
	setDebugMode,
	TAMIAS_DIR,
	ProviderEnum,
	type McpServerConfig,
} from '../utils/config.ts'
import { setEnv, removeEnv, generateSecureEnvKey } from '../utils/env.ts'
import { isDaemonRunning, readDaemonInfo, getDaemonUrl } from '../utils/daemon.ts'
import { TERMINAL_TOOL_NAME } from './terminal.ts'
import { EMAIL_TOOL_NAME } from './email.ts'
import { GEMINI_TOOL_NAME } from './gemini.ts'
import { CRON_TOOL_NAME } from './cron.ts'
import { SUBAGENT_TOOL_NAME } from './subagent.ts'
import { GITHUB_TOOL_NAME } from './github.ts'
import { IMAGE_TOOL_NAME } from './image.ts'
import { saveSkill, deleteSkill, getLoadedSkills, loadSkills } from '../utils/skills.ts'
import matter from 'gray-matter'

export const TAMIAS_TOOL_NAME = 'tamias'
export const TAMIAS_TOOL_LABEL = '🤖 Tamias (self-management: models, tools, sessions, daemon)'

export const tamiasTools = {} // kept for backward compatibility if needed, but we'll use factory

export function createTamiasTools(aiService: AIService, sessionId: string) {
	return {

		get_default_model: tool({
			description: 'Get the current default model used when starting new chat sessions.',
			inputSchema: z.object({}),
			execute: async () => {
				const model = getDefaultModel()
				return { defaultModel: model ?? null }
			},
		}),

		set_default_model: tool({
			description: 'Set the default model for new chat sessions. Format: "nickname/modelId".',
			inputSchema: z.object({
				model: z.string().describe('Model in "nickname/modelId" format, e.g. "lc-openai/gpt-4o"'),
			}),
			execute: async ({ model }: { model: string }) => {
				const options = getAllModelOptions()
				if (!options.includes(model)) {
					return { success: false, error: `Model '${model}' not found. Available: ${options.join(', ')}` }
				}
				setDefaultModel(model)
				return { success: true, defaultModel: model }
			},
		}),
		get_default_image_models: tool({
			description: 'Get the current priority list of models for image generation.',
			inputSchema: z.object({}),
			execute: async () => {
				const models = getDefaultImageModels()
				return { defaultImageModels: models }
			},
		}),

		set_default_image_models: tool({
			description: 'Set the priority list for image generation models. The AI will try them in order if one fails. Format: ["nickname/modelId", ...].',
			inputSchema: z.object({
				models: z.array(z.string()).describe('Array of models in "nickname/modelId" format.'),
			}),
			execute: async ({ models }: { models: string[] }) => {
				const options = getAllModelOptions()
				const invalid = models.filter(m => !options.includes(m))
				if (invalid.length > 0) {
					return { success: false, error: `Models ${invalid.join(', ')} not found. Available: ${options.join(', ')}` }
				}
				setDefaultImageModels(models)
				return { success: true, defaultImageModels: models }
			},
		}),

		list_model_configs: tool({
			description: 'List all configured AI provider connections and their selected models.',
			inputSchema: z.object({}),
			execute: async () => {
				const connections = getAllConnections()
				const defaultModel = getDefaultModel()
				const defaultImageModels = getDefaultImageModels()
				return {
					defaultModel: defaultModel ?? null,
					defaultImageModels: defaultImageModels,
					connections: connections.map((c) => ({
						nickname: c.nickname,
						provider: c.provider,
						models: c.selectedModels ?? [],
					})),
				}
			},
		}),

		list_sessions: tool({
			description: 'List all active chat sessions on the running daemon.',
			inputSchema: z.object({}),
			execute: async () => {
				const running = await isDaemonRunning()
				if (!running) return { success: false, error: 'Daemon is not running.' }
				const res = await fetch(`${getDaemonUrl()}/sessions`)
				const sessions = await res.json()
				return { success: true, sessions }
			},
		}),

		list_tools: tool({
			description: 'List all configured internal tools and external MCP servers.',
			inputSchema: z.object({}),
			execute: async () => {
				const { WORKSPACE_TOOL_NAME } = await import('./workspace.ts')
				const knownInternal = [
					TERMINAL_TOOL_NAME,
					TAMIAS_TOOL_NAME,
					EMAIL_TOOL_NAME,
					WORKSPACE_TOOL_NAME,
					GEMINI_TOOL_NAME,
					CRON_TOOL_NAME,
					SUBAGENT_TOOL_NAME,
					GITHUB_TOOL_NAME,
					IMAGE_TOOL_NAME
				]
				const mcpServers = getAllMcpServers()
				return {
					internalTools: knownInternal.map((name) => {
						const cfg = getInternalToolConfig(name)
						return { name, enabled: cfg.enabled, functionsOverridden: Object.keys(cfg.functions ?? {}) }
					}),
					mcpServers: mcpServers.map((s) => ({
						name: s.name,
						enabled: s.enabled,
						transport: s.transport,
						label: s.label,
					})),
				}
			},
		}),

		enable_tool: tool({
			description: 'Enable an internal tool by name.',
			inputSchema: z.object({
				toolName: z.string().describe('Internal tool name, e.g. "terminal"'),
			}),
			execute: async ({ toolName }: { toolName: string }) => {
				const cfg = getInternalToolConfig(toolName)
				setInternalToolConfig(toolName, { ...cfg, enabled: true })
				return { success: true, toolName, enabled: true }
			},
		}),

		disable_tool: tool({
			description: 'Disable an internal tool by name.',
			inputSchema: z.object({
				toolName: z.string().describe('Internal tool name, e.g. "terminal"'),
			}),
			execute: async ({ toolName }: { toolName: string }) => {
				const cfg = getInternalToolConfig(toolName)
				setInternalToolConfig(toolName, { ...cfg, enabled: false })
				return { success: true, toolName, enabled: false }
			},
		}),

		add_mcp_server: tool({
			description: 'Register a new external MCP server.',
			inputSchema: z.object({
				name: z.string().describe('Short identifier for the MCP server'),
				transport: z.enum(['stdio', 'http']).describe('Transport type'),
				command: z.string().optional().describe('For stdio: command to run (e.g. "npx")'),
				args: z.array(z.string()).optional().describe('For stdio: args array'),
				url: z.string().optional().describe('For http: server URL'),
				label: z.string().optional().describe('Human-readable label'),
			}),
			execute: async (input: { name: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; label?: string }) => {
				const mcpConfig: McpServerConfig = {
					enabled: true,
					transport: input.transport,
					label: input.label,
					command: input.command,
					args: input.args,
					url: input.url,
				}
				setMcpServerConfig(input.name, mcpConfig)
				return { success: true, name: input.name, transport: input.transport }
			},
		}),

		remove_mcp_server: tool({
			description: 'Remove an external MCP server by name.',
			inputSchema: z.object({
				name: z.string().describe('MCP server name to remove'),
			}),
			execute: async ({ name }: { name: string }) => {
				try {
					deleteMcpServer(name)
					return { success: true, name }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

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
		list_channels: tool({
			description: 'List all configured communication channels (Terminal, Discord, Telegram) and their status.',
			inputSchema: z.object({}),
			execute: async () => {
				const { getBridgesConfig } = await import('../utils/config.ts')
				const bridges = getBridgesConfig()
				return {
					terminal: { enabled: bridges.terminal?.enabled !== false },
					discord: bridges.discord
						? { enabled: bridges.discord.enabled, hasToken: !!bridges.discord.botToken, allowedChannels: bridges.discord.allowedChannels }
						: {
							enabled: false,
							hasToken: false,
							setupInstructions: "1. Go to https://discord.com/developers/applications\n2. Create or select your application\n3. Go to the 'Bot' tab\n4. Click 'Reset Token' to copy your bot token. Then use configure_channel to save it."
						},
					telegram: bridges.telegram
						? { enabled: bridges.telegram.enabled, hasToken: !!bridges.telegram.botToken, allowedChats: bridges.telegram.allowedChats }
						: {
							enabled: false,
							hasToken: false,
							setupInstructions: "1. Message @BotFather on Telegram\n2. Create a new bot with /newbot\n3. Copy the API token provided. Then use configure_channel to save it."
						},
				}
			},
		}),
		configure_channel: tool({
			description: 'Enable/disable a communication channel or update its token and allowed IDs.',
			inputSchema: z.object({
				platform: z.enum(['terminal', 'discord', 'telegram']),
				enabled: z.boolean(),
				botToken: z.string().optional().describe('API token for Discord or Telegram'),
				allowedIds: z.array(z.string()).optional().describe('List of allowed channel/chat IDs'),
			}),
			execute: async ({ platform, enabled, botToken, allowedIds }) => {
				const { getBridgesConfig, setBridgesConfig } = await import('../utils/config.ts')
				const bridges = getBridgesConfig()

				if (platform === 'terminal') {
					bridges.terminal = { ...bridges.terminal, enabled }
				} else if (platform === 'discord') {
					bridges.discord = {
						enabled,
						botToken: botToken ?? bridges.discord?.botToken,
						allowedChannels: allowedIds ?? bridges.discord?.allowedChannels,
					}
				} else if (platform === 'telegram') {
					bridges.telegram = {
						enabled,
						botToken: botToken ?? bridges.telegram?.botToken,
						allowedChats: allowedIds ?? bridges.telegram?.allowedChats,
					}
				}

				setBridgesConfig(bridges)
				return { success: true, platform, enabled }
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

		add_model_connection: tool({
			description: 'Add a new AI provider connection (OpenAI, Anthropic, etc.).',
			inputSchema: z.object({
				provider: ProviderEnum,
				nickname: z.string().describe('Unique nickname for this connection'),
				apiKey: z.string().optional().describe('API Key or Access Token'),
				baseUrl: z.string().optional().describe('Optional custom base URL'),
			}),
			execute: async ({ provider, nickname, apiKey, baseUrl }) => {
				let envKeyName: string | undefined
				if (apiKey) {
					envKeyName = generateSecureEnvKey(`${nickname}_${provider}`)
					setEnv(envKeyName, apiKey)
				}
				addConnection(nickname, { provider, envKeyName, baseUrl, selectedModels: [] })
				return { success: true, nickname, provider, info: 'Connection added. Use set_default_model to use it.' }
			},
		}),

		remove_model_connection: tool({
			description: 'Remove an AI provider connection by nickname.',
			inputSchema: z.object({
				nickname: z.string(),
			}),
			execute: async ({ nickname }) => {
				try {
					deleteConnection(nickname)
					return { success: true, nickname }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		set_secret: tool({
			description: 'Securely set an environment variable in the .env file.',
			inputSchema: z.object({
				key: z.string().describe('Secret key name (e.g. CUSTOM_API_KEY)'),
				value: z.string().describe('Secret value'),
			}),
			execute: async ({ key, value }) => {
				setEnv(key, value)
				return { success: true, key }
			},
		}),

		set_workspace_path: tool({
			description: 'Set the workspace directory for file operations. MUST be a path inside ~/.tamias (e.g. ~/.tamias/workspace or ~/.tamias/workspace/<project>). Paths outside ~/.tamias are forbidden.',
			inputSchema: z.object({
				path: z.string().describe('Absolute path inside ~/.tamias, e.g. ~/.tamias/workspace/my-project'),
			}),
			execute: async ({ path }) => {
				const normalised = path.replace(/\/+$/, '')
				if (!normalised.startsWith(TAMIAS_DIR)) {
					return {
						success: false,
						error: `Workspace path must be inside ${TAMIAS_DIR}. Got: '${path}'. Use a sub-folder such as ~/.tamias/workspace or ~/.tamias/workspace/<project>.`
					}
				}
				try {
					setWorkspacePath(normalised)
					return { success: true, workspacePath: normalised }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		get_workspace_path: tool({
			description: 'Get the current restricted workspace directory path.',
			inputSchema: z.object({}),
			execute: async () => {
				return { workspacePath: getWorkspacePath() }
			},
		}),

		refresh_tools: tool({
			description: 'Reload the internal and external MCP tools. Use this after configuration changes.',
			inputSchema: z.object({}),
			execute: async () => {
				return { success: true, message: 'Tool refresh requested. If new tools do not appear, please restart the Tamias daemon.' }
			},
		}),

		send_file: tool({
			description: 'Send a file back to the current communication channel (Discord, Telegram, etc.).',
			inputSchema: z.object({
				path: z.string().describe('Absolute path or project-relative path to the file'),
				name: z.string().optional().describe('Optional name for the file in the channel'),
			}),
			execute: async ({ path, name }) => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const fullPath = path.startsWith('/') ? path : join(process.cwd(), path)
					if (!existsSync(fullPath)) {
						return { success: false, error: `File not found: ${fullPath}` }
					}

					const buffer = readFileSync(fullPath)
					const fileName = name || fullPath.split('/').pop() || 'file'

					// Detect mime type (basic)
					let mimeType = 'application/octet-stream'
					if (fileName.endsWith('.txt')) mimeType = 'text/plain'
					else if (fileName.endsWith('.md')) mimeType = 'text/markdown'
					else if (fileName.endsWith('.json')) mimeType = 'application/json'
					else if (fileName.endsWith('.png')) mimeType = 'image/png'
					else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg'
					else if (fileName.endsWith('.pdf')) mimeType = 'application/pdf'

					session.emitter.emit('event', {
						type: 'file',
						name: fileName,
						buffer,
						mimeType
					} as DaemonEvent)

					return { success: true, fileName }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		update_tamias: tool({
			description: 'Check for and install updates for Tamias CLI and dashboard.',
			inputSchema: z.object({}),
			execute: async () => {
				const { performUpdate } = await import('../utils/update.ts')
				const result = await performUpdate()
				if (result.success) {
					if (result.latestVersion && result.currentVersion !== result.latestVersion) {
						return { success: true, message: `Update complete to v${result.latestVersion}`, version: result.latestVersion }
					} else {
						return { success: true, message: `Already up to date (v${result.currentVersion})`, version: result.currentVersion }
					}
				} else {
					return { success: false, error: result.error || 'Update failed' }
				}
			},
		}),
		toggle_debug: tool({
			description: 'Toggle debug mode (adds metadata to messages and shows tool calls in CLI).',
			inputSchema: z.object({
				enabled: z.boolean().optional().describe('Force enable or disable. If omitted, toggles current state.'),
			}),
			execute: async ({ enabled }) => {
				const current = getDebugMode()
				const next = enabled !== undefined ? enabled : !current
				setDebugMode(next)
				return { success: true, debugMode: next }
			},
		}),
		save_skill: tool({
			description: 'Create or update a custom AI skill. Use this to give yourself long-term specialized instructions.',
			inputSchema: z.object({
				name: z.string().describe('Name of the skill, e.g. "React Expert"'),
				description: z.string().describe('Short description of what this skill does'),
				content: z.string().describe('The detailed instructions or knowledge for this skill in Markdown format.'),
			}),
			execute: async ({ name, description, content }) => {
				try {
					await saveSkill(name, description, content)
					// Trigger a tool refresh since skills are injected into system prompt
					return { success: true, message: `Skill '${name}' saved successfully. It will be available in future sessions.` }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),
		list_skills: tool({
			description: 'List all available custom and built-in skills.',
			inputSchema: z.object({}),
			execute: async () => {
				await loadSkills()
				const skills = getLoadedSkills()
				return {
					skills: skills.map(s => ({
						name: s.name,
						description: s.description,
						folder: s.sourceDir.split('/').pop(),
						isBuiltIn: s.isBuiltIn
					}))
				}
			},
		}),
		delete_skill: tool({
			description: 'Delete a custom user skill by its folder name.',
			inputSchema: z.object({
				folder: z.string().describe('The folder name of the skill to delete (e.g. "react-expert")'),
			}),
			execute: async ({ folder }) => {
				try {
					await deleteSkill(folder)
					return { success: true, message: `Skill folder '${folder}' deleted.` }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),
	}
}
