/**
 * Project memory system for Tamias.
 *
 * Each project lives at ~/.tamias/workspace/<slug>/ with these files:
 *   - README.md    — YAML frontmatter (metadata) + markdown body (context)
 *   - ACTIVITY.md  — rolling append log (most recent first)
 *   - NOTES.md     — freeform notes
 *   - kanban.json   — structured task board
 *   - agents.json   — project-scoped AI agents
 *   - cron.json     — project-scoped cron jobs
 *   - skills/       — project-scoped skills
 */
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { TAMIAS_DIR } from './config.ts'
import { readProjectReadme as readReadmeFrontmatter, writeProjectReadme as writeReadmeFrontmatter, generateReadmeBody } from './projectReadme.ts'
import type { ProjectFrontmatter } from './projectReadme.ts'

/** Max depth for file tree listing */
const FILE_TREE_MAX_DEPTH = 3
/** Max lines for injected README body */
const README_MAX_LINES = 200
/** Max lines for injected instruction file */
const INSTRUCTION_MAX_LINES = 300
/** Directories to skip when listing file trees */
const FILE_TREE_IGNORE = new Set([
	'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
	'__pycache__', '.venv', 'venv', '.tox', 'target', 'vendor',
	'.turbo', '.cache', 'coverage', '.output', '.svelte-kit',
])

/**
 * Candidate filenames for project-specific AI instructions,
 * checked in order of priority.
 */
export const PROJECT_INSTRUCTION_FILES = [
	'.tamias-instructions.md',
	'tamias.md',
	'.github/copilot-instructions.md',
	'copilot-instructions.md',
	'AI.md',
	'AGENTS.md',
]

export interface Project {
	slug: string
	name: string
	status: 'active' | 'paused' | 'archived'
	description: string
	techStack?: string
	workspacePath?: string
	createdAt: string
	updatedAt: string
}

function getProjectsDir(tenantId?: string): string {
	if (tenantId && tenantId !== 'default') {
		return join(TAMIAS_DIR, 'tenants', tenantId, 'workspace')
	}
	return join(TAMIAS_DIR, 'workspace')
}

function ensureProjectsDir(tenantId?: string): string {
	const dir = getProjectsDir(tenantId)
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
	return dir
}

/** Slugify a project name */
export function slugifyProject(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Get the directory for a specific project */
export function getProjectDir(slug: string, tenantId?: string): string {
	return join(getProjectsDir(tenantId), slug)
}

/** List all projects — every directory in the workspace IS a project */
export function listProjects(tenantId?: string): Project[] {
	const dir = getProjectsDir(tenantId)
	if (!existsSync(dir)) return []

	const projects: Project[] = []
	const entries = readdirSync(dir, { withFileTypes: true })

	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		if (entry.name.startsWith('.')) continue
		const projectPath = join(dir, entry.name)
		const project = parseProjectFromDir(entry.name, projectPath)
		if (project) projects.push(project)
	}

	return projects.sort((a, b) => {
		// Active first, then by updatedAt
		if (a.status !== b.status) {
			const order = { active: 0, paused: 1, archived: 2 }
			return (order[a.status] ?? 3) - (order[b.status] ?? 3)
		}
		return b.updatedAt.localeCompare(a.updatedAt)
	})
}

/** Get a single project */
export function getProject(slug: string, tenantId?: string): Project | null {
	const projectPath = getProjectDir(slug, tenantId)
	if (!existsSync(projectPath)) return null
	return parseProjectFromDir(slug, projectPath)
}

