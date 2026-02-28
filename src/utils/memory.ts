import { join } from 'path'
import { homedir, cpus, freemem, totalmem, platform, arch } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getWorkspacePath, TAMIAS_DIR } from './config.ts'
import { getLoadedSkills } from './skills.js'
import { assembleSystemPrompt as assembleBudget, getSystemPromptBudget, formatTokenBudgetDebug, type ContextTier, type TokenBudgetResult } from './tokenBudget.js'
import { getActiveTenantId } from './tenants.ts'


export const MEMORY_DIR = join(homedir(), '.tamias', 'memory')
const TEMPLATES_DIR = join(import.meta.dir, '../templates')
const DAILY_DIR = join(MEMORY_DIR, 'daily')

// ─── Persona files ────────────────────────────────────────────────────────────

const PERSONA_FILES = ['SYSTEM.md', 'IDENTITY.md', 'USER.md', 'SOUL.md', 'AGENTS.md'] as const

function ensureMemoryDir(): void {
	if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true })
	if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true })
}

/** Returns true if the user has completed onboarding (IDENTITY.md exists) */
export function isOnboarded(): boolean {
	return existsSync(join(MEMORY_DIR, 'IDENTITY.md'))
}

/** Read a persona file from memory dir.
 * If the file is missing but a template exists, the template is scaffolded first.
 * Returns null only if neither the file nor a template can be found. */
