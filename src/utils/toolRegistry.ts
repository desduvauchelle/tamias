import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadConfig, getInternalToolConfig, getFirecrawlConfig, type ToolFunctionConfig, type McpServerConfig } from './config.ts'

// ── New namespace imports ────────────────────────────────────────────────────
import { createConfigTools, CONFIG_TOOL_NAME } from '../tools/configTools.ts'
import { createDaemonTools, DAEMON_TOOL_NAME } from '../tools/daemon.ts'
import { createChannelsTools, CHANNELS_TOOL_NAME } from '../tools/channels.ts'
import { createFilesTools, FILES_TOOL_NAME } from '../tools/files.ts'
import { createAgentOpsTools, AGENTS_TOOL_NAME } from '../tools/agents.ts'
import { skillsTools, SKILLS_TOOL_NAME } from '../tools/skills.ts'
import { memoryTools, MEMORY_TOOL_NAME } from '../tools/memory.ts'
import { createWebTools, WEB_TOOL_NAME } from '../tools/web.ts'
import { createMediaTools, MEDIA_TOOL_NAME } from '../tools/media.ts'
import { createProjectTools, PROJECTS_TOOL_NAME } from '../tools/projects.ts'
import { githubTools, GITHUB_TOOL_NAME } from '../tools/github.ts'
import { createCronTools, CRON_TOOL_NAME } from '../tools/cron.ts'
import { emailTools, EMAIL_TOOL_NAME } from '../tools/email.ts'
import { createComfyUITools, COMFYUI_TOOL_NAME } from '../tools/comfyui.ts'

import { getAllInternalToolNames } from '../tools/internalToolNames.ts'
import { buildToolsForDomain } from '../core/adapters/ai-tools.ts'
import { getDomains } from '../core/registry.ts'
import type { AIService } from '../services/aiService.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolSet = Record<string, any>

/**
 * Check whether a specific tool call passes the allowlist rules.
 * At least one pattern in the allowlist must match the JSON-serialised args.
 */
function passesAllowlist(allowlist: string[] | undefined, args: unknown): boolean {
	if (!allowlist || allowlist.length === 0) return true
	const serialised = JSON.stringify(args)
	return allowlist.some((pattern) => new RegExp(pattern).test(serialised))
}

/**
 * Wrap a set of tools so every call is guarded by function-level config.
 * Disabled or allowlist-blocked calls immediately return an error.
 */
function applyFunctionConfig(
	tools: ToolSet,
	functionConfigs: Record<string, ToolFunctionConfig> | undefined,
): ToolSet {
	if (!functionConfigs) return tools
	const filtered: ToolSet = {}
	for (const [name, t] of Object.entries(tools)) {
		const fnCfg = functionConfigs[name]
		if (fnCfg && !fnCfg.enabled) continue
		if (fnCfg?.allowlist && fnCfg.allowlist.length > 0) {
			const orig = t as { execute: (args: unknown, opts: unknown) => Promise<unknown> }
			filtered[name] = {
				...t,
				execute: async (args: unknown, opts: unknown) => {
					if (!passesAllowlist(fnCfg.allowlist, args)) {
						return { success: false, error: `Allowlist blocked: no pattern matched for '${name}'.` }
					}
					return orig.execute(args, opts)
				},
			}
		} else {
			filtered[name] = t
		}
	}
	return filtered
}

/**
 * Build a merged tools object from all enabled internal tools + external MCPs.
 */
