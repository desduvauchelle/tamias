import { z } from 'zod'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export const ProviderEnum = z.enum([
	'openai',
	'anthropic',
	'google',
	'openrouter',
	'antigravity',
])

export type ProviderType = z.infer<typeof ProviderEnum>

export const ConnectionConfigSchema = z.object({
	nickname: z.string().min(1),
	provider: ProviderEnum,
	apiKey: z.string().min(1).optional(),
	// For OAuth or custom setups
	accessToken: z.string().optional(),
	// User-selected models for this connection
	selectedModels: z.array(z.string()).optional(),
	createdAt: z.string().datetime().optional(),
})

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>

// ─── Tool Config Schemas ───────────────────────────────────────────────────────

export const ToolFunctionConfigSchema = z.object({
	enabled: z.boolean().default(true),
	/** Regex patterns — at least one must match serialised call args (if set) */
	allowlist: z.array(z.string()).optional(),
})

export const InternalToolConfigSchema = z.object({
	enabled: z.boolean().default(true),
	functions: z.record(z.string(), ToolFunctionConfigSchema).optional(),
})

export const McpServerConfigSchema = z.object({
	enabled: z.boolean().default(true),
	label: z.string().optional(),
	/** 'stdio' = local process  |  'http' = remote URL */
	transport: z.enum(['stdio', 'http']),
	// stdio
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	// http
	url: z.string().url().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	functions: z.record(z.string(), ToolFunctionConfigSchema).optional(),
})

export type ToolFunctionConfig = z.infer<typeof ToolFunctionConfigSchema>
export type InternalToolConfig = z.infer<typeof InternalToolConfigSchema>
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

// ─── Main Config Schema ───────────────────────────────────────────────────────

export const TamiasConfigSchema = z.object({
	version: z.literal('1.0'),
	connections: z.record(z.string(), ConnectionConfigSchema),
	defaultConnection: z.string().optional(),
	/** The default model in "nickname/modelId" format, e.g. "lc-openai/gpt-4o" */
	defaultModel: z.string().optional(),
	internalTools: z.record(z.string(), InternalToolConfigSchema).optional(),
	mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
})

export type TamiasConfig = z.infer<typeof TamiasConfigSchema>

const getConfigPath = () => {
	const dir = join(homedir(), '.tamias')
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
	return join(dir, 'config.json')
}

export const loadConfig = (): TamiasConfig => {
	const path = getConfigPath()
	if (!existsSync(path)) {
		return { version: '1.0', connections: {} }
	}

	try {
		const data = JSON.parse(readFileSync(path, 'utf-8'))
		return TamiasConfigSchema.parse(data)
	} catch (err) {
		if (err instanceof z.ZodError) {
			console.error('Configuration file is invalid:', JSON.stringify((err as z.ZodError<any>).issues, null, 2))
			process.exit(1)
		}
		return { version: '1.0', connections: {} }
	}
}

export const saveConfig = (config: TamiasConfig): void => {
	const path = getConfigPath()
	const validated = TamiasConfigSchema.parse(config)
	writeFileSync(path, JSON.stringify(validated, null, 2), 'utf-8')
}

export const addConnection = (nickname: string, config: Omit<ConnectionConfig, 'nickname'>) => {
	const currentConfig = loadConfig()
	currentConfig.connections[nickname] = {
		nickname,
		...config,
		createdAt: new Date().toISOString(),
	}

	if (!currentConfig.defaultConnection) {
		currentConfig.defaultConnection = nickname
	}

	saveConfig(currentConfig)
}

export const updateConnection = (nickname: string, updates: Partial<Omit<ConnectionConfig, 'nickname' | 'createdAt'>>) => {
	const currentConfig = loadConfig()
	const existing = currentConfig.connections[nickname]
	if (!existing) throw new Error(`Connection '${nickname}' not found.`)
	currentConfig.connections[nickname] = { ...existing, ...updates }
	saveConfig(currentConfig)
}

export const renameConnection = (oldNickname: string, newNickname: string) => {
	const currentConfig = loadConfig()
	const existing = currentConfig.connections[oldNickname]
	if (!existing) throw new Error(`Connection '${oldNickname}' not found.`)
	currentConfig.connections[newNickname] = { ...existing, nickname: newNickname }
	delete currentConfig.connections[oldNickname]
	if (currentConfig.defaultConnection === oldNickname) {
		currentConfig.defaultConnection = newNickname
	}
	saveConfig(currentConfig)
}

export const deleteConnection = (nickname: string) => {
	const currentConfig = loadConfig()
	if (!currentConfig.connections[nickname]) throw new Error(`Connection '${nickname}' not found.`)
	delete currentConfig.connections[nickname]
	if (currentConfig.defaultConnection === nickname) {
		const remaining = Object.keys(currentConfig.connections)
		currentConfig.defaultConnection = remaining[0] ?? undefined
	}
	saveConfig(currentConfig)
}

export const getConnection = (nickname: string): ConnectionConfig | undefined => {
	const config = loadConfig()
	return config.connections[nickname]
}

export const getAllConnections = (): ConnectionConfig[] => {
	const config = loadConfig()
	return Object.values(config.connections)
}

// ─── Internal Tool Config Helpers ─────────────────────────────────────────────

export const getInternalToolConfig = (toolName: string): InternalToolConfig => {
	const config = loadConfig()
	return config.internalTools?.[toolName] ?? { enabled: true }
}

export const setInternalToolConfig = (toolName: string, toolConfig: InternalToolConfig): void => {
	const c = loadConfig()
	c.internalTools = { ...c.internalTools, [toolName]: toolConfig }
	saveConfig(c)
}

// ─── MCP Server Config Helpers ─────────────────────────────────────────────────

export const getMcpServerConfig = (name: string): McpServerConfig | undefined => {
	const config = loadConfig()
	return config.mcpServers?.[name]
}

export const getAllMcpServers = (): Array<{ name: string } & McpServerConfig> => {
	const config = loadConfig()
	return Object.entries(config.mcpServers ?? {}).map(([name, cfg]) => ({ name, ...cfg }))
}

export const setMcpServerConfig = (name: string, mcpConfig: McpServerConfig): void => {
	const c = loadConfig()
	c.mcpServers = { ...c.mcpServers, [name]: mcpConfig }
	saveConfig(c)
}

export const deleteMcpServer = (name: string): void => {
	const c = loadConfig()
	if (!c.mcpServers?.[name]) throw new Error(`MCP server '${name}' not found.`)
	delete c.mcpServers[name]
	saveConfig(c)
}

// ─── Default Model Helpers ─────────────────────────────────────────────────────

export const getDefaultModel = (): string | undefined => {
	return loadConfig().defaultModel
}

export const setDefaultModel = (model: string): void => {
	const c = loadConfig()
	c.defaultModel = model
	saveConfig(c)
}

/** Return all "nickname/modelId" pairs from all connections */
export const getAllModelOptions = (): string[] => {
	const config = loadConfig()
	const options: string[] = []
	for (const c of Object.values(config.connections)) {
		for (const m of c.selectedModels ?? []) {
			options.push(`${c.nickname}/${m}`)
		}
	}
	return options
}
