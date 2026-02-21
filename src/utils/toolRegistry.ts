import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadConfig, getInternalToolConfig, type ToolFunctionConfig, type McpServerConfig } from './config.ts'
import { terminalTools, TERMINAL_TOOL_NAME } from '../tools/terminal.ts'
import { tamiasTools, TAMIAS_TOOL_NAME } from '../tools/tamias.ts'
import { cronTools, CRON_TOOL_NAME } from '../tools/cron.ts'
import { emailTools, EMAIL_TOOL_NAME } from '../tools/email.ts'
import { githubTools, GITHUB_TOOL_NAME } from '../tools/github.ts'
import { workspaceTools, WORKSPACE_TOOL_NAME } from '../tools/workspace.ts'
import { geminiTools, GEMINI_TOOL_NAME } from '../tools/gemini.ts'
import { createSubagentTools, SUBAGENT_TOOL_NAME } from '../tools/subagent.ts'
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
	const internalCatalog: Record<string, ToolSet> = {
		[TERMINAL_TOOL_NAME]: terminalTools as ToolSet,
		[TAMIAS_TOOL_NAME]: tamiasTools as ToolSet,
		[CRON_TOOL_NAME]: cronTools as ToolSet,
		[EMAIL_TOOL_NAME]: emailTools as ToolSet,
		[GITHUB_TOOL_NAME]: githubTools as ToolSet,
		[WORKSPACE_TOOL_NAME]: workspaceTools as ToolSet,
		[GEMINI_TOOL_NAME]: geminiTools as ToolSet,
		[SUBAGENT_TOOL_NAME]: createSubagentTools(aiService, sessionId) as ToolSet,
	}

	for (const [toolName, allFunctions] of Object.entries(internalCatalog)) {
		const toolCfg = getInternalToolConfig(toolName)
		if (!toolCfg.enabled) continue

		const guarded = applyFunctionConfig(allFunctions, toolCfg.functions)
		for (const [fnName, fn] of Object.entries(guarded)) {
			mergedTools[`${toolName}__${fnName}`] = fn
		}
		toolNames.push(`internal:${toolName}`)
	}

	// ── External MCPs ─────────────────────────────────────────────────────────
	for (const [name, mcpCfg] of Object.entries(config.mcpServers ?? {})) {
		if (!mcpCfg.enabled) continue
		try {
			const { client, tools } = await connectMcpServer(name, mcpCfg)
			const guarded = applyFunctionConfig(tools, mcpCfg.functions)
			for (const [fnName, fn] of Object.entries(guarded)) {
				mergedTools[`${name}__${fnName}`] = fn
			}
			mcpClients.push(client)
			toolNames.push(`mcp:${name}`)
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
