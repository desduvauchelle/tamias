import { tool } from 'ai'
import { z } from 'zod'
import {
	getDefaultModel,
	setDefaultModel,
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

export const TAMIAS_TOOL_NAME = 'tamias'
export const TAMIAS_TOOL_LABEL = '🤖 Tamias (self-management: models, tools, sessions, daemon)'

export const tamiasTools = {

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

	list_model_configs: tool({
		description: 'List all configured AI provider connections and their selected models.',
		inputSchema: z.object({}),
		execute: async () => {
			const connections = getAllConnections()
			const defaultModel = getDefaultModel()
			return {
				defaultModel: defaultModel ?? null,
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
				GITHUB_TOOL_NAME
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
		description: 'Set the absolute path for the restricted workspace terminal.',
		inputSchema: z.object({
			path: z.string().describe('Absolute path to the workspace directory'),
		}),
		execute: async ({ path }) => {
			setWorkspacePath(path)
			return { success: true, workspacePath: path }
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
			// This depends on the specific AIService instance, but we can try to trigger it
			// if we have access to the global service or if the service listens for a signal.
			// For now, we'll return a message that a restart might be needed if this doesn't work.
			return { success: true, message: 'Tool refresh requested. If new tools do not appear, please restart the Tamias daemon.' }
		},
	}),
}
