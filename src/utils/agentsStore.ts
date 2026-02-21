import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AgentDefinition {
	id: string
	name: string
	model?: string
	instructions: string
	enabled: boolean
}

const AGENTS_DIR = join(homedir(), '.tamias')
const AGENTS_FILE = join(AGENTS_DIR, 'agents.json')

function ensureDir() {
	if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true })
}

export function loadAgents(): AgentDefinition[] {
	if (!existsSync(AGENTS_FILE)) return []
	try {
		return JSON.parse(readFileSync(AGENTS_FILE, 'utf-8'))
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
	const newAgent: AgentDefinition = {
		...agent,
		id: `agent_${Math.random().toString(36).slice(2, 6)}`,
		enabled: true
	}
	agents.push(newAgent)
	saveAgents(agents)
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
