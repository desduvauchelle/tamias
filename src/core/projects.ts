import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { TAMIAS_DIR } from '../utils/config'

export interface KanbanComment {
	id: string
	author: string
	text: string
	createdAt: number
}

export interface KanbanTask {
	id: string
	title: string
	description?: string
	details?: string
	assignee?: string
	status: 'todo' | 'in-progress' | 'done' | string
	createdAt: number
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
	kanban: KanbanTask[]
}

const PROJECTS_FILE = join(TAMIAS_DIR, 'projects.json')

export function getProjects(): Record<string, ProjectConfig> {
	if (!existsSync(PROJECTS_FILE)) {
		return {}
	}
	try {
		return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'))
	} catch (e) {
		console.error('Failed to parse projects.json', e)
		return {}
	}
}

export function saveProjects(projects: Record<string, ProjectConfig>) {
	writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8')
}

export function getProject(id: string): ProjectConfig | undefined {
	return getProjects()[id]
}

export function addProject(project: Omit<ProjectConfig, 'id' | 'kanban'>): ProjectConfig {
	const projects = getProjects()
	const id = Math.random().toString(36).substring(2, 9)
	const newProject: ProjectConfig = {
		id,
		...project,
		kanban: []
	}
	projects[id] = newProject
	saveProjects(projects)
	return newProject
}

export function updateProject(id: string, updates: Partial<Omit<ProjectConfig, 'id'>>): ProjectConfig {
	const projects = getProjects()
	if (!projects[id]) {
		throw new Error(`Project ${id} not found`)
	}
	projects[id] = { ...projects[id], ...updates }
	saveProjects(projects)
	return projects[id]
}

export function deleteProject(id: string) {
	const projects = getProjects()
	delete projects[id]
	saveProjects(projects)
}

export function getProjectByDiscordChannel(channelId: string): ProjectConfig | undefined {
	const projects = getProjects()
	return Object.values(projects).find(p => p.discordChannelId === channelId)
}
