import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { getBridgesConfig, getWorkspacePath, TAMIAS_DIR } from './config.ts'
import { getLoadedSkills } from './skills.js'


export const MEMORY_DIR = join(homedir(), '.tamias', 'memory')
const TEMPLATES_DIR = join(import.meta.dir, '../templates')
const DAILY_DIR = join(MEMORY_DIR, 'daily')

// ─── Persona files ────────────────────────────────────────────────────────────

const PERSONA_FILES = ['SYSTEM.md', 'IDENTITY.md', 'USER.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md'] as const

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

/** Copy template files into memory dir as starting points */
export function scaffoldFromTemplates(): void {
	ensureMemoryDir()

	// These files are only copied once if they don't exist
	const toScaffoldOnce = ['SOUL.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md']
	for (const file of toScaffoldOnce) {
		const dest = join(MEMORY_DIR, file)
		if (!existsSync(dest)) {
			const src = join(TEMPLATES_DIR, file)
			if (existsSync(src)) {
				let content = readFileSync(src, 'utf-8')
				content = stripFrontmatter(content)
				writeFileSync(dest, content, 'utf-8')
			}
		}
	}

	// SYSTEM.md is force-overwritten every time to ensure upstream updates propagate
	const systemSrc = join(TEMPLATES_DIR, 'SYSTEM.md')
	if (existsSync(systemSrc)) {
		const dest = join(MEMORY_DIR, 'SYSTEM.md')
		let content = readFileSync(systemSrc, 'utf-8')
		content = stripFrontmatter(content)
		writeFileSync(dest, content, 'utf-8')
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
export function buildSystemPrompt(toolNames: string[], toolDocs: string, summary?: string, channel?: { id: string, userId?: string, name?: string, authorName?: string, isSubagent?: boolean }): string {
	const files = readAllPersonaFiles()
	const sections: string[] = []

	// Session Summary (if any) — provides context for current conversation
	if (summary) {
		sections.push(`# Current Session Summary\n\n${summary}`)
	}

	if (channel) {
		let channelSection = `# Channel Context\n\nYou are currently communicating on the **${channel.id}** channel`
		if (channel.name) channelSection += ` in **${channel.name}**`
		channelSection += '.'
		if (channel.userId) channelSection += ` Session Identifier: \`${channel.userId}\`.`
		if (channel.authorName) channelSection += `\nCurrent interlocutor: **${channel.authorName}**.`

		if (channel.isSubagent) {
			channelSection += `\n\n# SUB-AGENT MODE\nYou are currently operating as a **sub-agent**. Your goal is to complete the specific task delegated to you and then report your findings back to the main agent.
Be concise, accurate, and focus ONLY on the assigned task. Your final response will be automatically delivered to the parent agent.`
		}

		sections.push(channelSection)
	}

	sections.push(`# Memory Location\n\nYour memory and persona files (USER.md, IDENTITY.md, SOUL.md, AGENTS.md, MEMORY.md, and daily logs) are persistently stored at \`${MEMORY_DIR}\` (which can also be accessed via \`~/.tamias/memory\`).
When reading or updating your memory, you can use either the absolute path or the home-relative path (e.g., \`~/.tamias/memory/USER.md\`.)`)

	// Hard-enforced workspace boundary — always injected, cannot be overridden by user files
	const workspacePath = getWorkspacePath()
	sections.push(
		`# Workspace & File Creation Policy (ENFORCED)\n\n` +
		`**All files you create MUST be stored inside \`${TAMIAS_DIR}\`. Writing outside this directory is forbidden.**\n\n` +
		`- Your current workspace: \`${workspacePath}\`\n` +
		`- Default location for new documents: \`${TAMIAS_DIR}/workspace/\`\n` +
		`- For project-specific work, use a subfolder: \`${TAMIAS_DIR}/workspace/<project-name>/\`\n` +
		`- **Never** write to \`~/Desktop\`, \`~/Documents\`, \`~/Downloads\`, or anywhere outside \`${TAMIAS_DIR}\`.\n` +
		`- When unsure where to save, use \`tamias__get_workspace_path\` then save into that directory.`
	)


	// System framework overrides
	if (files['SYSTEM.md']) {
		sections.push(files['SYSTEM.md'])
	}

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

	// Operating manual
	if (files['AGENTS.md']) {
		sections.push(files['AGENTS.md'])
	}

	// User-provided tool notes & specifics
	if (files['TOOLS.md']) {
		sections.push(files['TOOLS.md'])
	}

	// Heartbeat agenda — periodic tasks
	if (files['HEARTBEAT.md'] && files['HEARTBEAT.md'].trim()) {
		sections.push(`# Periodic Tasks (HEARTBEAT.md)\n\n${files['HEARTBEAT.md']}`)
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
		let toolSection = `# Available Tools\n\nYou have access to the following tools. Tool names use the format \`toolName__functionName\`.\n\n`
		if (toolDocs) {
			toolSection += toolDocs
		} else {
			toolSection += `List of enabled tools: ${toolNames.map((t) => `\`${t}\``).join(', ')}.`
		}
		sections.push(toolSection)
	}

	// Skills
	const skills = getLoadedSkills()
	if (skills.length > 0) {
		const skillsList = skills.map(s => `- \`${s.name}\` (at \`${s.sourceDir}/SKILL.md\`): ${s.description}`).join('\n')
		sections.push(`# Available Skills\n\nYou have access to the following skills. You can read their detailed instructions by reading their \`SKILL.md\` file using your file reading tools if you feel they are applicable to the task at hand.\n\n${skillsList}`)
	}

	// Active Channels
	const bridges = getBridgesConfig()
	const active = []
	if (bridges.terminal?.enabled !== false) active.push('Terminal')
	if (bridges.discord?.enabled) active.push('Discord')
	if (bridges.telegram?.enabled) active.push('Telegram')
	if (active.length > 0) {
		sections.push(`# Connected Channels\nYou are currently reachable via: ${active.join(', ')}.`)
	}

	return sections.join('\n\n---\n\n')
}



/**
 * Update persona files with new insights discovered during conversation.
 * insights: Map of filename to new markdown block to append or merge.
 */
export function updatePersonaFiles(insights: Record<string, string>): void {
	ensureMemoryDir()
	for (const [file, block] of Object.entries(insights)) {
		const path = join(MEMORY_DIR, file)
		const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
		const separator = existing.endsWith('\n') ? '' : '\n'
		const newContent = existing + separator + '\n## New Insights\n\n' + block.trim() + '\n'
		writeFileSync(path, newContent, 'utf-8')
	}
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
