import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs'
import { EventEmitter } from 'events'
import { TAMIAS_DIR } from '../utils/config'
import type { AgentDefinition } from '../utils/agentsStore'
import { slugify as slugifyAgent } from '../utils/agentsStore'
import type { CronJob } from '../utils/cronStore'
import { CronJobSchema } from '../utils/cronStore'

export const projectEvents = new EventEmitter()

export interface KanbanComment {
	id: string
	author: string
	text: string
	createdAt: number
	reaction?: string
}

export interface KanbanTask {
	id: string
	title: string
	description?: string
	details?: string
	assignee?: string
	reaction?: string
	status: 'todo' | 'in-progress' | 'awaiting-review' | 'done' | string
	createdAt: number
	priority?: 'low' | 'medium' | 'high' | 'urgent'
	dueDate?: number
	labels?: string[]
	order?: number
	comments?: KanbanComment[]
}

export interface ProjectConfig {
	id: string
	name: string
	description?: string
	path: string
	discordServerId?: string
	discordChannelId?: string
	contextFile?: string
	status?: 'active' | 'paused' | 'archived'
	techStack?: string
	createdAt?: string
	updatedAt?: string
	kanban: KanbanTask[]
	/** Global connection nicknames this project is allowed to use */
	preferredConnections?: string[]
	/** Model override for this project. Format: "nickname/modelId" */
	preferredModel?: string
	/** Model fallback chain for this project */
	preferredModelFallbacks?: string[]
}

/** Stored in config.json (no kanban — that's in kanban.json) */
interface ProjectConfigFile {
	id: string
	name: string
	description?: string
	path: string
	discordServerId?: string
	discordChannelId?: string
	contextFile?: string
	status?: 'active' | 'paused' | 'archived'
	techStack?: string
	createdAt?: string
	updatedAt?: string
	preferredConnections?: string[]
	preferredModel?: string
	preferredModelFallbacks?: string[]
}

const PROJECTS_DIR = join(TAMIAS_DIR, 'workspace')
const OLD_PROJECTS_FILE = join(TAMIAS_DIR, 'projects.json')

function ensureProjectsDir(): void {
	if (!existsSync(PROJECTS_DIR)) {
		mkdirSync(PROJECTS_DIR, { recursive: true })
	}
}

