/**
 * Project memory system for Tamias.
 *
 * Each project lives at ~/.tamias/projects/<slug>/ (or tenant equivalent)
 * with these files:
 *   - PROJECT.md  — description, goals, tech stack, status
 *   - ACTIVITY.md — rolling append log (most recent first)
 *   - WORKSPACE.md — linked workspace path(s)
 *   - NOTES.md — freeform notes
 */
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { TAMIAS_DIR } from './config.ts'

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
		return join(TAMIAS_DIR, 'tenants', tenantId, 'projects')
	}
	return join(TAMIAS_DIR, 'projects')
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

/** List all projects */
export function listProjects(tenantId?: string): Project[] {
	const dir = getProjectsDir(tenantId)
	if (!existsSync(dir)) return []

	const projects: Project[] = []
	const entries = readdirSync(dir, { withFileTypes: true })

	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		const projectPath = join(dir, entry.name)
		const projectFile = join(projectPath, 'PROJECT.md')
		if (!existsSync(projectFile)) continue

		const project = parseProjectFile(entry.name, projectFile)
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
	const projectFile = join(getProjectDir(slug, tenantId), 'PROJECT.md')
	if (!existsSync(projectFile)) return null
	return parseProjectFile(slug, projectFile)
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

	writeProjectFile(slug, project, opts?.tenantId)

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
	writeProjectFile(slug, project, tenantId)

	// Log the status change
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

	const lines = ['## Your Active Projects\n']
	for (const p of projects) {
		if (p.status === 'archived') continue
		const statusBadge = p.status === 'paused' ? ' (paused)' : ''
		const workspace = p.workspacePath ? ` | workspace: \`${p.workspacePath}\`` : ''
		lines.push(`- **${p.slug}**${statusBadge}: ${p.description}${workspace}`)
	}

	return lines.join('\n')
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

	// Include recent activity
	const activity = getProjectActivity(slug, 50, tenantId)
	if (activity) {
		sections.push(`\n### Recent Activity\n\n${activity}`)
	}

	// Include notes if they exist and are non-empty
	const notesPath = join(getProjectDir(slug, tenantId), 'NOTES.md')
	if (existsSync(notesPath)) {
		const notes = readFileSync(notesPath, 'utf-8').trim()
		if (notes && notes !== `# ${project.name} — Notes`) {
			sections.push(`\n### Notes\n\n${notes}`)
		}
	}

	return sections.join('\n')
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

function parseProjectFile(slug: string, filePath: string): Project | null {
	try {
		const content = readFileSync(filePath, 'utf-8')

		// Parse simple frontmatter-style fields from the markdown
		let name = slug
		let status: Project['status'] = 'active'
		let description = ''
		let techStack: string | undefined
		let workspacePath: string | undefined
		let createdAt = ''
		let updatedAt = ''

		const lines = content.split('\n')
		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed.startsWith('# ')) {
				name = trimmed.slice(2).trim()
			}
			if (trimmed.startsWith('**Status:**')) {
				const val = trimmed.replace('**Status:**', '').trim().toLowerCase()
				if (['active', 'paused', 'archived'].includes(val)) status = val as Project['status']
			}
			if (trimmed.startsWith('**Description:**')) {
				description = trimmed.replace('**Description:**', '').trim()
			}
			if (trimmed.startsWith('**Tech Stack:**')) {
				techStack = trimmed.replace('**Tech Stack:**', '').trim()
			}
			if (trimmed.startsWith('**Workspace:**')) {
				workspacePath = trimmed.replace('**Workspace:**', '').trim().replace(/`/g, '')
			}
			if (trimmed.startsWith('**Created:**')) {
				createdAt = trimmed.replace('**Created:**', '').trim()
			}
			if (trimmed.startsWith('**Updated:**')) {
				updatedAt = trimmed.replace('**Updated:**', '').trim()
			}
		}

		// If no description found in structured format, use the first non-header line
		if (!description) {
			const descLine = lines.find(l => l.trim() && !l.startsWith('#') && !l.startsWith('**'))
			if (descLine) description = descLine.trim()
		}

		// Use file timestamps as fallback
		if (!createdAt) {
			try {
				const stat = statSync(filePath)
				createdAt = stat.birthtime.toISOString()
			} catch { createdAt = new Date().toISOString() }
		}
		if (!updatedAt) {
			try {
				const stat = statSync(filePath)
				updatedAt = stat.mtime.toISOString()
			} catch { updatedAt = createdAt }
		}

		return { slug, name, status, description, techStack, workspacePath, createdAt, updatedAt }
	} catch {
		return null
	}
}

function writeProjectFile(slug: string, project: Project, tenantId?: string): void {
	const dir = getProjectDir(slug, tenantId)
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

	const content = `# ${project.name}

**Status:** ${project.status}
**Description:** ${project.description}
${project.techStack ? `**Tech Stack:** ${project.techStack}\n` : ''}${project.workspacePath ? `**Workspace:** \`${project.workspacePath}\`\n` : ''}**Created:** ${project.createdAt}
**Updated:** ${project.updatedAt}
`
	writeFileSync(join(dir, 'PROJECT.md'), content, 'utf-8')
}
