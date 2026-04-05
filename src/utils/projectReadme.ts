import matter from 'gray-matter'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Fields stored in README.md YAML frontmatter */
export interface ProjectFrontmatter {
	name: string
	description?: string
	status?: 'active' | 'paused' | 'archived'
	website?: string
	discordServerId?: string
	discordChannelId?: string
	techStack?: string
	preferredModel?: string
	preferredModelFallbacks?: string[]
	preferredConnections?: string[]
	objectives?: string[]
	createdAt?: string
	updatedAt?: string
}

export interface ProjectReadmeData {
	frontmatter: ProjectFrontmatter
	body: string
}

/**
 * Read and parse README.md frontmatter + body from a project directory.
 * Returns null if the directory doesn't exist or README.md is missing.
 */
export function readProjectReadme(projectDir: string): ProjectReadmeData | null {
	const readmePath = join(projectDir, 'README.md')
	if (!existsSync(readmePath)) return null

	try {
		const raw = readFileSync(readmePath, 'utf-8')
		const { data, content } = matter(raw)
		const frontmatter: ProjectFrontmatter = {
			name: typeof data.name === 'string' ? data.name : '',
			...(data.description != null ? { description: String(data.description) } : {}),
			...(data.status != null ? { status: data.status as ProjectFrontmatter['status'] } : {}),
			...(data.website != null ? { website: String(data.website) } : {}),
			...(data.discordServerId != null ? { discordServerId: String(data.discordServerId) } : {}),
			...(data.discordChannelId != null ? { discordChannelId: String(data.discordChannelId) } : {}),
			...(data.techStack != null ? { techStack: String(data.techStack) } : {}),
			...(data.preferredModel != null ? { preferredModel: String(data.preferredModel) } : {}),
			...(Array.isArray(data.preferredModelFallbacks) ? { preferredModelFallbacks: data.preferredModelFallbacks.map(String) } : {}),
			...(Array.isArray(data.preferredConnections) ? { preferredConnections: data.preferredConnections.map(String) } : {}),
			...(Array.isArray(data.objectives) ? { objectives: data.objectives.map(String) } : {}),
			...(data.createdAt != null ? { createdAt: String(data.createdAt) } : {}),
			...(data.updatedAt != null ? { updatedAt: String(data.updatedAt) } : {}),
		}
		return { frontmatter, body: content }
	} catch {
		return null
	}
}

/**
 * Write README.md with frontmatter + body to a project directory.
 * Overwrites the existing file completely.
 */
export function writeProjectReadme(projectDir: string, frontmatter: ProjectFrontmatter, body: string): void {
	const readmePath = join(projectDir, 'README.md')
	// Strip undefined values from frontmatter to keep YAML clean
	const cleanFm: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(frontmatter)) {
		if (v === undefined || v === null) continue
		if (v === '' && k !== 'name') continue
		cleanFm[k] = v
	}
	const output = matter.stringify(body, cleanFm)
	writeFileSync(readmePath, output, 'utf-8')
}

/**
 * Update only specific frontmatter fields, preserving existing body and other fields.
 * If README.md doesn't exist, creates it with a default body.
 */
export function updateProjectFrontmatter(projectDir: string, updates: Partial<ProjectFrontmatter>): void {
	const existing = readProjectReadme(projectDir)
	const currentFm = existing?.frontmatter ?? { name: '' }
	const currentBody = existing?.body ?? ''

	const merged: ProjectFrontmatter = {
		...currentFm,
		...updates,
	}
	writeProjectReadme(projectDir, merged, currentBody)
}

/**
 * Generate a fresh README.md body from the template.
 */
export function generateReadmeBody(name: string, description?: string): string {
	return `# ${name}

${description || 'A Tamias project.'}

## Objectives

<!-- Project objectives go here -->

## Memos

<!-- Important things to remember -->

## Todo

<!-- Tasks and action items -->

## Notes

<!-- Freeform notes, links, and reference material -->
`
}

/**
 * Append or replace content in a named markdown section (## heading).
 * If the section doesn't exist, appends it at the end.
 * Replaces content between the target ## heading and the next ## heading.
 */
export function updateReadmeSection(body: string, sectionName: string, newContent: string): string {
	const sectionRegex = new RegExp(`(^|\\n)(## ${escapeRegex(sectionName)}\\s*\\n)([\\s\\S]*?)(?=\\n## |$)`)
	const match = body.match(sectionRegex)

	if (match) {
		const prefix = match[1]
		const heading = match[2]
		const replacement = `${prefix}${heading}\n${newContent.trim()}\n`
		return body.replace(sectionRegex, replacement)
	}

	// Section doesn't exist — append it
	const trimmed = body.trimEnd()
	return `${trimmed}\n\n## ${sectionName}\n\n${newContent.trim()}\n`
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
