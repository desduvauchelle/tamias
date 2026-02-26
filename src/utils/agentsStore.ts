import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AgentDefinition {
	id: string
	/** Short kebab-case identifier used for routing and addressing, e.g. "researcher" */
	slug: string
	name: string
	model?: string
	/** Model degradation chain: if the primary model fails, try these in order */
	modelFallbacks?: string[]
	instructions: string
	enabled: boolean
	/** Discord/Telegram channel IDs this agent is bound to — messages in these channels route directly to this agent */
	channels?: string[]
	/** Extra skill folder names loaded on top of global skills, e.g. ["lookup-larry"] */
	extraSkills?: string[]
	/** Agent-scoped internal tools: only these tools are available to this agent. If empty, all tools are available. */
	allowedTools?: string[]
	/** Agent-scoped MCP servers: only these MCP servers are available to this agent. If empty, all are available. */
	allowedMcpServers?: string[]
}

const AGENTS_DIR = join(homedir(), '.tamias')
const AGENTS_FILE = join(AGENTS_DIR, 'agents.json')

/** Root directory for all named agent persona folders */
export const AGENTS_PERSONAS_DIR = join(homedir(), '.tamias', 'agents')

/** Returns the persona folder path for a given agent slug */
export function getAgentDir(slug: string): string {
	return join(AGENTS_PERSONAS_DIR, slug)
}

/** Scaffolds an agent's persona folder with starter files if they don't exist */
export function scaffoldAgentDir(slug: string): void {
	const dir = getAgentDir(slug)
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

	// Copy starter templates if present
	const templatesDir = join(import.meta.dir, '../templates/agent')
	if (existsSync(templatesDir)) {
		for (const file of ['SOUL.md', 'IDENTITY.md']) {
			const dest = join(dir, file)
			if (!existsSync(dest)) {
				const src = join(templatesDir, file)
				if (existsSync(src)) {
					let content = readFileSync(src, 'utf-8')
					// Strip YAML frontmatter
					if (content.startsWith('---')) {
						const end = content.indexOf('---', 3)
						if (end !== -1) content = content.slice(end + 3).trimStart()
					}
					// Replace placeholder slug
					content = content.replace(/\{\{slug\}\}/g, slug).replace(/\{\{name\}\}/g, slug)
					writeFileSync(dest, content, 'utf-8')
				}
			}
		}
	}
}

function ensureDir() {
	if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true })
}

/** Derive a URL-safe slug from a name, e.g. "My Researcher" → "my-researcher" */
export function slugify(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function loadAgents(): AgentDefinition[] {
	if (!existsSync(AGENTS_FILE)) return []
	try {
		const raw = JSON.parse(readFileSync(AGENTS_FILE, 'utf-8'))
		// Back-compat: older agents may not have a slug — derive one
		return raw.map((a: AgentDefinition) => ({
			...a,
			slug: a.slug || slugify(a.name),
		}))
	} catch (err) {
		console.error('Failed to load agents:', err)
		return []
	}
}

export function saveAgents(agents: AgentDefinition[]): void {
	ensureDir()
	writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8')
}

export function addAgent(agent: Omit<AgentDefinition, 'id' | 'enabled'>): AgentDefinition {
	const agents = loadAgents()
	const slug = agent.slug || slugify(agent.name)
	const newAgent: AgentDefinition = {
		...agent,
		slug,
		id: `agent_${Math.random().toString(36).slice(2, 6)}`,
		enabled: true,
	}
	agents.push(newAgent)
	saveAgents(agents)
	scaffoldAgentDir(slug)
	return newAgent
}

export function removeAgent(id: string): void {
	const agents = loadAgents()
	const filtered = agents.filter(a => a.id !== id)
	if (agents.length === filtered.length) throw new Error(`Agent with ID ${id} not found`)
	saveAgents(filtered)
}

export function updateAgent(id: string, updates: Partial<Omit<AgentDefinition, 'id'>>): AgentDefinition {
	const agents = loadAgents()
	const index = agents.findIndex(a => a.id === id)
	if (index === -1) throw new Error(`Agent with ID ${id} not found`)

	agents[index] = { ...agents[index], ...updates }
	saveAgents(agents)
	return agents[index]
}

/** Find an agent by id, slug, or name (case-insensitive) */
export function findAgent(query: string): AgentDefinition | undefined {
	const agents = loadAgents()
	const q = query.toLowerCase()
	return agents.find(
		a => a.id === query || a.slug === q || a.name.toLowerCase() === q
	)
}

/**
 * Build the model degradation chain for a named agent.
 * Returns [agentModel, ...agentFallbacks] with the agent's explicit
 * preferences first, then falls back to the global default models.
 */
export function resolveAgentModelChain(agent: AgentDefinition): string[] {
	const chain: string[] = []
	if (agent.model) chain.push(agent.model)
	if (agent.modelFallbacks?.length) chain.push(...agent.modelFallbacks)
	return chain
}
