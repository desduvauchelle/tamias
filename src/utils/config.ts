import { z } from 'zod'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getEnv, setEnv, removeEnv, generateSecureEnvKey } from './env.ts'

export const TAMIAS_DIR = join(homedir(), '.tamias')
export const getConfigFilePath = () => process.env.TAMIAS_CONFIG_PATH || join(TAMIAS_DIR, 'config.json')
export const CONFIG_PATH = getConfigFilePath() // For legacy/external export

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

export const DiscordBotConfigSchema = z.object({
	enabled: z.boolean().default(false),
	envKeyName: z.string().optional(),
	botToken: z.string().optional(), // legacy plaintext (migrated on load)
	allowedChannels: z.array(z.string()).optional(),
	/** Channel mode: full = all messages, mention-only = only @mentions, listen-only = read but never respond */
	mode: z.enum(['full', 'mention-only', 'listen-only']).default('full').optional(),
})

export const TelegramBotConfigSchema = z.object({
	enabled: z.boolean().default(false),
	envKeyName: z.string().optional(),
	botToken: z.string().optional(), // legacy plaintext (migrated on load)
	allowedChats: z.array(z.string()).optional(),
	/** Channel mode: full = all messages, mention-only = only @mentions, listen-only = read but never respond */
	mode: z.enum(['full', 'mention-only', 'listen-only']).default('full').optional(),
})

export type DiscordBotConfig = z.infer<typeof DiscordBotConfigSchema>
export type TelegramBotConfig = z.infer<typeof TelegramBotConfigSchema>

export const WhatsAppBotConfigSchema = z.object({
	enabled: z.boolean().default(false),
	/** WhatsApp Business Cloud API phone number ID */
	phoneNumberId: z.string().optional(),
	/** Env var name for the access token */
	envKeyName: z.string().optional(),
	/** Webhook verification token */
	verifyToken: z.string().optional(),
	/** Webhook path (e.g., /webhook/whatsapp/default) */
	webhookPath: z.string().optional(),
	/** Channel mode: full = all messages, mention-only = only @mentions */
	mode: z.enum(['full', 'mention-only']).default('full').optional(),
})

export type WhatsAppBotConfig = z.infer<typeof WhatsAppBotConfigSchema>

export const BridgesConfigSchema = z.object({
	terminal: z.object({
		enabled: z.boolean().default(true),
	}).default({ enabled: true }),
	/** Multi-instance Discord bots, keyed by a user-chosen nickname */
	discords: z.record(z.string(), DiscordBotConfigSchema).optional(),
	/** Multi-instance Telegram bots, keyed by a user-chosen nickname */
	telegrams: z.record(z.string(), TelegramBotConfigSchema).optional(),
	/** Multi-instance WhatsApp Business API bridges, keyed by a user-chosen nickname */
	whatsapps: z.record(z.string(), WhatsAppBotConfigSchema).optional(),
	/** @deprecated Use `discords` instead. Kept only for seamless migration. */
	discord: DiscordBotConfigSchema.optional(),
	/** @deprecated Use `telegrams` instead. Kept only for seamless migration. */
	telegram: TelegramBotConfigSchema.optional(),
})

export type BridgesConfig = z.infer<typeof BridgesConfigSchema>

// ─── Main Config Schema ───────────────────────────────────────────────────────

export const TamiasConfigSchema = z.object({
	version: z.literal('1.0'),
	connections: z.record(z.string(), ConnectionConfigSchema),
	defaultConnection: z.string().optional(),
	/** The priority list of models in "nickname/modelId" format, e.g. ["lc-openai/gpt-4o", "anthropic/claude-3-5-sonnet"] */
	defaultModels: z.array(z.string()).optional(),
	/** Image generation model priority */
	defaultImageModels: z.array(z.string()).optional(),
	internalTools: z.record(z.string(), InternalToolConfigSchema).optional(),
	mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
	bridges: BridgesConfigSchema.default({ terminal: { enabled: true } }),
	workspacePath: z.string().optional(),
	debug: z.boolean().default(false),
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
	/** Sandbox configuration for container-isolated tool execution */
	sandbox: z.object({
		/** Container engine: 'none' = no sandboxing, 'docker' or 'podman' */
		engine: z.enum(['none', 'docker', 'podman']).default('none'),
		/** Container image to use (default: ubuntu:22.04) */
		image: z.string().default('ubuntu:22.04'),
		/** Memory limit (e.g., '512m', '1g') */
		memoryLimit: z.string().default('512m'),
		/** CPU limit (e.g., '1.0' = one CPU core) */
		cpuLimit: z.string().default('1.0'),
		/** Network access inside container */
		networkEnabled: z.boolean().default(false),
		/** Command timeout in seconds */
		timeout: z.number().default(30),
	}).default({ engine: 'none', image: 'ubuntu:22.04', memoryLimit: '512m', cpuLimit: '1.0', networkEnabled: false, timeout: 30 }).optional(),
})

export type TamiasConfig = z.infer<typeof TamiasConfigSchema>

export const TAMIAS_WORKSPACE_DIR = join(TAMIAS_DIR, 'workspace')

