import { z } from 'zod'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { getEnv, setEnv, removeEnv, generateSecureEnvKey } from './env'
import { TOOL_NAMESPACE_RENAMES, TAMIAS_SUCCESSORS } from '../tools/namespaceMigration'

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
	/** User-facing description (e.g. "Personal token from OpenRouter dashboard") */
	description: z.string().optional(),

	baseUrl: z.string().url().optional().or(z.literal('')),
	// User-selected models for this connection
	selectedModels: z.array(z.string()).optional(),
	/** Override context window size (tokens) for this connection's models */
	contextWindow: z.number().int().positive().optional(),
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

	allowedChannels: z.array(z.string()).optional(),
	/** Channel mode: full = all messages, mention-only = only @mentions, listen-only = read but never respond */
	mode: z.enum(['full', 'mention-only', 'listen-only']).default('full').optional(),
})

export const TelegramBotConfigSchema = z.object({
	enabled: z.boolean().default(false),
	envKeyName: z.string().optional(),

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

export const WhatsAppUnofficialConfigSchema = z.object({
	enabled: z.boolean().default(false),
	/** Channel mode: full = send and receive, read-only = receive only (no outbound), mention-only = respond only when message matches mentionPattern */
	mode: z.enum(['full', 'read-only', 'mention-only']).default('read-only').optional(),
	/** Allowed group JIDs (e.g. '120363022222222222@g.us'). Use '*' for all groups. Empty = none. */
	allowedGroups: z.array(z.string()).optional(),
	/** Allowed contact phone numbers in E.164 format (e.g. '+1234567890'). Use '*' for all DMs. Empty = none. */
	allowedContacts: z.array(z.string()).optional(),
	/** Regex used when mode is mention-only. Case-insensitive by default in bridge runtime. */
	mentionPattern: z.string().optional(),
	/** Override the auth directory path (default: ~/.tamias/whatsapp-auth/<key>) */
	authDir: z.string().optional(),
})

export type WhatsAppUnofficialConfig = z.infer<typeof WhatsAppUnofficialConfigSchema>

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
	/** Multi-instance unofficial WhatsApp (Baileys/WhatsApp Web) bridges, keyed by a user-chosen nickname */
	whatsappUnofficials: z.record(z.string(), WhatsAppUnofficialConfigSchema).optional(),

})

export type BridgesConfig = z.infer<typeof BridgesConfigSchema>

// ─── Main Config Schema ───────────────────────────────────────────────────────
export const FirecrawlConfigSchema = z.object({
	enabled: z.boolean().default(false),
	/** Base URL for Firecrawl local API (no trailing /v1/scrape) */
	baseUrl: z.string().url().default('http://localhost:3002'),
	/** HTTP timeout for scrape requests (milliseconds) */
	timeoutMs: z.number().int().positive().default(30000),
})

export type FirecrawlConfig = z.infer<typeof FirecrawlConfigSchema>

export const ComfyUIConfigSchema = z.object({
	enabled: z.boolean().default(false),
	/** Base URL for the ComfyUI API (e.g. http://localhost:8188) */
	baseUrl: z.string().url().default('http://localhost:8188'),
	/** Optional auth token for secured ComfyUI instances */
	authToken: z.string().optional(),
	/** Request timeout in milliseconds (image gen can be slow) */
	timeoutMs: z.number().int().positive().default(300_000),
	/** Default checkpoint model name (e.g. "dreamshaper_8.safetensors") */
	defaultCheckpoint: z.string().optional(),
	/** Default number of sampling steps */
	defaultSteps: z.number().int().positive().default(20),
	/** Default CFG scale */
	defaultCfg: z.number().positive().default(7.0),
})

export type ComfyUIConfig = z.infer<typeof ComfyUIConfigSchema>

export const NgrokConfigSchema = z.object({
	enabled: z.boolean().default(false),
})

export type NgrokConfig = z.infer<typeof NgrokConfigSchema>

// ─── Coding Provider Config ──────────────────────────────────────────────────

export const CodingProviderSchema = z.object({
	/** Unique name for this provider, e.g. "claude-code", "copilot-cli", "aider" */
	name: z.string().min(1),
	enabled: z.boolean().default(true),
	/** Lower priority = tried first. Providers are sorted ascending by this. */
	priority: z.number().int().default(0),
	/** Base CLI command, e.g. "claude", "gh copilot", "aider" */
	command: z.string().min(1),
	/** Model alias for complex tasks, e.g. "opus" for Claude Code */
	smartModel: z.string().optional(),
	/** Model alias for standard tasks, e.g. "sonnet" for Claude Code */
	normalModel: z.string().optional(),
	/** Flag(s) to auto-accept file edits, e.g. "--permission-mode bypassPermissions" */
	autoAcceptFlag: z.string().optional(),
	/** Flag(s) for structured output, e.g. "--output-format stream-json -p" */
	outputFlag: z.string().optional(),
	/** Any additional CLI flags appended to every invocation */
	additionalFlags: z.string().optional(),
	/** Maximum seconds before the CLI process is killed (default 300 = 5 min) */
	timeout: z.number().int().positive().default(300),
	/** How many times to retry this provider on transient failure (default 1) */
	maxRetries: z.number().int().min(0).default(1),
	/** Complexity score threshold: score > this → smart model, else normal (default 50) */
	complexityThreshold: z.number().int().min(0).default(50),
})

