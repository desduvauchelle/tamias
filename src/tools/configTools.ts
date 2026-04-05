import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import {
	getDefaultModel,
	setDefaultModel,
	getDefaultImageModels,
	setDefaultImageModels,
	getCompactionModel,
	setCompactionModel,
	getAllModelOptions,
	getAllConnections,
	getAllMcpServers,
	getInternalToolConfig,
	setInternalToolConfig,
	setMcpServerConfig,
	deleteMcpServer,
	addConnection,
	deleteConnection,
	getDebugMode,
	setDebugMode,
	ProviderEnum,
	type McpServerConfig,
} from '../utils/config.ts'
import { setEnv, generateSecureEnvKey } from '../utils/env.ts'
import { getAllInternalToolNames } from './internalToolNames.ts'

export const CONFIG_TOOL_NAME = 'config'
export const CONFIG_TOOL_LABEL = '⚙️ Config (models, connections, tools, MCP servers, secrets, debug)'

export function createConfigTools(aiService: AIService, sessionId: string) {
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

		get_compaction_model: tool({
			description: 'Get the current model used for session compaction (memory summarization). A cheap, fast model is recommended.',
			inputSchema: z.object({}),
			execute: async () => {
				const model = getCompactionModel()
				return { compactionModel: model ?? null, note: model ? undefined : 'No compaction model set — using the default chat model (more expensive). Run set_compaction_model with a cheap model like mini/flash/haiku.' }
			},
		}),

		set_compaction_model: tool({
			description: 'Set the model for session compaction (memory summarization). Use a cheap, fast model (e.g. mini/flash/haiku). Format: "nickname/modelId".',
			inputSchema: z.object({
				model: z.string().describe('Model in "nickname/modelId" format, e.g. "openrouter/google/gemini-2.0-flash-001"'),
			}),
			execute: async ({ model }: { model: string }) => {
				const options = getAllModelOptions()
				if (!options.includes(model)) {
					return { success: false, error: `Model '${model}' not found. Available: ${options.join(', ')}` }
				}
				setCompactionModel(model)
				return { success: true, compactionModel: model }
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

		list_tools: tool({
			description: 'List all configured internal tools and external MCP servers.',
			inputSchema: z.object({}),
			execute: async () => {
				const mcpServers = getAllMcpServers()
				return {
					internalTools: getAllInternalToolNames().map((name) => {
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
	}
}