export function readPersonaFile(name: string): string | null {
	const path = join(MEMORY_DIR, name)
	if (!existsSync(path)) {
		// Attempt to recover from template before giving up
		const templatePath = join(TEMPLATES_DIR, name)
		if (existsSync(templatePath)) {
			ensureMemoryDir()
			let content = readFileSync(templatePath, 'utf-8')
			content = stripFrontmatter(content)
			writeFileSync(path, content, 'utf-8')
			return content
		}
		return null
	}
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
	const toScaffoldOnce = ['SOUL.md', 'TOOLS.md', 'HEARTBEAT.md', 'MEMORY.md']
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

	// SYSTEM.md, SKILL-GUIDE.md, and AGENTS.md are force-overwritten every time so that
	// upstream changes to CLI commands, agent management, and system capabilities always
	// propagate to existing installs without needing a manual reset.
	for (const file of ['SYSTEM.md', 'SKILL-GUIDE.md', 'AGENTS.md']) {
		const src = join(TEMPLATES_DIR, file)
		if (existsSync(src)) {
			const dest = join(MEMORY_DIR, file)
			let content = readFileSync(src, 'utf-8')
			content = stripFrontmatter(content)
			writeFileSync(dest, content, 'utf-8')
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

// ─── Dynamic Context Variables ────────────────────────────────────────────────

/** Collect real-time context variables for template injection */
export function getContextVariables(channel?: string): Record<string, string> {
	const now = new Date()
	const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
	const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

	const tenantId = getActiveTenantId()
	const freeMemGB = (freemem() / (1024 ** 3)).toFixed(1)
	const totalMemGB = (totalmem() / (1024 ** 3)).toFixed(1)
	const loadAvg = cpus().length > 0 ? (cpus().reduce((sum, c) => {
		const total = Object.values(c.times).reduce((a, b) => a + b, 0)
		return sum + (1 - c.times.idle / total)
	}, 0) / cpus().length * 100).toFixed(0) : 'N/A'

	// Read active project from MEMORY.md if available
	let activeProject = 'none'
	try {
		const memContent = readPersonaFile('MEMORY.md')
		if (memContent) {
			const match = memContent.match(/##\s*Active\s*Project[s]?\s*\n[\s\S]*?\|\s*([^|]+?)\s*\|/)
			if (match) activeProject = match[1].trim()
		}
	} catch { /* ignore */ }

	// Read version from package.json
	let version = 'unknown'
	try {
		const pkgPath = join(import.meta.dir, '../../package.json')
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
			version = pkg.version || 'unknown'
		}
	} catch { /* ignore */ }

	return {
		date: now.toISOString().slice(0, 10),
		time: now.toTimeString().slice(0, 5),
		datetime: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`,
		day_of_week: days[now.getDay()],
		month: months[now.getMonth()],
		year: String(now.getFullYear()),
		timestamp: now.toISOString(),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		tenant_id: tenantId || 'default',
		active_project: activeProject,
		active_channel: channel || 'terminal',
		tamias_version: version,
		platform: `${platform()}/${arch()}`,
		system_load: `${loadAvg}%`,
		memory_free: `${freeMemGB}GB`,
		memory_total: `${totalMemGB}GB`,
		home_dir: homedir(),
		tamias_dir: TAMIAS_DIR,
	}
}

/** Replace {{variable}} placeholders in content with real values */
export function injectDynamicVariables(content: string, vars: Record<string, string>): string {
	return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		return vars[key] ?? match // Leave unreplaced if no value exists
	})
}

// ─── System prompt builder ────────────────────────────────────────────────────

/** Build a full system prompt from persona files.
 * When `agentDir` is provided, SOUL.md / IDENTITY.md / MEMORY.md
 * are loaded from that directory first, falling back to global if absent.
 *
 * Uses the token budget system for structure-first assembly with graceful trimming.
 * Context window defaults to 128k — override via modelContextWindow param. */
export function buildSystemPrompt(
	summary?: string,
	channel?: { id: string, userId?: string, name?: string, authorName?: string, isSubagent?: boolean },
	agentDir?: string,
	opts?: { modelContextWindow?: number; projectContext?: string },
): string {
	// Helper: read from agentDir (if supplied) first, then global MEMORY_DIR
	const readLayered = (name: string): string | null => {
		if (agentDir) {
			const agentPath = join(agentDir, name)
			if (existsSync(agentPath)) return readFileSync(agentPath, 'utf-8')
		}
		return readPersonaFile(name)
	}

	const files = readAllPersonaFiles()

	// ── Dynamic variable injection ────────────────────────────────────────────
	const ctxVars = getContextVariables(channel?.id)
	for (const key of Object.keys(files)) {
		files[key] = injectDynamicVariables(files[key], ctxVars)
	}

	const tiers: ContextTier[] = []

	// ── TIER 0: Identity (P=0, never trimmed) ─────────────────────────────────
	const identity = readLayered('IDENTITY.md')
	if (identity) {
		tiers.push({ name: 'identity', content: identity, priority: 0, trimmable: false })
	}

	// ── TIER 1: Soul (P=1, never trimmed) ─────────────────────────────────────
	const soul = readLayered('SOUL.md')
	if (soul) {
		tiers.push({ name: 'soul', content: soul, priority: 1, trimmable: false })
	}

	// ── TIER 2: User Profile (P=2, never trimmed) ────────────────────────────
	if (files['USER.md']) {
		tiers.push({ name: 'user-profile', content: files['USER.md'], priority: 2, trimmable: false })
	}

	// ── TIER 3: System Framework (P=3, never trimmed) ────────────────────────
	const systemContent: string[] = []

	systemContent.push(`# Memory Location\n\nYour memory and persona files (USER.md, IDENTITY.md, SOUL.md, AGENTS.md, MEMORY.md, and daily logs) are persistently stored at \`${MEMORY_DIR}\` (which can also be accessed via \`~/.tamias/memory\`).
When reading or updating your memory, you can use either the absolute path or the home-relative path (e.g., \`~/.tamias/memory/USER.md\`.)`)

	const workspacePath = getWorkspacePath()
	systemContent.push(
		`# Workspace & File Creation Policy (ENFORCED)\n\n` +
		`**All files you create MUST be stored inside \`${TAMIAS_DIR}\`. Writing outside this directory is forbidden.**\n\n` +
		`- Your current workspace: \`${workspacePath}\`\n` +
		`- Default location for new documents: \`${TAMIAS_DIR}/workspace/\`\n` +
		`- For project-specific work, use a subfolder: \`${TAMIAS_DIR}/workspace/<project-name>/\`\n` +
		`- **Never** write to \`~/Desktop\`, \`~/Documents\`, \`~/Downloads\`, or anywhere outside \`${TAMIAS_DIR}\`.\n` +
		`- When unsure where to save, use \`tamias__get_workspace_path\` then save into that directory.`
	)

	if (agentDir) {
		const agentSlug = agentDir.split('/').pop()
		systemContent.push(`# Named Agent Context\n\nYou are running as the named agent **${agentSlug}**. Your persona files live at \`${agentDir}\`. Files found there override the global defaults.`)
	}

	if (files['SYSTEM.md']) systemContent.push(files['SYSTEM.md'])

	tiers.push({ name: 'system-framework', content: systemContent.join('\n\n'), priority: 3, trimmable: false })

	// ── TIER 4: Long-term Memory (P=4, trimmable) ────────────────────────────
	const memory = readLayered('MEMORY.md')
	if (memory) {
		tiers.push({
			name: 'long-term-memory',
			content: '# Long-Term Memory\n\n' + memory,
			priority: 4,
			trimmable: true,
			minContent: '# Long-Term Memory\n\nRefer to MEMORY.md in ~/.tamias/memory/ for full context.',
		})
	}

	// ── TIER 5: Operating Manual (P=5, trimmable) ────────────────────────────
	if (files['AGENTS.md']) {
		tiers.push({
			name: 'operating-manual',
			content: files['AGENTS.md'],
			priority: 5,
			trimmable: true,
			minContent: '# Operating Manual\n\nRefer to AGENTS.md in ~/.tamias/memory/ for full details.',
		})
	}

	// ── TIER 6: Channel + Sub-agent Context (P=6, never trimmed) ─────────────
	if (channel) {
		const platformNames: Record<string, string> = { discord: 'Discord', telegram: 'Telegram', terminal: 'Terminal', whatsapp: 'WhatsApp' }
		const platformLabel = platformNames[channel.id] ?? channel.id
		let channelSection = `# Channel Context\n\nYou are currently communicating via **${platformLabel}**`
		if (channel.name) channelSection += `, in the **${channel.name}** channel`
		channelSection += '.'
		if (channel.userId) channelSection += ` Session Identifier: \`${channel.userId}\`.`
		if (channel.authorName) channelSection += `\nCurrent interlocutor: **${channel.authorName}**.`

		if (channel.isSubagent) {
			channelSection += `\n\n# SUB-AGENT MODE\nYou are currently operating as a **sub-agent**. Your goal is to complete the specific task delegated to you and then report your findings back to the main agent.
Be concise, accurate, and focus ONLY on the assigned task. Your final response will be automatically delivered to the parent agent.`
		}

		tiers.push({ name: 'channel-context', content: channelSection, priority: 6, trimmable: false })
	}

	// ── TIER 7: Project Context (P=7, trimmable) ─────────────────────────────
	if (opts?.projectContext) {
		tiers.push({
			name: 'project-context',
			content: opts.projectContext,
			priority: 7,
			trimmable: true,
			minContent: '# Projects\n\nProjects are available. Use the project tools or read ~/.tamias/projects/ for details.',
		})
	}

	// ── TIER 8: Session Summary (P=8, never trimmed) ─────────────────────────
	if (summary) {
		tiers.push({
			name: 'session-summary',
			content: `# Current Session Summary\n\n${summary}`,
			priority: 8,
			trimmable: false,
		})
	}

	// ── TIER 9: Available Skills (P=9, trimmable) ────────────────────────────
	const skills = getLoadedSkills()
	if (skills.length > 0) {
		const skillsList = skills.map(s => {
			const modelHint = s.model ? ` [preferred model: ${s.model}]` : ''
			return `- \`${s.name}\` (at \`${s.sourceDir}/SKILL.md\`)${modelHint}: ${s.description}`
		}).join('\n')
		tiers.push({
			name: 'available-skills',
			content: `# Available Skills\n\nYou have access to the following skills. Skills are **reference documents** — they teach you HOW to approach a task. Read their \`SKILL.md\` file when a task matches a skill's description. Skills are NOT agents or sub-agents; execute the instructions yourself unless the skill explicitly tells you to delegate a step. If a skill specifies a preferred model and you choose to spawn a sub-agent for a step, use that model.\n\n${skillsList}`,
			priority: 9,
			trimmable: true,
			minContent: `# Available Skills\n\n${skills.map(s => `- \`${s.name}\`: ${s.description}`).join('\n')}`,
		})
	}

	// ── Assemble with token budget ────────────────────────────────────────────
	const modelContextWindow = opts?.modelContextWindow ?? 128000
	const maxSystemTokens = getSystemPromptBudget(modelContextWindow)

	const result = assembleBudget(tiers, maxSystemTokens)

	if (result.wasTrimmed) {
		console.log(`[context] System prompt trimmed to fit budget:\n${formatTokenBudgetDebug(result)}`)
	}

	return result.systemPrompt
}



/**
 * Update persona files with new insights discovered during conversation.
 * insights: Map of filename to new markdown block to append or merge.
 */
export function updatePersonaFiles(insights: Record<string, string>, date?: string): void {
	ensureMemoryDir()
	const label = date ? `## Update (${date})` : '## New Insights'
	for (const [file, block] of Object.entries(insights)) {
		const path = join(MEMORY_DIR, file)
		const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
		const separator = existing.endsWith('\n') ? '' : '\n'
		const newContent = existing + separator + '\n' + label + '\n\n' + block.trim() + '\n'
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