/** Create a new project */
export function createProject(
	name: string,
	description: string,
	opts?: { techStack?: string; workspacePath?: string; tenantId?: string }
): Project {
	const slug = slugifyProject(name)
	const projectDir = getProjectDir(slug, opts?.tenantId)

	if (existsSync(projectDir)) {
		throw new Error(`Project "${slug}" already exists`)
	}

	mkdirSync(projectDir, { recursive: true })

	const now = new Date().toISOString()
	const project: Project = {
		slug,
		name,
		status: 'active',
		description,
		techStack: opts?.techStack,
		workspacePath: opts?.workspacePath,
		createdAt: now,
		updatedAt: now,
	}

	// Write README.md with frontmatter
	const frontmatter: ProjectFrontmatter = {
		name,
		description,
		status: 'active',
		...(opts?.techStack ? { techStack: opts.techStack } : {}),
		createdAt: now,
		updatedAt: now,
	}
	const body = generateReadmeBody(name, description)
	writeReadmeFrontmatter(projectDir, frontmatter, body)
	writeFileSync(join(projectDir, 'kanban.json'), '[]', 'utf-8')

	// Create ACTIVITY.md
	writeFileSync(
		join(projectDir, 'ACTIVITY.md'),
		`# ${name} — Activity Log\n\n[${now.slice(0, 16).replace('T', ' ')}] Project created.\n`,
		'utf-8'
	)

	// Create NOTES.md
	writeFileSync(
		join(projectDir, 'NOTES.md'),
		`# ${name} — Notes\n\n`,
		'utf-8'
	)

	// Create skills directory
	mkdirSync(join(projectDir, 'skills'), { recursive: true })

	// Create WORKSPACE.md if workspacePath provided
	if (opts?.workspacePath) {
		writeFileSync(
			join(projectDir, 'WORKSPACE.md'),
			`# Workspace\n\nLinked workspace: \`${opts.workspacePath}\`\n`,
			'utf-8'
		)
	}

	return project
}

/** Update a project's status */
export function updateProjectStatus(slug: string, status: Project['status'], tenantId?: string): Project | null {
	const project = getProject(slug, tenantId)
	if (!project) return null

	project.status = status
	project.updatedAt = new Date().toISOString()

	// Update frontmatter
	const projectDir = getProjectDir(slug, tenantId)
	const { updateProjectFrontmatter } = require('./projectReadme.ts')
	updateProjectFrontmatter(projectDir, { status, updatedAt: project.updatedAt })

	logProjectActivity(slug, `Status changed to ${status}`, tenantId)

	return project
}

/** Append an activity log entry */
export function logProjectActivity(slug: string, activity: string, tenantId?: string): void {
	const dir = getProjectDir(slug, tenantId)
	const activityPath = join(dir, 'ACTIVITY.md')

	const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
	const entry = `[${now}] ${activity}\n`

	if (existsSync(activityPath)) {
		// Insert after the header line
		const content = readFileSync(activityPath, 'utf-8')
		const lines = content.split('\n')
		const headerEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '') + 1
		lines.splice(Math.max(headerEnd, 2), 0, entry.trim())
		writeFileSync(activityPath, lines.join('\n'), 'utf-8')
	} else {
		writeFileSync(activityPath, `# Activity Log\n\n${entry}`, 'utf-8')
	}
}

/** Get recent activity for a project */
export function getProjectActivity(slug: string, lines = 30, tenantId?: string): string {
	const activityPath = join(getProjectDir(slug, tenantId), 'ACTIVITY.md')
	if (!existsSync(activityPath)) return ''

	const content = readFileSync(activityPath, 'utf-8')
	const allLines = content.split('\n')
	// Skip header, take requested number of lines
	const activityLines = allLines.filter(l => l.startsWith('['))
	return activityLines.slice(0, lines).join('\n')
}

/** Build project context string for injection into system prompt */
export function buildProjectContext(tenantId?: string): string {
	const projects = listProjects(tenantId)
	if (projects.length === 0) return ''

	// Surface the configured default project so the AI knows where to route unattributed messages
	let defaultProjectNote = ''
	try {
		const { loadConfig } = require('./config')
		const cfg = loadConfig()
		if (cfg.defaultProject) {
			defaultProjectNote = ` (default project for unattributed messages: **${cfg.defaultProject}**)`
		}
	} catch { /* config not available */ }

	const lines = [`## Your Active Projects${defaultProjectNote}\n`]
	for (const p of projects) {
		if (p.status === 'archived') continue
		const statusBadge = p.status === 'paused' ? ' (paused)' : ''
		const workspace = p.workspacePath ? ` | workspace: \`${p.workspacePath}\`` : ''
		lines.push(`- **${p.slug}**${statusBadge}: ${p.description}${workspace}`)
	}

	return lines.join('\n')
}