export type CodingProvider = z.infer<typeof CodingProviderSchema>

export const TamiasConfigSchema = z.object({
	version: z.literal('1.0'),
	connections: z.record(z.string(), ConnectionConfigSchema),
	defaultConnection: z.string().optional(),
	/** The priority list of models in "nickname/modelId" format, e.g. ["lc-openai/gpt-4o", "anthropic/claude-3-5-sonnet"] */
	defaultModels: z.array(z.string()).optional(),
	/** Image generation model priority */
	defaultImageModels: z.array(z.string()).optional(),
	/** Smart models for complex tasks (coding, prolonged thinking). Format: "nickname/modelId" */
	smartModels: z.array(z.string()).optional(),
	/** Embedding models for vector storage. Format: "nickname/modelId" */
	embeddingModels: z.array(z.string()).optional(),
	/** Model to use for session compaction (cheap model recommended). Format: "nickname/modelId" */
	compactionModel: z.string().optional(),
	internalTools: z.record(z.string(), InternalToolConfigSchema).optional(),
	mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
	bridges: BridgesConfigSchema.default({ terminal: { enabled: true } }),
	workspacePath: z.string().optional(),
	/** Default project slug. Messages not linked to any project are routed here. Use "inbox" for a catch-all. */
	defaultProject: z.string().optional(),
	debug: z.boolean().default(false),
	emails: z.record(z.string(), z.object({
		nickname: z.string(),
		enabled: z.boolean().default(false),
		service: z.enum(['gmail', 'outlook', 'icloud', 'other']).default('gmail'),
		email: z.string().optional(),
		envKeyName: z.string().optional(),

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
	/** Ratio of model context window to reserve for the system prompt (0.1 – 0.6, default 0.30) */
	systemPromptRatio: z.number().min(0.1).max(0.6).default(0.30).optional(),
	/** Ratio of model context window to reserve for chat messages (0.1 – 0.6, default 0.55) */
	messageTokenRatio: z.number().min(0.1).max(0.6).default(0.55).optional(),
	/** Tokens reserved for the model's response (default 8192) */
	responseTokenReserve: z.number().int().positive().default(8192).optional(),
	/** Vector store (semantic memory) configuration */
	vectorStore: z.object({
		/** Master switch to enable/disable the vector store */
		enabled: z.boolean().default(true),
		/** Maximum number of vectors to store (oldest evicted when full) */
		maxEntries: z.number().int().positive().default(5000),
		/** Whether compaction summaries and insights are auto-indexed into the vector store */
		autoIndexCompaction: z.boolean().default(true),
		/** Embedding model name (Xenova/transformers format) */
		embeddingModel: z.string().default('Xenova/all-MiniLM-L6-v2'),
	}).default({
		enabled: true,
		maxEntries: 5000,
		autoIndexCompaction: true,
		embeddingModel: 'Xenova/all-MiniLM-L6-v2',
	}).optional(),
	firecrawl: FirecrawlConfigSchema.optional(),
	comfyui: ComfyUIConfigSchema.optional(),
	ngrok: NgrokConfigSchema.default({ enabled: false }),
	/** Ordered list of external coding CLIs for task delegation (Claude Code, Copilot, Aider, etc.) */
	codingProviders: z.array(CodingProviderSchema).optional(),
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

// ─── In-memory config cache (invalidated on file change or manual save) ──────
let _configCache: { config: TamiasConfig; mtimeMs: number } | null = null

export function invalidateConfigCache(): void {
	_configCache = null
}

export const loadConfig = (): TamiasConfig => {
	const path = getConfigPath()
	if (!existsSync(path)) {
		return {
			version: '1.0',
			connections: {},
			bridges: { terminal: { enabled: true } },
			workspacePath: getDefaultWorkspacePath(),
			debug: false,
			ngrok: { enabled: false },
		}
	}

	// Return cached config if file hasn't changed
	try {
		const { mtimeMs } = statSync(path)
		if (_configCache && _configCache.mtimeMs === mtimeMs) {
			return _configCache.config
		}
	} catch { /* fall through to full load */ }

	try {
		const rawData = JSON.parse(readFileSync(path, 'utf-8'))
		const data = TamiasConfigSchema.parse(rawData)

		// Migrate old tool namespace keys to new names
		if (migrateToolNamespaces(data)) {
			try {
				const validated = TamiasConfigSchema.parse(data)
				writeFileSync(path, JSON.stringify(validated, null, 2), 'utf-8')
			} catch { /* migration write failed — continue with in-memory migrated config */ }
		}

		// Cache the loaded config
		try {
			const { mtimeMs } = statSync(path)
			_configCache = { config: data, mtimeMs }
		} catch { /* ignore */ }
		return data
	} catch (err) {
		if (err instanceof z.ZodError) {
			console.error('Configuration file is invalid:', JSON.stringify(err.issues, null, 2))
			process.exit(1)
		}
		console.error('Failed to load config file, using defaults:', err)
		return { version: '1.0', connections: {}, bridges: { terminal: { enabled: true } }, debug: false, ngrok: { enabled: false } }
	}
}

// ─── Tool Namespace Migration ──────────────────────────────────────────────

/**
 * Migrate old tool namespace keys in `internalTools` to their new names.
 * Returns true if any keys were migrated (caller should persist the config).
 */
export function migrateToolNamespaces(config: TamiasConfig): boolean {
	const tools = config.internalTools
	if (!tools) return false

	let changed = false

	// 1. Handle simple 1:1 renames
	for (const [oldName, newName] of Object.entries(TOOL_NAMESPACE_RENAMES)) {
		if (!(oldName in tools)) continue

		const oldCfg = tools[oldName]
		// Only migrate if the new key does NOT already have explicit config
		if (!(newName in tools)) {
			tools[newName] = oldCfg
		} else if (!oldCfg.enabled && tools[newName].enabled) {
			// If the old key was explicitly disabled, propagate that
			tools[newName] = { ...tools[newName], enabled: false }
		}
		delete tools[oldName]
		changed = true
	}

	// 2. Handle "tamias" → multiple successors
	if ('tamias' in tools) {
		const tamiasCfg = tools['tamias']
		if (!tamiasCfg.enabled) {
			// If tamias was disabled, disable all its successor namespaces
			for (const successor of TAMIAS_SUCCESSORS) {
				if (!(successor in tools)) {
					tools[successor] = { enabled: false }
				}
			}
		}
		delete tools['tamias']
		changed = true
	}

	return changed
}

export const saveConfig = (config: TamiasConfig): void => {
	_configCache = null
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

export const getSmartModels = (): string[] => {
	return loadConfig().smartModels || []
}

export const setSmartModels = (models: string[]): void => {
	const c = loadConfig()
	c.smartModels = models
	saveConfig(c)
}

export const getEmbeddingModels = (): string[] => {
	return loadConfig().embeddingModels || []
}

export const setEmbeddingModels = (models: string[]): void => {
	const c = loadConfig()
	c.embeddingModels = models
	saveConfig(c)
}

export type ModelTier = 'normal' | 'smart'

/** Get models for a given tier. 'normal' = defaultModels, 'smart' = smartModels (falls back to defaultModels). */
export const getModelsForTier = (tier: ModelTier): string[] => {
	const config = loadConfig()
	if (tier === 'smart') {
		const smart = config.smartModels
		if (smart && smart.length > 0) return smart
		// Fall back to default models if no smart models configured
		return config.defaultModels || []
	}
	return config.defaultModels || []
}

export const getCompactionModel = (): string | undefined => {
	return loadConfig().compactionModel
}

export const setCompactionModel = (model: string): void => {
	const c = loadConfig()
	c.compactionModel = model
	saveConfig(c)
}

/** Return the vector store configuration with defaults */
export const getVectorStoreConfig = () => {
	const config = loadConfig()
	return config.vectorStore ?? {
		enabled: true,
		maxEntries: 5000,
		autoIndexCompaction: true,
		embeddingModel: 'Xenova/all-MiniLM-L6-v2',
	}
}

/** Return Firecrawl local configuration with defaults */
export const getFirecrawlConfig = (): FirecrawlConfig => {
	const config = loadConfig()
	return config.firecrawl ?? {
		enabled: false,
		baseUrl: 'http://localhost:3002',
		timeoutMs: 30000,
	}
}

/** Return ComfyUI configuration with defaults */
export const getComfyUIConfig = (): ComfyUIConfig => {
	const config = loadConfig()
	return config.comfyui ?? {
		enabled: false,
		baseUrl: 'http://localhost:8188',
		timeoutMs: 300_000,
		defaultSteps: 20,
		defaultCfg: 7.0,
	}
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

/** Get coding providers sorted by priority (ascending — lower number = tried first) */
export const getCodingProviders = (): CodingProvider[] => {
	const config = loadConfig()
	const providers = config.codingProviders ?? []
	return providers.filter(p => p.enabled).sort((a, b) => a.priority - b.priority)
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
