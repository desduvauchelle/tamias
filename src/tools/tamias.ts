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
	type McpServerConfig,
} from '../utils/config.ts'
import { isDaemonRunning, readDaemonInfo, getDaemonUrl } from '../utils/daemon.ts'
import { TERMINAL_TOOL_NAME } from './terminal.ts'

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
			const knownInternal = [TERMINAL_TOOL_NAME, TAMIAS_TOOL_NAME]
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
}