/**
 * Build a shallow file tree string for a directory, respecting ignore list.
 * Returns a tree-style listing up to FILE_TREE_MAX_DEPTH levels deep.
 */
export function getProjectFileTree(dirPath: string, maxDepth = FILE_TREE_MAX_DEPTH): string {
	if (!existsSync(dirPath)) return ''

	const lines: string[] = []
	const walk = (dir: string, prefix: string, depth: number) => {
		if (depth > maxDepth) return
		let entries: { name: string; isDir: boolean }[]
		try {
			entries = readdirSync(dir, { withFileTypes: true })
				.filter(e => !e.name.startsWith('.') || e.name === '.env.example')
				.filter(e => !FILE_TREE_IGNORE.has(e.name))
				.map(e => ({ name: e.name, isDir: e.isDirectory() }))
				.sort((a, b) => {
					// Directories first, then alphabetical
					if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
					return a.name.localeCompare(b.name)
				})
		} catch { return }

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i]
			const isLast = i === entries.length - 1
			const connector = isLast ? '└── ' : '├── '
			const childPrefix = isLast ? '    ' : '│   '
			lines.push(`${prefix}${connector}${entry.name}${entry.isDir ? '/' : ''}`)
			if (entry.isDir && depth < maxDepth) {
				walk(join(dir, entry.name), prefix + childPrefix, depth + 1)
			}
		}
	}

	walk(dirPath, '', 0)
	return lines.join('\n')
}

/**
 * Find the first project instruction file that exists in the given directory.
 * Returns `{ path, filename, content }` or null if none found.
 */
export function findProjectInstructionFile(dirPath: string): { path: string; filename: string; content: string } | null {
	if (!existsSync(dirPath)) return null
	for (const filename of PROJECT_INSTRUCTION_FILES) {
		const fullPath = join(dirPath, filename)
		if (existsSync(fullPath)) {
			try {
				const raw = readFileSync(fullPath, 'utf-8')
				const lines = raw.split('\n')
				const content = lines.length > INSTRUCTION_MAX_LINES
					? lines.slice(0, INSTRUCTION_MAX_LINES).join('\n') + `\n\n… (${lines.length - INSTRUCTION_MAX_LINES} more lines truncated)`
					: raw
				return { path: fullPath, filename, content }
			} catch { return null }
		}
	}
	return null
}

/**
 * Read the README.md body (markdown portion, not frontmatter) for injection into context.
 * Truncated to README_MAX_LINES lines.
 */
function readReadmeBody(projectDir: string): string | null {
	const readme = readReadmeFrontmatter(projectDir)
	if (!readme || !readme.body.trim()) return null

	const lines = readme.body.split('\n')
	if (lines.length > README_MAX_LINES) {
		return lines.slice(0, README_MAX_LINES).join('\n') + `\n\n… (${lines.length - README_MAX_LINES} more lines truncated)`
	}
	return readme.body
}