export async function buildActiveTools(aiService: AIService, sessionId: string): Promise<{
	tools: ToolSet
	mcpClients: Array<{ close: () => Promise<void> }>
	toolNames: string[]
}> {
	const config = loadConfig()
	const mergedTools: ToolSet = {}
	const mcpClients: Array<{ close: () => Promise<void> }> = []
	const toolNames: string[] = []

	// ── Internal tools ────────────────────────────────────────────────────────
	const session = aiService.getSession(sessionId)
	const sessionWorkspacePath = session?.workspacePath

	const internalCatalog: Record<string, ToolSet> = {
		[CONFIG_TOOL_NAME]: createConfigTools(aiService, sessionId) as ToolSet,
		[DAEMON_TOOL_NAME]: createDaemonTools(aiService, sessionId) as ToolSet,
		[CHANNELS_TOOL_NAME]: createChannelsTools(aiService, sessionId) as ToolSet,
		[FILES_TOOL_NAME]: createFilesTools(aiService, sessionId, sessionWorkspacePath) as ToolSet,
		[SKILLS_TOOL_NAME]: skillsTools as ToolSet,
		[MEMORY_TOOL_NAME]: memoryTools as ToolSet,
		[WEB_TOOL_NAME]: createWebTools(aiService, sessionId) as ToolSet,
		[MEDIA_TOOL_NAME]: createMediaTools(aiService, sessionId, sessionWorkspacePath) as ToolSet,
		[PROJECTS_TOOL_NAME]: createProjectTools({
			sessionProjectSlug: session?.projectSlug,
			channelUserId: session?.channelUserId,
		}) as ToolSet,
		[GITHUB_TOOL_NAME]: githubTools as ToolSet,
		[CRON_TOOL_NAME]: createCronTools(aiService, sessionId) as ToolSet,
		[EMAIL_TOOL_NAME]: emailTools as ToolSet,
		[COMFYUI_TOOL_NAME]: createComfyUITools(aiService, sessionId) as ToolSet,
	}

	// ── Auto-wire registry-backed domains ────────────────────────────────────
	// Core domains registered in src/core/domains/ are auto-discovered here.
	// For 'agents': merge registry-backed CRUD with manual agent-ops tools.
	for (const domain of getDomains()) {
		const registryTools = buildToolsForDomain(domain) as ToolSet
		if (domain === AGENTS_TOOL_NAME) {
			// Merge registry CRUD (create, update, remove, list, show) with
			// manual agent-ops (spawn, callback, progress, transfer, etc.)
			internalCatalog[domain] = {
				...registryTools,
				...createAgentOpsTools(aiService, sessionId),
			} as ToolSet
		} else if (!(domain in internalCatalog)) {
			internalCatalog[domain] = registryTools
		}
	}

	// Conformance: every declared name (legacy + registry) must be wired
	const allNames = getAllInternalToolNames()
	for (const name of allNames) {
		if (!(name in internalCatalog)) {
			throw new Error(`Internal tool namespace '${name}' is declared but not wired in tool registry`)
		}
	}

	for (const [toolName, allFunctions] of Object.entries(internalCatalog)) {
		// Firecrawl config gate: the 'scrape' tool lives in the 'web' namespace
		// but is only included if firecrawl is explicitly enabled in config.
		let toolFunctions = allFunctions
		if (toolName === WEB_TOOL_NAME && !getFirecrawlConfig().enabled) {
			const { scrape, ...rest } = allFunctions
			toolFunctions = rest
		}

		const toolCfg = getInternalToolConfig(toolName)
		if (!toolCfg.enabled) continue

		const guarded = applyFunctionConfig(toolFunctions, toolCfg.functions)
		if (Object.keys(guarded).length > 0) {
			for (const [fnName, fn] of Object.entries(guarded)) {
				const fullName = `${toolName}__${fnName}`
				mergedTools[fullName] = fn
			}
			toolNames.push(`internal:${toolName}`)
		}
	}

	// ── External MCPs ─────────────────────────────────────────────────────────
	for (const [name, mcpCfg] of Object.entries(config.mcpServers ?? {})) {
		if (!mcpCfg.enabled) continue
		try {
			const { client, tools: mcpTools } = await connectMcpServer(name, mcpCfg)
			const guarded = applyFunctionConfig(mcpTools, mcpCfg.functions)
			if (Object.keys(guarded).length > 0) {
				for (const [fnName, fn] of Object.entries(guarded)) {
					const fullName = `${name}__${fnName}`
					mergedTools[fullName] = fn
				}
				toolNames.push(`mcp:${name}`)
			}
			mcpClients.push(client)
		} catch (err) {
			console.error(`⚠️  Failed to connect to MCP server '${name}': ${err}`)
		}
	}

	return { tools: mergedTools, mcpClients, toolNames }
}

async function connectMcpServer(name: string, cfg: McpServerConfig) {
	const client = new Client({ name: `tamias-${name}`, version: '1.0.0' })

	if (cfg.transport === 'stdio') {
		if (!cfg.command) throw new Error(`MCP server '${name}' missing 'command'`)
		const transport = new StdioClientTransport({
			command: cfg.command,
			args: cfg.args ?? [],
			env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
		})
		await client.connect(transport)
	} else {
		if (!cfg.url) throw new Error(`MCP server '${name}' missing 'url'`)
		const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
			requestInit: { headers: cfg.headers },
		})
		await client.connect(transport)
	}

	// Fetch tool list from the MCP server and wrap as AI SDK dynamic tools
	const listResult = await client.listTools()
	const tools: ToolSet = {}

	for (const mcpTool of listResult.tools) {
		tools[mcpTool.name] = {
			type: 'dynamic',
			description: mcpTool.description ?? '',
			execute: async (args: unknown) => {
				const result = await client.callTool({ name: mcpTool.name, arguments: args as Record<string, unknown> })
				return result.content
			},
		}
	}

	return { client: { close: () => client.close() }, tools }
}
