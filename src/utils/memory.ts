import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'

export const MEMORY_DIR = join(homedir(), '.tamias', 'memory')
const TEMPLATES_DIR = join(import.meta.dir, '../templates')
const DAILY_DIR = join(MEMORY_DIR, 'daily')

// ─── Persona files ────────────────────────────────────────────────────────────

const PERSONA_FILES = ['IDENTITY.md', 'USER.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md'] as const

function ensureMemoryDir(): void {
	if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true })
	if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true })
}

/** Returns true if the user has completed onboarding (IDENTITY.md exists) */
export function isOnboarded(): boolean {
	return existsSync(join(MEMORY_DIR, 'IDENTITY.md'))
}

/** Read a persona file from memory dir. Returns null if not found. */
export function readPersonaFile(name: string): string | null {
	const path = join(MEMORY_DIR, name)
	if (!existsSync(path)) return null
	return readFileSync(path, 'utf-8')
}

/** Write or update a file in the memory dir */
export function writePersonaFile(name: string, content: string): void {
	ensureMemoryDir()
	writeFileSync(join(MEMORY_DIR, name), content, 'utf-8')
}

/** Copy template files (SOUL, AGENTS, TOOLS, HEARTBEAT) into memory dir as starting points */
export function scaffoldFromTemplates(): void {
	ensureMemoryDir()
	const toScaffold = ['SOUL.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md']
	for (const file of toScaffold) {
		const dest = join(MEMORY_DIR, file)
		if (!existsSync(dest)) {
			const src = join(TEMPLATES_DIR, file)
			if (existsSync(src)) {
				// Strip YAML frontmatter before copying
				let content = readFileSync(src, 'utf-8')
				content = stripFrontmatter(content)
				writeFileSync(dest, content, 'utf-8')
			}
		}
	}
}

function stripFrontmatter(content: string): string {
	if (!content.startsWith('---')) return content
	const end = content.indexOf('---', 3)
	if (end === -1) return content
	return content.slice(end + 3).trimStart()
}

/** Read all persona files and return their contents */
export function readAllPersonaFiles(): Record<string, string> {
	const result: Record<string, string> = {}
	for (const file of PERSONA_FILES) {
		const content = readPersonaFile(file)
		if (content) result[file] = content
	}
	// Also read MEMORY.md if it exists
	const memory = readPersonaFile('MEMORY.md')
	if (memory) result['MEMORY.md'] = memory
	return result
}

// ─── System prompt builder ────────────────────────────────────────────────────

/** Build a full system prompt from persona files + tool list */
export function buildSystemPrompt(toolNames: string[]): string {
	const files = readAllPersonaFiles()
	const sections: string[] = []

	// Soul first — defines core behaviour
	if (files['SOUL.md']) {
		sections.push(files['SOUL.md'])
	}

	// Identity — who the AI is
	if (files['IDENTITY.md']) {
		sections.push(files['IDENTITY.md'])
	}

	// User — who the human is
	if (files['USER.md']) {
		sections.push(files['USER.md'])
	}

	// Operating manual — safety, memory rules
	if (files['AGENTS.md']) {
		sections.push(files['AGENTS.md'])
	}

	// Long-term memory
	if (files['MEMORY.md']) {
		sections.push('# Long-Term Memory\n\n' + files['MEMORY.md'])
	}

	// Today's daily notes
	const today = new Date().toISOString().slice(0, 10)
	const dailyPath = join(DAILY_DIR, `${today}.md`)
	if (existsSync(dailyPath)) {
		const dailyContent = readFileSync(dailyPath, 'utf-8')
		if (dailyContent.trim()) {
			sections.push(`# Today's Notes (${today})\n\n${dailyContent}`)
		}
	}

	// Tools
	if (toolNames.length > 0) {
		sections.push(`# Available Tools\n\nYou have access to: ${toolNames.map((t) => `\`${t}\``).join(', ')}.\nTool names use the format \`toolName__functionName\`.`)
	}

	// Timestamp
	sections.push(`# Current Time\n\n${new Date().toLocaleString()}`)

	return sections.join('\n\n---\n\n')
}

// ─── Daily log ────────────────────────────────────────────────────────────────

/** Append a line to today's daily log */
export function appendDailyLog(text: string): void {
	ensureMemoryDir()
	const today = new Date().toISOString().slice(0, 10)
	const path = join(DAILY_DIR, `${today}.md`)
	const prefix = existsSync(path) ? '\n' : `# ${today}\n\n`
	writeFileSync(path, prefix + text + '\n', { flag: 'a' })
}