export const getDefaultWorkspacePath = () => {
	// AI file creation lives in ~/.tamias/workspace — always within ~/.tamias
	return TAMIAS_WORKSPACE_DIR
}

const getConfigPath = () => {
	const path = getConfigFilePath()
	const dir = dirname(path)
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
	return path
}

export const loadConfig = (): TamiasConfig => {
	const path = getConfigPath()
	if (!existsSync(path)) {
		return {
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			workspacePath: getDefaultWorkspacePath(),
			debug: false
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

		// Migrate Bridges — step 1: plaintext botToken → env var (legacy single-instance)
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

		// Migrate Bridges — step 2: single-instance → multi-instance record
		// Also handles botToken inside discords/telegrams entries
		if (data.bridges.discord) {
			if (!data.bridges.discords) data.bridges.discords = {}
			if (!data.bridges.discords.default) {
				data.bridges.discords.default = data.bridges.discord
			}
			delete (data.bridges as any).discord
			needsMigration = true
		}
		if (data.bridges.telegram) {
			if (!data.bridges.telegrams) data.bridges.telegrams = {}
			if (!data.bridges.telegrams.default) {
				data.bridges.telegrams.default = data.bridges.telegram
			}
			delete (data.bridges as any).telegram
			needsMigration = true
		}

		// Migrate Bridges — step 3: plaintext botToken inside multi-instance entries
		for (const [key, cfg] of Object.entries(data.bridges.discords ?? {})) {
			if (cfg.botToken) {
				const envKey = generateSecureEnvKey(`DISCORD_${key.toUpperCase()}`)
				setEnv(envKey, cfg.botToken)
				cfg.envKeyName = envKey
				delete cfg.botToken
				needsMigration = true
			}
		}
		for (const [key, cfg] of Object.entries(data.bridges.telegrams ?? {})) {
			if (cfg.botToken) {
				const envKey = generateSecureEnvKey(`TELEGRAM_${key.toUpperCase()}`)
				setEnv(envKey, cfg.botToken)
				cfg.envKeyName = envKey
				delete cfg.botToken
				needsMigration = true
			}
		}

		// Migrate legacy single email tool config
		// Must read from rawData since Zod strips unknown top-level keys like 'email'
		if (rawData.email) {
			const old = rawData.email
			const nickname = 'default'
			data.emails = { [nickname]: { ...old, nickname, isDefault: true } }
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
		return { version: '1.0', connections: {}, bridges: { terminal: { enabled: true } }, debug: false }
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

export const getDefaultImageModels = (): string[] => {
	return loadConfig().defaultImageModels || []
}

export const setDefaultImageModels = (models: string[]): void => {
	const c = loadConfig()
	c.defaultImageModels = models
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

// ─── Bridge Config Helpers ─────────────────────────────────────────────────────

export const getBridgesConfig = (): BridgesConfig => {
	const config = loadConfig()
	return config.bridges ?? { terminal: { enabled: true } }
}

/** Get sandbox configuration */
export const getSandboxConfig = () => {
	const config = loadConfig()
	return config.sandbox ?? { engine: 'none' as const, image: 'ubuntu:22.04', memoryLimit: '512m', cpuLimit: '1.0', networkEnabled: false, timeout: 30 }
}

/** Get the bot token for a specific named instance */
export const getBotTokenForInstance = (platform: 'discords' | 'telegrams', key: string): string | undefined => {
	const bridges = getBridgesConfig()
	const cfg = bridges[platform]?.[key]
	if (!cfg?.envKeyName) return undefined
	return getEnv(cfg.envKeyName)
}

/** @deprecated Use getBotTokenForInstance('discords'/'telegrams', key) — kept for backward compat */
export const getBotTokenForBridge = (platform: 'discord' | 'telegram'): string | undefined => {
	return getBotTokenForInstance(platform === 'discord' ? 'discords' : 'telegrams', 'default')
}

export const getAllDiscordInstances = (): Record<string, DiscordBotConfig> => {
	return getBridgesConfig().discords ?? {}
}

export const getAllTelegramInstances = (): Record<string, TelegramBotConfig> => {
	return getBridgesConfig().telegrams ?? {}
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
	// Security: workspace must always be within ~/.tamias
	const realTamias = TAMIAS_DIR
	const normalised = path.replace(/\/+$/, '') // strip trailing slashes
	if (!normalised.startsWith(realTamias)) {
		throw new Error(
			`Workspace path must be inside ~/.tamias (got '${path}'). ` +
			`Use a sub-folder such as ~/.tamias/workspace or ~/.tamias/workspace/<project>.`
		)
	}
	const c = loadConfig()
	c.workspacePath = normalised
	if (!existsSync(normalised)) {
		mkdirSync(normalised, { recursive: true })
	}
	saveConfig(c)
}

// ─── Debug Config Helpers ─────────────────────────────────────────────────────

export const getDebugMode = (): boolean => {
	return loadConfig().debug ?? false
}

export const setDebugMode = (enabled: boolean): void => {
	const c = loadConfig()
	c.debug = enabled
	saveConfig(c)
}