/** Build detailed context for the currently active project session */
export function buildActiveProjectContext(slug: string, tenantId?: string): string {
	const project = getProject(slug, tenantId)
	if (!project) return ''

	const sections: string[] = []
	sections.push(`## Current Project: ${project.name}\n`)
	sections.push(`**Status:** ${project.status}`)
	sections.push(`**Description:** ${project.description}`)
	if (project.techStack) sections.push(`**Tech Stack:** ${project.techStack}`)
	if (project.workspacePath) sections.push(`**Workspace:** \`${project.workspacePath}\``)
	sections.push(`\n**Task Management:** This project uses a Kanban board. To add tasks use \`project_add_task\`, to list tasks use \`project_get_tasks\`. Do NOT add tasks by editing the README or other project files.`)

	// ── Priority 1: Project-specific AI instructions ──────────────────────────
	if (project.workspacePath) {
		const instructionFile = findProjectInstructionFile(project.workspacePath)
		if (instructionFile) {
			sections.push(`\n### Project Instructions (${instructionFile.filename})\n\n${instructionFile.content}`)
		}
	}

	// ── Priority 2: File tree ─────────────────────────────────────────────────
	if (project.workspacePath && existsSync(project.workspacePath)) {
		const tree = getProjectFileTree(project.workspacePath)
		if (tree) {
			sections.push(`\n### File Tree\n\n\`\`\`\n${tree}\n\`\`\``)
		}
	}

	// ── Priority 3: README body ──────────────────────────────────────────────
	const projectDir = getProjectDir(slug, tenantId)
	const readmeBody = readReadmeBody(projectDir)
	if (readmeBody) {
		sections.push(`\n### Project README\n\n${readmeBody}`)
	}

	// Also include the repo README if workspacePath differs from projectDir
	if (project.workspacePath && project.workspacePath !== projectDir) {
		const repoReadme = readReadmeFrontmatter(project.workspacePath)
		if (repoReadme?.body?.trim()) {
			const bodyLines = repoReadme.body.split('\n')
			const truncated = bodyLines.length > README_MAX_LINES
				? bodyLines.slice(0, README_MAX_LINES).join('\n') + `\n\n… (${bodyLines.length - README_MAX_LINES} more lines truncated)`
				: repoReadme.body
			sections.push(`\n### Repository README\n\n${truncated}`)
		}
	}

	// ── Priority 4: Kanban board summary ─────────────────────────────────────
	const kanbanPath = join(projectDir, 'kanban.json')
	const kanbanTasks: Array<{ status: string; title: string; assignee?: string; id: string }> = existsSync(kanbanPath)
		? (() => { try { return JSON.parse(readFileSync(kanbanPath, 'utf-8')) } catch { return [] } })()
		: []
	const activeTasks = kanbanTasks.filter((t) => t.status !== 'done')
	if (activeTasks.length > 0) {
		sections.push(`\n### Kanban Board (active tasks)\n${activeTasks.map((t) => `- [${t.status}] ${t.title} | Assignee: ${t.assignee || 'None'} | ID: ${t.id}`).join('\n')}`)
	} else {
		sections.push(`\n### Kanban Board: empty — no active tasks yet`)
	}

	// ── Priority 5: Recent activity ───────────────────────────────────────────
	const activity = getProjectActivity(slug, 50, tenantId)
	if (activity) {
		sections.push(`\n### Recent Activity\n\n${activity}`)
	}

	// ── Priority 6: Notes ─────────────────────────────────────────────────────
	const notesPath = join(projectDir, 'NOTES.md')
	if (existsSync(notesPath)) {
		const notes = readFileSync(notesPath, 'utf-8').trim()
		if (notes && notes !== `# ${project.name} — Notes`) {
			sections.push(`\n### Notes\n\n${notes}`)
		}
	}

	return sections.join('\n')
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/** Parse a project from its directory. Reads README.md frontmatter, falls back to config.json, then dir name. */
function parseProjectFromDir(slug: string, projectPath: string): Project {
	// 1. Try README.md frontmatter
	const readme = readReadmeFrontmatter(projectPath)
	if (readme && readme.frontmatter.name) {
		const fm = readme.frontmatter
		return {
			slug,
			name: fm.name,
			status: fm.status || 'active',
			description: fm.description || '',
			techStack: fm.techStack,
			workspacePath: undefined,
			createdAt: fm.createdAt || new Date().toISOString(),
			updatedAt: fm.updatedAt || new Date().toISOString(),
		}
	}

	// 2. Try config.json (legacy, pre-migration)
	const configPath = join(projectPath, 'config.json')
	if (existsSync(configPath)) {
		try {
			const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
			return {
				slug: raw.id || slug,
				name: raw.name || slug,
				status: raw.status || 'active',
				description: raw.description || '',
				techStack: raw.techStack,
				workspacePath: raw.path || raw.workspacePath,
				createdAt: raw.createdAt || new Date().toISOString(),
				updatedAt: raw.updatedAt || new Date().toISOString(),
			}
		} catch { /* fall through */ }
	}

	// 3. Bare directory — project with dir name as name
	let createdAt: string
	try {
		createdAt = statSync(projectPath).birthtime.toISOString()
	} catch { createdAt = new Date().toISOString() }

	return {
		slug,
		name: slug,
		status: 'active',
		description: '',
		createdAt,
		updatedAt: createdAt,
	}
}
