import { z } from 'zod'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getEnv, setEnv, removeEnv, generateSecureEnvKey } from './env.ts'

export const TAMIAS_DIR = join(homedir(), '.tamias')
export const CONFIG_PATH = join(TAMIAS_DIR, 'config.json')

export const ProviderEnum = z.enum([
	'openai',
	'anthropic',
	'google',
	'openrouter',
	'antigravity',
	'ollama',
])

export type ProviderType = z.infer<typeof ProviderEnum>

export const ConnectionConfigSchema = z.object({
	nickname: z.string().min(1),
	provider: ProviderEnum,
	/** The name of the environment variable (in .env) that holds the API key or Access Token */
	envKeyName: z.string().optional(),
	// Legacy fields (kept optional for migration)
	apiKey: z.string().optional(),
	accessToken: z.string().optional(),
	baseUrl: z.string().url().optional().or(z.literal('')),
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

// ─── Bridge Config Schemas ─────────────────────────────────────────────────────

export const BridgesConfigSchema = z.object({
	terminal: z.object({
		enabled: z.boolean().default(true),
	}).default({ enabled: true }),
	discord: z.object({
		enabled: z.boolean().default(false),
		envKeyName: z.string().optional(),
		botToken: z.string().optional(), // legacy
		allowedChannels: z.array(z.string()).optional(),
	}).optional(),
	telegram: z.object({
		enabled: z.boolean().default(false),
		envKeyName: z.string().optional(),
		botToken: z.string().optional(), // legacy
		allowedChats: z.array(z.string()).optional(),
	}).optional(),
})

export type BridgesConfig = z.infer<typeof BridgesConfigSchema>

// ─── Main Config Schema ───────────────────────────────────────────────────────

export const TamiasConfigSchema = z.object({
	version: z.literal('1.0'),
	connections: z.record(z.string(), ConnectionConfigSchema),
	defaultConnection: z.string().optional(),
	/** The priority list of models in "nickname/modelId" format, e.g. ["lc-openai/gpt-4o", "anthropic/claude-3-5-sonnet"] */
	defaultModels: z.array(z.string()).optional(),
	internalTools: z.record(z.string(), InternalToolConfigSchema).optional(),
	mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
	bridges: BridgesConfigSchema.default({ terminal: { enabled: true } }),
	workspacePath: z.string().optional(),
	emails: z.record(z.string(), z.object({
		nickname: z.string(),
		enabled: z.boolean().default(false),
		service: z.enum(['gmail', 'outlook', 'icloud', 'other']).default('gmail'),
		email: z.string().optional(),
		envKeyName: z.string().optional(),
		appPassword: z.string().optional(), // legacy/temp
		accountName: z.string().default('personal'),
		isDefault: z.boolean().default(false),
		permissions: z.object({
			whitelist: z.array(z.string()).default([]),
			canSend: z.boolean().default(true),
		}).default({ whitelist: [], canSend: true }),
	})).optional(),
})

export type TamiasConfig = z.infer<typeof TamiasConfigSchema>

export const getDefaultWorkspacePath = () => {
	// Everything lives in ~/.tamias, including the AI's operating context
	return TAMIAS_DIR
}

const getConfigPath = () => {
	if (!existsSync(TAMIAS_DIR)) {
		mkdirSync(TAMIAS_DIR, { recursive: true })
	}
	return CONFIG_PATH
}

export const loadConfig = (): TamiasConfig => {
	const path = getConfigPath()
	if (!existsSync(path)) {
		return {
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			workspacePath: getDefaultWorkspacePath()
		}
	}

	try {
		const rawData = JSON.parse(readFileSync(path, 'utf-8'))
		const data = TamiasConfigSchema.parse(rawData)

		let needsMigration = false

		// Migrate Connections
		for (const [key, conn] of Object.entries(data.connections)) {
			if (conn.apiKey || conn.accessToken) {
				const secretStr = conn.apiKey || conn.accessToken
				const envKey = generateSecureEnvKey(`${conn.nickname}_${conn.provider}`)
				setEnv(envKey, secretStr!)
				conn.envKeyName = envKey
				delete conn.apiKey
				delete conn.accessToken
				needsMigration = true
			}
		}

		// Migrate Bridges
		if (data.bridges.discord?.botToken) {
			const envKey = generateSecureEnvKey('DISCORD')
			setEnv(envKey, data.bridges.discord.botToken)
			data.bridges.discord.envKeyName = envKey
			delete data.bridges.discord.botToken
			needsMigration = true
		}
		if (data.bridges.telegram?.botToken) {
			const envKey = generateSecureEnvKey('TELEGRAM')
			setEnv(envKey, data.bridges.telegram.botToken)
			data.bridges.telegram.envKeyName = envKey
			delete data.bridges.telegram.botToken
			needsMigration = true
		}

		// Migrate legacy single email tool config
		const legacyData = data as any
		if (legacyData.email) {
			const old = legacyData.email
			const nickname = 'default'
			data.emails = { [nickname]: { ...old, nickname, isDefault: true } }
			delete legacyData.email
			needsMigration = true
		}

		if (data.emails) {
			for (const [key, emailCfg] of Object.entries(data.emails)) {
				if (emailCfg.appPassword) {
					const envKey = generateSecureEnvKey(`EMAIL_${key.toUpperCase()}`)
					setEnv(envKey, emailCfg.appPassword)
					const anyCfg = emailCfg as any
					anyCfg.envKeyName = envKey
					delete anyCfg.appPassword
					needsMigration = true
				}
			}
		}

		// Migrate workspacePath
		if (!data.workspacePath) {
			data.workspacePath = getDefaultWorkspacePath()
			if (!existsSync(data.workspacePath)) {
				mkdirSync(data.workspacePath, { recursive: true })
			}
			needsMigration = true
		}

		// Migrate defaultModel to defaultModels
		const legacyConfig = rawData as any
		if (legacyConfig.defaultModel && !data.defaultModels) {
			data.defaultModels = [legacyConfig.defaultModel]
			needsMigration = true
		}

		// Proactive cleanup of defaultModels entries for connections that no longer exist.
		// Only applies when there are configured connections — if connections is empty we can't
		// distinguish "just set up" from "all deleted", so we leave defaultModels alone.
		const validNicknames = new Set(Object.keys(data.connections))
		if (validNicknames.size > 0 && data.defaultModels?.length) {
			const pruned = data.defaultModels.filter(m => {
				const [nick] = m.split('/')
				return validNicknames.has(nick)
			})
			if (pruned.length !== data.defaultModels.length) {
				data.defaultModels = pruned
				needsMigration = true
			}
		}

		if (needsMigration) {
			saveConfig(data) // Remove plaintext secrets from the config file immediately
		}

		return data
	} catch (err) {
		if (err instanceof z.ZodError) {
			console.error('Configuration file is invalid:', JSON.stringify(err.issues, null, 2))
			process.exit(1)
		}
		console.error('Failed to load config file, using defaults:', err)
		return { version: '1.0', connections: {}, bridges: { terminal: { enabled: true } } }
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
	// Update any defaultModels entries that referenced the old nickname
	if (currentConfig.defaultModels?.length) {
		currentConfig.defaultModels = currentConfig.defaultModels.map(m =>
			m.startsWith(`${oldNickname}/`) ? `${newNickname}/${m.slice(oldNickname.length + 1)}` : m
		)
	}
	saveConfig(currentConfig)
}

export const deleteConnection = (nickname: string) => {
	const currentConfig = loadConfig()
	const conn = currentConfig.connections[nickname]
	if (!conn) throw new Error(`Connection '${nickname}' not found.`)

	if (conn.envKeyName) removeEnv(conn.envKeyName)

	delete currentConfig.connections[nickname]
	if (currentConfig.defaultConnection === nickname) {
		const remaining = Object.keys(currentConfig.connections)
		currentConfig.defaultConnection = remaining[0] ?? undefined
	}
	// Prune any defaultModels entries that belonged to this connection
	if (currentConfig.defaultModels?.length) {
		currentConfig.defaultModels = currentConfig.defaultModels.filter(
			m => !m.startsWith(`${nickname}/`)
		)
	}
	saveConfig(currentConfig)
}

export const getConnection = (nickname: string): ConnectionConfig | undefined => {
	const config = loadConfig()
	return config.connections[nickname]
}

export const getApiKeyForConnection = (nickname: string): string | undefined => {
	const conn = getConnection(nickname)
	if (!conn || !conn.envKeyName) return undefined
	return getEnv(conn.envKeyName)
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
	const models = loadConfig().defaultModels
	return models?.[0]
}

export const getDefaultModels = (): string[] => {
	return loadConfig().defaultModels || []
}

export const setDefaultModels = (models: string[]): void => {
	const c = loadConfig()
	c.defaultModels = models
	saveConfig(c)
}

export const setDefaultModel = (model: string): void => {
	setDefaultModels([model])
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

// ─── Bridge Config Helpers ─────────────────────────────────────────────────────

export const getBridgesConfig = (): BridgesConfig => {
	const config = loadConfig()
	return config.bridges ?? { terminal: { enabled: true } }
}

export const getBotTokenForBridge = (platform: 'discord' | 'telegram'): string | undefined => {
	const bridges = getBridgesConfig()
	const config = bridges[platform]
	if (!config || !config.envKeyName) return undefined
	return getEnv(config.envKeyName)
}

export const setBridgesConfig = (bridgesConfig: BridgesConfig): void => {
	const c = loadConfig()
	c.bridges = bridgesConfig
	saveConfig(c)
}

export const getAllEmailConfigs = () => {
	const config = loadConfig()
	return config.emails ?? {}
}

export const getEmailConfig = (nickname?: string) => {
	const emails = getAllEmailConfigs()
	if (nickname) return emails[nickname]
	// Or first enabled one or marked as default
	return Object.values(emails).find(e => e.isDefault) || Object.values(emails)[0]
}

export const getEmailPassword = (nickname?: string): string | undefined => {
	const config = getEmailConfig(nickname)
	if (!config || !config.envKeyName) return undefined
	return getEnv(config.envKeyName)
}

export const setEmailConfig = (nickname: string, config: any): void => {
	const c = loadConfig()
	if (!c.emails) c.emails = {}
	c.emails[nickname] = config
	saveConfig(c)
}

export const updateEmailConfig = (nickname: string, config: any): void => {
	const c = loadConfig()
	if (!c.emails || !c.emails[nickname]) throw new Error(`Email account '${nickname}' not found.`)
	c.emails[nickname] = { ...c.emails[nickname], ...config }
	saveConfig(c)
}

export const deleteEmailConfig = (nickname: string): void => {
	const c = loadConfig()
	if (!c.emails || !c.emails[nickname]) throw new Error(`Email account '${nickname}' not found.`)
	delete c.emails[nickname]
	saveConfig(c)
}

export const renameEmailConfig = (oldNickname: string, newNickname: string): void => {
	const c = loadConfig()
	if (!c.emails || !c.emails[oldNickname]) throw new Error(`Email account '${oldNickname}' not found.`)
	if (c.emails[newNickname]) throw new Error(`Email account '${newNickname}' already exists.`)
	c.emails[newNickname] = { ...c.emails[oldNickname], nickname: newNickname }
	delete c.emails[oldNickname]
	saveConfig(c)
}

export const getWorkspacePath = (): string => {
	return loadConfig().workspacePath || getDefaultWorkspacePath()
}

export const setWorkspacePath = (path: string): void => {
	const c = loadConfig()
	c.workspacePath = path
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true })
	}
	saveConfig(c)
}