/** Slugify a project name for directory naming */
export function slugifyProject(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Get the directory for a specific project */
export function getProjectDirectory(id: string): string {
	return join(PROJECTS_DIR, id)
}

// ─── Migration ─────────────────────────────────────────────────────────────────

/** Migrate from old monolithic projects.json to per-project directories */
export function migrateFromProjectsJson(): boolean {
	if (!existsSync(OLD_PROJECTS_FILE)) return false

	try {
		const raw = readFileSync(OLD_PROJECTS_FILE, 'utf-8')
		const old: Record<string, any> = JSON.parse(raw)

		ensureProjectsDir()

		for (const [id, project] of Object.entries(old)) {
			const projectDir = join(PROJECTS_DIR, id)
			if (existsSync(projectDir)) continue // already migrated

			mkdirSync(projectDir, { recursive: true })

			// Separate kanban from config
			const { kanban, ...config } = project
			const configData: ProjectConfigFile = {
				id,
				name: config.name || id,
				description: config.description,
				path: config.path || '',
				discordServerId: config.discordServerId,
				discordChannelId: config.discordChannelId,
				contextFile: config.contextFile,
				status: 'active',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			writeFileSync(join(projectDir, 'config.json'), JSON.stringify(configData, null, 2), 'utf-8')
			writeFileSync(join(projectDir, 'kanban.json'), JSON.stringify(kanban || [], null, 2), 'utf-8')

			// Create default context.md
			if (!existsSync(join(projectDir, 'context.md'))) {
				writeFileSync(join(projectDir, 'context.md'), `# ${configData.name}\n\n${configData.description || ''}\n`, 'utf-8')
			}

			// Create skills directory
			const skillsDir = join(projectDir, 'skills')
			if (!existsSync(skillsDir)) {
				mkdirSync(skillsDir, { recursive: true })
			}
		}

		// Rename old file as backup
		renameSync(OLD_PROJECTS_FILE, OLD_PROJECTS_FILE + '.bak')
		return true
	} catch (e) {
		console.error('Failed to migrate projects.json:', e)
		return false
	}
}

// ─── Read Helpers ──────────────────────────────────────────────────────────────

function readProjectConfig(projectDir: string): ProjectConfigFile | null {
	const configPath = join(projectDir, 'config.json')
	if (!existsSync(configPath)) return null
	try {
		return JSON.parse(readFileSync(configPath, 'utf-8'))
	} catch {
		return null
	}
}

function readKanban(projectDir: string): KanbanTask[] {
	const kanbanPath = join(projectDir, 'kanban.json')
	if (!existsSync(kanbanPath)) return []
	try {
		return JSON.parse(readFileSync(kanbanPath, 'utf-8'))
	} catch {
		return []
	}
}

function writeProjectConfig(projectDir: string, config: ProjectConfigFile): void {
	writeFileSync(join(projectDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
}

function writeKanban(projectDir: string, kanban: KanbanTask[]): void {
	writeFileSync(join(projectDir, 'kanban.json'), JSON.stringify(kanban, null, 2), 'utf-8')
}

// ─── Public API (backward-compatible signatures) ───────────────────────────────

export function getProjects(): Record<string, ProjectConfig> {
	// Auto-migrate on first access
	migrateFromProjectsJson()
	ensureProjectsDir()

	const result: Record<string, ProjectConfig> = {}

	try {
		const entries = readdirSync(PROJECTS_DIR, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			const projectDir = join(PROJECTS_DIR, entry.name)
			const config = readProjectConfig(projectDir)
			if (!config) continue

			result[config.id] = {
				...config,
				kanban: readKanban(projectDir),
			}
		}
	} catch (e) {
		console.error('Failed to read projects directory:', e)
	}

	return result
}

export function getProject(id: string): ProjectConfig | undefined {
	// Auto-migrate on first access
	migrateFromProjectsJson()

	const projectDir = join(PROJECTS_DIR, id)
	const config = readProjectConfig(projectDir)
	if (!config) return undefined

	return {
		...config,
		kanban: readKanban(projectDir),
	}
}

export function addProject(project: Omit<ProjectConfig, 'id' | 'kanban'>): ProjectConfig {
	ensureProjectsDir()

	const id = slugifyProject(project.name)
	let finalId = id
	// Ensure unique directory name
	if (existsSync(join(PROJECTS_DIR, finalId))) {
		finalId = `${id}-${Math.random().toString(36).substring(2, 6)}`
	}

	const projectDir = join(PROJECTS_DIR, finalId)
	mkdirSync(projectDir, { recursive: true })

	const now = new Date().toISOString()
	const configData: ProjectConfigFile = {
		id: finalId,
		name: project.name,
		description: project.description,
		path: project.path || finalId,
		discordServerId: project.discordServerId,
		discordChannelId: project.discordChannelId,
		contextFile: project.contextFile,
		status: project.status || 'active',
		techStack: project.techStack,
		createdAt: now,
		updatedAt: now,
	}

	writeProjectConfig(projectDir, configData)
	writeKanban(projectDir, [])

	// Initialize agents and crons as empty arrays
	writeFileSync(join(projectDir, 'agents.json'), '[]', 'utf-8')
	writeFileSync(join(projectDir, 'cron.json'), '[]', 'utf-8')

	// Create default context.md
	writeFileSync(join(projectDir, 'context.md'), `# ${project.name}\n\n${project.description || ''}\n`, 'utf-8')

	// Initialize README.md with a structured template the AI can follow
	const readmePath = join(projectDir, 'README.md')
	if (!existsSync(readmePath)) {
		const readmeContent = `# ${project.name}

${project.description || 'A Tamias project.'}

## Overview

<!-- Describe the purpose and goals of this project -->

## Tasks & Reminders

<!-- Tasks, action items, and reminders go here -->

## Notes

<!-- Freeform notes, links, and reference material -->

## Activity

<!-- Recent updates are logged here automatically -->
`
		writeFileSync(readmePath, readmeContent, 'utf-8')
	}

	// Initialize NOTES.md and ACTIVITY.md
	writeFileSync(join(projectDir, 'NOTES.md'), `# ${project.name} — Notes\n\n`, 'utf-8')
	const nowLabel = now.slice(0, 16).replace('T', ' ')
	writeFileSync(join(projectDir, 'ACTIVITY.md'), `# ${project.name} — Activity Log\n\n[${nowLabel}] Project created.\n`, 'utf-8')

	// Create skills directory
	mkdirSync(join(projectDir, 'skills'), { recursive: true })

	const newProject: ProjectConfig = { ...configData, kanban: [] }
	return newProject
}

export function updateProject(id: string, updates: Partial<Omit<ProjectConfig, 'id'>>, opts?: { source?: string }): ProjectConfig {
	const projectDir = join(PROJECTS_DIR, id)
	const config = readProjectConfig(projectDir)
	if (!config) {
		throw new Error(`Project ${id} not found`)
	}

	const oldKanban = readKanban(projectDir)

	// Separate kanban updates from config updates
	const { kanban: newKanban, ...configUpdates } = updates

	if (Object.keys(configUpdates).length > 0) {
		const updatedConfig: ProjectConfigFile = {
			...config,
			...configUpdates,
			path: id,
			updatedAt: new Date().toISOString(),
		}
		writeProjectConfig(projectDir, updatedConfig)
	}

	if (newKanban !== undefined) {
		writeKanban(projectDir, newKanban)
		projectEvents.emit('kanban_changed', {
			project: { ...config, kanban: newKanban },
			oldKanban,
			newKanban,
			source: opts?.source,
		})
	}

	// Re-read to return consistent state
	const finalConfig = readProjectConfig(projectDir)!
	return {
		...finalConfig,
		kanban: newKanban !== undefined ? newKanban : oldKanban,
	}
}

export function deleteProject(id: string): void {
	const projectDir = join(PROJECTS_DIR, id)
	if (existsSync(projectDir)) {
		rmSync(projectDir, { recursive: true, force: true })
	}
}

export function getProjectByDiscordChannel(channelId: string): ProjectConfig | undefined {
	const projects = getProjects()
	return Object.values(projects).find(p => p.discordChannelId === channelId)
}

// ─── Per-Project Skills ────────────────────────────────────────────────────────

/** Get the skills directory for a project */
export function getProjectSkillsDir(id: string): string {
	return join(PROJECTS_DIR, id, 'skills')
}

/** List skill files in a project's skills directory */
export function getProjectSkills(id: string): string[] {
	const skillsDir = getProjectSkillsDir(id)
	if (!existsSync(skillsDir)) return []
	try {
		return readdirSync(skillsDir, { withFileTypes: true })
			.filter(e => e.isDirectory())
			.map(e => e.name)
	} catch {
		return []
	}
}

// ─── Per-Project Agents ─────────────────────────────────────────────────────

function getProjectAgentsFile(id: string): string {
	return join(PROJECTS_DIR, id, 'agents.json')
}

/** Read all agents scoped to a project */
export function getProjectAgents(id: string): AgentDefinition[] {
	const file = getProjectAgentsFile(id)
	if (!existsSync(file)) return []
	try {
		const raw = JSON.parse(readFileSync(file, 'utf-8'))
		return (raw as AgentDefinition[]).map(a => ({
			...a,
			slug: a.slug || slugifyAgent(a.name),
		}))
	} catch {
		return []
	}
}

function saveProjectAgents(id: string, agents: AgentDefinition[]): void {
	const file = getProjectAgentsFile(id)
	writeFileSync(file, JSON.stringify(agents, null, 2), 'utf-8')
}

/** Add an agent to a project */
export function addProjectAgent(id: string, agent: Omit<AgentDefinition, 'id' | 'enabled'>): AgentDefinition {
	const projectDir = join(PROJECTS_DIR, id)
	if (!existsSync(projectDir)) throw new Error(`Project ${id} not found`)

	const agents = getProjectAgents(id)
	const slug = agent.slug || slugifyAgent(agent.name)
	const newAgent: AgentDefinition = {
		...agent,
		slug,
		id: `agent_${Math.random().toString(36).slice(2, 6)}`,
		enabled: true,
	}
	agents.push(newAgent)
	saveProjectAgents(id, agents)
	return newAgent
}

/** Update an agent in a project by slug */
export function updateProjectAgent(id: string, agentSlug: string, updates: Partial<Omit<AgentDefinition, 'id'>>): AgentDefinition {
	const agents = getProjectAgents(id)
	const index = agents.findIndex(a => a.slug === agentSlug)
	if (index === -1) throw new Error(`Agent "${agentSlug}" not found in project ${id}`)
	agents[index] = { ...agents[index], ...updates }
	saveProjectAgents(id, agents)
	return agents[index]
}

/** Remove an agent from a project by slug */
export function removeProjectAgent(id: string, agentSlug: string): void {
	const agents = getProjectAgents(id)
	const filtered = agents.filter(a => a.slug !== agentSlug)
	if (agents.length === filtered.length) throw new Error(`Agent "${agentSlug}" not found in project ${id}`)
	saveProjectAgents(id, filtered)
}

// ─── Per-Project Crons ──────────────────────────────────────────────────────

function getProjectCronsFile(id: string): string {
	return join(PROJECTS_DIR, id, 'cron.json')
}

/** Read all cron jobs scoped to a project */
export function getProjectCrons(id: string): CronJob[] {
	const file = getProjectCronsFile(id)
	if (!existsSync(file)) return []
	try {
		const raw = JSON.parse(readFileSync(file, 'utf-8'))
		return (raw as any[]).map(entry => CronJobSchema.parse(entry))
	} catch {
		return []
	}
}

function saveProjectCrons(id: string, crons: CronJob[]): void {
	const file = getProjectCronsFile(id)
	writeFileSync(file, JSON.stringify(crons, null, 2), 'utf-8')
}

/** Add a cron job to a project */
export function addProjectCron(id: string, job: Omit<CronJob, 'id' | 'createdAt' | 'enabled'>): CronJob {
	const projectDir = join(PROJECTS_DIR, id)
	if (!existsSync(projectDir)) throw new Error(`Project ${id} not found`)

	const crons = getProjectCrons(id)
	const newJob = CronJobSchema.parse({
		...job,
		id: `cron_${Math.random().toString(36).slice(2, 6)}`,
		createdAt: new Date().toISOString(),
		enabled: true,
	})
	crons.push(newJob)
	saveProjectCrons(id, crons)
	return newJob
}

/** Update a cron job in a project by jobId */
export function updateProjectCron(id: string, jobId: string, updates: Partial<Omit<CronJob, 'id'>>): CronJob {
	const crons = getProjectCrons(id)
	const index = crons.findIndex(c => c.id === jobId)
	if (index === -1) throw new Error(`Cron "${jobId}" not found in project ${id}`)
	const updated = CronJobSchema.parse({ ...crons[index], ...updates })
	crons[index] = updated
	saveProjectCrons(id, crons)
	return updated
}

/** Remove a cron job from a project by jobId */
export function removeProjectCron(id: string, jobId: string): void {
	const crons = getProjectCrons(id)
	const filtered = crons.filter(c => c.id !== jobId)
	if (crons.length === filtered.length) throw new Error(`Cron "${jobId}" not found in project ${id}`)
	saveProjectCrons(id, filtered)
}
