import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs'
import { EventEmitter } from 'events'
import { TAMIAS_DIR } from '../utils/config'
import type { AgentDefinition } from '../utils/agentsStore'
import { slugify as slugifyAgent } from '../utils/agentsStore'
import type { CronJob } from '../utils/cronStore'
import { CronJobSchema } from '../utils/cronStore'
import { readProjectReadme, writeProjectReadme, updateProjectFrontmatter, generateReadmeBody } from '../utils/projectReadme'
import type { ProjectFrontmatter } from '../utils/projectReadme'

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
	// Execution engine fields
	cli_provider?: 'claude' | 'gemini' | 'codex' | 'aider' | 'copilot' | 'custom'
	cli_custom_command?: string
	plan_thinking?: 'smart' | 'basic' | 'none' | null
	execute_thinking?: 'smart' | 'basic' | null
	auto_commit?: boolean | null
	auto_push?: boolean | null
	branch_mode?: 'current' | 'new' | 'specific'
	branch_name?: string
	blocking?: boolean
}

export interface ProjectConfig {
	id: string
	name: string
	description?: string
	path: string
	discordServerId?: string
	discordChannelId?: string
	status?: 'active' | 'paused' | 'archived'
	techStack?: string
	website?: string
	objectives?: string[]
	createdAt?: string
	updatedAt?: string
	directory?: string
	kanbanCliProvider?: string
	kanbanPlanThinking?: string
	kanbanExecuteThinking?: string
	kanbanAutoCommit?: boolean
	kanbanAutoPush?: boolean
	kanbanCustomInstructions?: string
	kanban: KanbanTask[]
	/** Global connection nicknames this project is allowed to use */
	preferredConnections?: string[]
	/** Model override for this project. Format: "nickname/modelId" */
	preferredModel?: string
	/** Model fallback chain for this project */
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

/** Migrate a project from config.json to README.md frontmatter */
function migrateConfigJsonToReadme(projectDir: string, dirName: string): void {
	const configPath = join(projectDir, 'config.json')
	if (!existsSync(configPath)) return

	try {
		const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
		const frontmatter: ProjectFrontmatter = {
			name: raw.name || dirName,
			...(raw.description ? { description: raw.description } : {}),
			...(raw.status ? { status: raw.status } : {}),
			...(raw.discordServerId ? { discordServerId: raw.discordServerId } : {}),
			...(raw.discordChannelId ? { discordChannelId: raw.discordChannelId } : {}),
			...(raw.techStack ? { techStack: raw.techStack } : {}),
			...(raw.website ? { website: raw.website } : {}),
			...(raw.preferredConnections?.length ? { preferredConnections: raw.preferredConnections } : {}),
			...(raw.preferredModel ? { preferredModel: raw.preferredModel } : {}),
			...(raw.preferredModelFallbacks?.length ? { preferredModelFallbacks: raw.preferredModelFallbacks } : {}),
			...(raw.objectives?.length ? { objectives: raw.objectives } : {}),
			...(raw.createdAt ? { createdAt: raw.createdAt } : {}),
			...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
		}

		// Preserve existing README.md body if it exists
		const readmePath = join(projectDir, 'README.md')
		let body: string
		if (existsSync(readmePath)) {
			const existing = readProjectReadme(projectDir)
			body = existing?.body ?? generateReadmeBody(frontmatter.name, frontmatter.description)
		} else {
			// Try context.md as fallback body
			const contextPath = join(projectDir, 'context.md')
			body = existsSync(contextPath)
				? readFileSync(contextPath, 'utf-8')
				: generateReadmeBody(frontmatter.name, frontmatter.description)
		}

		writeProjectReadme(projectDir, frontmatter, body)
		renameSync(configPath, configPath + '.bak')
	} catch (e) {
		console.error(`Failed to migrate config.json in ${projectDir}:`, e)
	}
}

/** Migrate from old monolithic projects.json to per-project directories */
export function migrateFromProjectsJson(): boolean {
	if (!existsSync(OLD_PROJECTS_FILE)) return false

	try {
		const raw = readFileSync(OLD_PROJECTS_FILE, 'utf-8')
		const old: Record<string, Record<string, unknown>> = JSON.parse(raw)

		ensureProjectsDir()

		for (const [id, project] of Object.entries(old)) {
			const projectDir = join(PROJECTS_DIR, id)
			if (existsSync(projectDir)) continue // already migrated

			mkdirSync(projectDir, { recursive: true })

			// Separate kanban from config
			const { kanban, ...config } = project as Record<string, unknown>
			const frontmatter: ProjectFrontmatter = {
				name: (config.name as string) || id,
				...(config.description ? { description: config.description as string } : {}),
				...(config.discordServerId ? { discordServerId: config.discordServerId as string } : {}),
				...(config.discordChannelId ? { discordChannelId: config.discordChannelId as string } : {}),
				status: 'active',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}

			const body = generateReadmeBody(frontmatter.name, frontmatter.description)
			writeProjectReadme(projectDir, frontmatter, body)
			writeFileSync(join(projectDir, 'kanban.json'), JSON.stringify(kanban || [], null, 2), 'utf-8')

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

/**
 * Read project config from README.md frontmatter.
 * Falls back to config.json (with auto-migration) for backwards compatibility.
 * Returns a minimal config (using dir name) for bare directories.
 */
function readProjectConfigFromDir(projectDir: string, dirName: string): Omit<ProjectConfig, 'kanban'> {
	// 1. Try README.md frontmatter first
	const readme = readProjectReadme(projectDir)
	if (readme && readme.frontmatter.name) {
		return {
			id: dirName,
			name: readme.frontmatter.name,
			description: readme.frontmatter.description,
			path: dirName,
			discordServerId: readme.frontmatter.discordServerId,
			discordChannelId: readme.frontmatter.discordChannelId,
			status: readme.frontmatter.status,
			techStack: readme.frontmatter.techStack,
			website: readme.frontmatter.website,
			objectives: readme.frontmatter.objectives,
			createdAt: readme.frontmatter.createdAt,
			updatedAt: readme.frontmatter.updatedAt,
			preferredConnections: readme.frontmatter.preferredConnections,
			preferredModel: readme.frontmatter.preferredModel,
			preferredModelFallbacks: readme.frontmatter.preferredModelFallbacks,
			directory: readme.frontmatter.directory,
			kanbanCliProvider: readme.frontmatter.kanbanCliProvider,
			kanbanPlanThinking: readme.frontmatter.kanbanPlanThinking,
			kanbanExecuteThinking: readme.frontmatter.kanbanExecuteThinking,
			kanbanAutoCommit: readme.frontmatter.kanbanAutoCommit,
			kanbanAutoPush: readme.frontmatter.kanbanAutoPush,
			kanbanCustomInstructions: readme.frontmatter.kanbanCustomInstructions,
		}
	}

	// 2. Try config.json with auto-migration
	const configPath = join(projectDir, 'config.json')
	if (existsSync(configPath)) {
		migrateConfigJsonToReadme(projectDir, dirName)
		// Re-read after migration
		const migrated = readProjectReadme(projectDir)
		if (migrated && migrated.frontmatter.name) {
			return {
				id: dirName,
				name: migrated.frontmatter.name,
				description: migrated.frontmatter.description,
				path: dirName,
				discordServerId: migrated.frontmatter.discordServerId,
				discordChannelId: migrated.frontmatter.discordChannelId,
				status: migrated.frontmatter.status,
				techStack: migrated.frontmatter.techStack,
				website: migrated.frontmatter.website,
				objectives: migrated.frontmatter.objectives,
				createdAt: migrated.frontmatter.createdAt,
				updatedAt: migrated.frontmatter.updatedAt,
				preferredConnections: migrated.frontmatter.preferredConnections,
				preferredModel: migrated.frontmatter.preferredModel,
				preferredModelFallbacks: migrated.frontmatter.preferredModelFallbacks,
				directory: migrated.frontmatter.directory,
				kanbanCliProvider: migrated.frontmatter.kanbanCliProvider,
				kanbanPlanThinking: migrated.frontmatter.kanbanPlanThinking,
				kanbanExecuteThinking: migrated.frontmatter.kanbanExecuteThinking,
				kanbanAutoCommit: migrated.frontmatter.kanbanAutoCommit,
				kanbanAutoPush: migrated.frontmatter.kanbanAutoPush,
				kanbanCustomInstructions: migrated.frontmatter.kanbanCustomInstructions,
			}
		}
	}

	// 3. Bare directory = project with dir name as name
	return { id: dirName, name: dirName, path: dirName }
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
			// Skip hidden directories
			if (entry.name.startsWith('.')) continue
			const projectDir = join(PROJECTS_DIR, entry.name)
			const config = readProjectConfigFromDir(projectDir, entry.name)

			result[entry.name] = {
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
	if (!existsSync(projectDir)) return undefined

	const config = readProjectConfigFromDir(projectDir, id)
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
	const frontmatter: ProjectFrontmatter = {
		name: project.name,
		...(project.description ? { description: project.description } : {}),
		status: project.status || 'active',
		...(project.discordServerId ? { discordServerId: project.discordServerId } : {}),
		...(project.discordChannelId ? { discordChannelId: project.discordChannelId } : {}),
		...(project.techStack ? { techStack: project.techStack } : {}),
		...(project.website ? { website: project.website } : {}),
		...(project.preferredConnections?.length ? { preferredConnections: project.preferredConnections } : {}),
		...(project.preferredModel ? { preferredModel: project.preferredModel } : {}),
		...(project.preferredModelFallbacks?.length ? { preferredModelFallbacks: project.preferredModelFallbacks } : {}),
		...(project.objectives?.length ? { objectives: project.objectives } : {}),
		createdAt: now,
		updatedAt: now,
		...(project.directory ? { directory: project.directory } : {}),
		...(project.kanbanCliProvider ? { kanbanCliProvider: project.kanbanCliProvider } : {}),
		...(project.kanbanPlanThinking ? { kanbanPlanThinking: project.kanbanPlanThinking } : {}),
		...(project.kanbanExecuteThinking ? { kanbanExecuteThinking: project.kanbanExecuteThinking } : {}),
		...(project.kanbanAutoCommit != null ? { kanbanAutoCommit: project.kanbanAutoCommit } : {}),
		...(project.kanbanAutoPush != null ? { kanbanAutoPush: project.kanbanAutoPush } : {}),
		...(project.kanbanCustomInstructions ? { kanbanCustomInstructions: project.kanbanCustomInstructions } : {}),
	}

	const body = generateReadmeBody(project.name, project.description)
	writeProjectReadme(projectDir, frontmatter, body)
	writeKanban(projectDir, [])

	// Initialize agents and crons as empty arrays
	writeFileSync(join(projectDir, 'agents.json'), '[]', 'utf-8')
	writeFileSync(join(projectDir, 'cron.json'), '[]', 'utf-8')

	// Initialize NOTES.md and ACTIVITY.md
	writeFileSync(join(projectDir, 'NOTES.md'), `# ${project.name} — Notes\n\n`, 'utf-8')
	const nowLabel = now.slice(0, 16).replace('T', ' ')
	writeFileSync(join(projectDir, 'ACTIVITY.md'), `# ${project.name} — Activity Log\n\n[${nowLabel}] Project created.\n`, 'utf-8')

	// Create skills directory
	mkdirSync(join(projectDir, 'skills'), { recursive: true })

	const newProject: ProjectConfig = {
		id: finalId,
		name: project.name,
		description: project.description,
		path: finalId,
		discordServerId: project.discordServerId,
		discordChannelId: project.discordChannelId,
		status: project.status || 'active',
		techStack: project.techStack,
		website: project.website,
		objectives: project.objectives,
		createdAt: now,
		updatedAt: now,
		preferredConnections: project.preferredConnections,
		preferredModel: project.preferredModel,
		preferredModelFallbacks: project.preferredModelFallbacks,
		...(project.directory ? { directory: project.directory } : {}),
		kanban: [],
	}
	return newProject
}

export function updateProject(id: string, updates: Partial<Omit<ProjectConfig, 'id'>>, opts?: { source?: string }): ProjectConfig {
	const projectDir = join(PROJECTS_DIR, id)
	if (!existsSync(projectDir)) {
		throw new Error(`Project ${id} not found`)
	}

	const currentConfig = readProjectConfigFromDir(projectDir, id)
	const oldKanban = readKanban(projectDir)

	// Separate kanban updates from config updates
	const { kanban: newKanban, ...configUpdates } = updates

	if (Object.keys(configUpdates).length > 0) {
		const fmUpdates: Partial<ProjectFrontmatter> = {
			...(configUpdates.name !== undefined ? { name: configUpdates.name } : {}),
			...(configUpdates.description !== undefined ? { description: configUpdates.description } : {}),
			...(configUpdates.status !== undefined ? { status: configUpdates.status } : {}),
			...(configUpdates.discordServerId !== undefined ? { discordServerId: configUpdates.discordServerId } : {}),
			...(configUpdates.discordChannelId !== undefined ? { discordChannelId: configUpdates.discordChannelId } : {}),
			...(configUpdates.techStack !== undefined ? { techStack: configUpdates.techStack } : {}),
			...(configUpdates.website !== undefined ? { website: configUpdates.website } : {}),
			...(configUpdates.objectives !== undefined ? { objectives: configUpdates.objectives } : {}),
			...(configUpdates.preferredConnections !== undefined ? { preferredConnections: configUpdates.preferredConnections } : {}),
			...(configUpdates.preferredModel !== undefined ? { preferredModel: configUpdates.preferredModel } : {}),
			...(configUpdates.preferredModelFallbacks !== undefined ? { preferredModelFallbacks: configUpdates.preferredModelFallbacks } : {}),
			...(configUpdates.directory !== undefined ? { directory: configUpdates.directory } : {}),
			...(configUpdates.kanbanCliProvider !== undefined ? { kanbanCliProvider: configUpdates.kanbanCliProvider } : {}),
			...(configUpdates.kanbanPlanThinking !== undefined ? { kanbanPlanThinking: configUpdates.kanbanPlanThinking } : {}),
			...(configUpdates.kanbanExecuteThinking !== undefined ? { kanbanExecuteThinking: configUpdates.kanbanExecuteThinking } : {}),
			...(configUpdates.kanbanAutoCommit !== undefined ? { kanbanAutoCommit: configUpdates.kanbanAutoCommit } : {}),
			...(configUpdates.kanbanAutoPush !== undefined ? { kanbanAutoPush: configUpdates.kanbanAutoPush } : {}),
			...(configUpdates.kanbanCustomInstructions !== undefined ? { kanbanCustomInstructions: configUpdates.kanbanCustomInstructions } : {}),
			updatedAt: new Date().toISOString(),
		}
		updateProjectFrontmatter(projectDir, fmUpdates)
	}

	if (newKanban !== undefined) {
		writeKanban(projectDir, newKanban)
		projectEvents.emit('kanban_changed', {
			project: { ...currentConfig, kanban: newKanban },
			oldKanban,
			newKanban,
			source: opts?.source,
		})
	}

	// Re-read to return consistent state
	const finalConfig = readProjectConfigFromDir(projectDir, id)
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
		return (raw as Record<string, unknown>[]).map(entry => CronJobSchema.parse(entry))
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
