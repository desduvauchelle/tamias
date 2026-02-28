import { join } from 'path'
import { homedir, cpus, freemem, totalmem, platform, arch } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { getWorkspacePath, TAMIAS_DIR } from './config.ts'
import { getLoadedSkills } from './skills.js'
import { assembleSystemPrompt as assembleBudget, getSystemPromptBudget, formatTokenBudgetDebug, type ContextTier, type TokenBudgetResult } from './tokenBudget.js'
import { getActiveTenantId } from './tenants.ts'


export const MEMORY_DIR = join(homedir(), '.tamias', 'memory')
const TEMPLATES_DIR = join(import.meta.dir, '../templates')
const DAILY_DIR = join(MEMORY_DIR, 'daily')

// ─── Persona files ────────────────────────────────────────────────────────────

const PERSONA_FILES = ['IDENTITY.md', 'USER.md'] as const

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

	// These files are only copied once if they don't exist (user-owned)
	const toScaffoldOnce = ['SETTINGS.md', 'TOOLS.md', 'HEARTBEAT.md', 'MEMORY.md']
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

	// PROTOCOL.md is force-overwritten every time so upstream changes to the
	// ReAct protocol and constraints always propagate to existing installs.
	for (const file of ['PROTOCOL.md']) {
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

/** Build the ENVIRONMENT section of the system prompt dynamically.
 *
 * Structure:
 *   - Timestamp / CWD / channel
 *   - ~/.tamias/ root listing (1 level, skip secrets/db/logs)
 *   - ~/.tamias/memory/ flat file listing
 *   - ~/.tamias/workspace/ 1 level deep (project names only)
 *   - Project snapshots: first paragraph of PROJECT-README.md or README.md per project
 */
function buildEnvironmentSection(
	channel?: { id: string; name?: string },
	cwd?: string,
	activeProjectDir?: string,
): string {
	const now = new Date()
	const datePart = now.toISOString().slice(0, 10)
	const timePart = `${now.toTimeString().slice(0, 5)} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`
	const workingDir = cwd ?? process.cwd()

	const lines: string[] = ['## ENVIRONMENT']
	lines.push(`- **Date:** ${datePart}`)
	lines.push(`- **Time:** ${timePart}`)
	lines.push(`- **Working Directory:** ${workingDir}`)
	if (activeProjectDir && activeProjectDir !== workingDir) {
		lines.push(`- **Active Project:** ${activeProjectDir}`)
	}
	if (channel) {
		const platformNames: Record<string, string> = { discord: 'Discord', telegram: 'Telegram', terminal: 'Terminal', whatsapp: 'WhatsApp' }
		const platformLabel = platformNames[channel.id] ?? channel.id
		lines.push(`- **Channel:** ${platformLabel}${channel.name ? ` / #${channel.name}` : ''}`)
	}

	// ── Helper: read immediate children of a directory ────────────────────
	function listDir(dir: string): { name: string; isDir: boolean }[] {
		try {
			return readdirSync(dir)
				.sort()
				.map(name => {
					try { return { name, isDir: statSync(join(dir, name)).isDirectory() } }
					catch { return null }
				})
				.filter(Boolean) as { name: string; isDir: boolean }[]
		} catch { return [] }
	}

	// ── ~/.tamias/ root ───────────────────────────────────────────────────
	// Skip secrets, databases, raw logs, and noise dirs
	const tamiasSkipFiles = new Set(['.env', 'config.db', 'sessions.db', 'tamias.db'])
	const tamiasSkipExts = new Set(['.db', '.sqlite', '.sqlite3', '.log'])
	const tamiasSkipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'logs'])

	const tamiasEntries = listDir(TAMIAS_DIR).filter(e => {
		if (e.isDir) return !tamiasSkipDirs.has(e.name) && !e.name.startsWith('.')
		// skip hidden files, env, db files, log files
		if (e.name.startsWith('.')) return false
		if (tamiasSkipFiles.has(e.name)) return false
		const ext = e.name.slice(e.name.lastIndexOf('.'))
		return !tamiasSkipExts.has(ext)
	})

	if (tamiasEntries.length > 0) {
		lines.push('')
		lines.push('#### ~/.tamias/')
		lines.push('```')
		for (const e of tamiasEntries) lines.push(e.isDir ? `${e.name}/` : e.name)
		lines.push('```')
	}

	// ── ~/.tamias/memory/ ─────────────────────────────────────────────────
	const memoryEntries = listDir(MEMORY_DIR).filter(e => !e.isDir && !e.name.startsWith('.'))
	if (memoryEntries.length > 0) {
		lines.push('')
		lines.push('#### ~/.tamias/memory/')
		lines.push('```')
		for (const e of memoryEntries) lines.push(e.name)
		lines.push('```')
	}

	// ── ~/.tamias/workspace/ — 1 level (project names) ───────────────────
	const workspacePath = getWorkspacePath()
	if (existsSync(workspacePath)) {
		const projectEntries = listDir(workspacePath).filter(e => e.isDir && !e.name.startsWith('.'))
		if (projectEntries.length > 0) {
			lines.push('')
			lines.push('#### ~/.tamias/workspace/')
			lines.push('```')
			for (const e of projectEntries) lines.push(`${e.name}/`)
			lines.push('```')

			// ── Project snapshots ─────────────────────────────────────────
			// For each project dir, read PROJECT-README.md or README.md and
			// extract the opening description (up to first ## section, max 5 lines).
			const snapshots: { name: string; gist: string }[] = []
			for (const e of projectEntries) {
				const projectDir = join(workspacePath, e.name)
				let readmeContent: string | null = null
				for (const candidate of ['PROJECT-README.md', 'README.md', 'MEMORY.md']) {
					const p = join(projectDir, candidate)
					if (existsSync(p)) {
						try { readmeContent = readFileSync(p, 'utf-8'); break } catch { /* skip */ }
					}
				}
				if (!readmeContent) continue

				// Strip YAML frontmatter
				let body = readmeContent.startsWith('---')
					? readmeContent.slice((readmeContent.indexOf('---', 3) + 3)).trimStart()
					: readmeContent

				// Skip the top-level # heading line, then grab up to the next ## or 4 non-empty lines
				const bodyLines = body.split('\n')
				let started = false
				const gistLines: string[] = []
				for (const l of bodyLines) {
					if (!started && l.startsWith('# ')) { started = true; continue }
					if (l.startsWith('## ')) break
					const trimmed = l.trim()
					if (trimmed) {
						gistLines.push(trimmed)
						if (gistLines.length >= 4) break
					}
				}
				if (gistLines.length > 0) {
					snapshots.push({ name: e.name, gist: gistLines.join(' ').slice(0, 200) })
				}
			}

			if (snapshots.length > 0) {
				lines.push('')
				lines.push('#### Project Snapshots')
				for (const s of snapshots) {
					lines.push(`- **${s.name}** — ${s.gist}`)
				}
			}

			// ── Channel-matched project drill-down ────────────────────────
			// If the current channel name resembles a workspace project folder,
			// include a 1-level directory listing of that project so the AI
			// has immediate structural context without needing to call a tool.
			if (channel?.name) {
				/** Normalize a string for fuzzy matching: lowercase, strip
				 *  all non-alphanumeric characters so "project-one",
				 *  "project_one", "Project One", and "projectone" all match. */
				const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
				const channelNorm = normalize(channel.name)

				const matchedProject = projectEntries.find(e => {
					const projectNorm = normalize(e.name)
					return (
						projectNorm === channelNorm ||
						projectNorm.includes(channelNorm) ||
						channelNorm.includes(projectNorm)
					)
				})

				if (matchedProject) {
					const matchedDir = join(workspacePath, matchedProject.name)
					const matchedEntries = listDir(matchedDir)
					const skipNoise = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'])
					const visible = matchedEntries.filter(e =>
						!e.name.startsWith('.') && !(e.isDir && skipNoise.has(e.name))
					)
					if (visible.length > 0) {
						lines.push('')
						lines.push(`#### Active Project: ${matchedProject.name}/ (matched channel #${channel.name})`)
						lines.push('```')
						for (const e of visible) lines.push(e.isDir ? `${e.name}/` : e.name)
						lines.push('```')
					}
				}
			}
		}
	}

	return lines.join('\n')
}

/** Build a full system prompt from persona files.
 * Six tiers in order: IDENTITY & ROLE → USER → AGENTIC PROTOCOL → PERSISTENT KNOWLEDGE →
 * SKILLS CATALOG → ENVIRONMENT → SESSION SUMMARY.
 * Static tiers are placed first to enable LLM automatic prefix caching.
 *
 * When `agentDir` is provided, IDENTITY.md / USER.md / MEMORY.md
 * are loaded from that directory first, falling back to global if absent.
 *
 * Uses the token budget system for structure-first assembly with graceful trimming.
 * Context window defaults to 128k — override via modelContextWindow param. */
export function buildSystemPrompt(
	summary?: string,
	channel?: { id: string, userId?: string, name?: string, authorName?: string, isSubagent?: boolean },
	agentDir?: string,
	opts?: { modelContextWindow?: number; projectContext?: string; cwd?: string },
): string {
	// Helper: read from agentDir (if supplied) first, then global MEMORY_DIR
	const readLayered = (name: string): string | null => {
		if (agentDir) {
			const agentPath = join(agentDir, name)
			if (existsSync(agentPath)) return readFileSync(agentPath, 'utf-8')
		}
		return readPersonaFile(name)
	}

	// ── Dynamic variable injection ─────────────────────────────────────────
	const ctxVars = getContextVariables(channel?.id)

	const inject = (content: string) => injectDynamicVariables(content, ctxVars)

	const tiers: ContextTier[] = []

	// ── TIER 0: Identity & Role (P=0, never trimmed) ──────────────────────
	const identity = readLayered('IDENTITY.md')
	if (identity) {
		tiers.push({
			name: 'identity-role',
			content: inject(identity),
			priority: 0,
			trimmable: false,
		})
	}

	// ── TIER 1: User (P=1, never trimmed) ────────────────────────────────
	const user = readLayered('USER.md')
	if (user) {
		tiers.push({
			name: 'user',
			content: inject(user),
			priority: 1,
			trimmable: false,
		})
	}

	// ── TIER 5: Environment (P=5, never trimmed — built dynamically, placed late for caching) ──
	// Determine active project directory
	let activeProjectDir: string | undefined
	try {
		const memContent = readPersonaFile('MEMORY.md')
		if (memContent) {
			// Try to find a folder path in SETTINGS.md or MEMORY.md
			const match = memContent.match(/\|\s*([~/][^|]+?)\s*\|/)
			if (match) activeProjectDir = match[1].replace(/^~/, process.env.HOME ?? '')
		}
	} catch { /* ignore */ }

	const envSection = buildEnvironmentSection(channel, opts?.cwd, activeProjectDir)

	const workspacePolicy =
		`\n\n## File & Document Storage Policy\n\n` +
		`**All files you create MUST be stored inside \`${TAMIAS_DIR}\`.**\n\n` +
		`- Your authorized workspace: \`${getWorkspacePath()}\`\n` +
		`- Default location for new documents: \`${TAMIAS_DIR}/workspace/\`\n` +
		`- **Never** write to \`~/Desktop\`, \`~/Documents\`, or anywhere outside \`${TAMIAS_DIR}\`.`

	let envContent = envSection + workspacePolicy

	if (agentDir) {
		const agentSlug = agentDir.split('/').pop()
		envContent += `\n\n## Named Agent Context\n\nYou are running as the named agent **${agentSlug}**. Your persona files live at \`${agentDir}\`. Files found there override the global defaults.`
	}

	if (channel?.isSubagent) {
		envContent += `\n\n## SUB-AGENT MODE\nYou are operating as a **sub-agent**. Complete the specific task delegated to you and report findings back to the main agent. Be concise and focus ONLY on the assigned task.`
	}

	tiers.push({ name: 'environment', content: envContent, priority: 5, trimmable: false })

	// ── TIER 3: Persistent Knowledge (P=3, trimmable) ─────────────────────
	// 3a: SETTINGS.md (global + project-level)
	const settingsGlobal = readLayered('SETTINGS.md')
	const settingsProject = opts?.projectContext
		? opts.projectContext.includes('SETTINGS') ? opts.projectContext : null
		: null

	let persistentContent = ''

	if (settingsGlobal || settingsProject) {
		persistentContent += `## PROJECT CONSTITUTION (SETTINGS.md)\n\n`
		if (settingsGlobal) persistentContent += inject(settingsGlobal)
		if (settingsProject) persistentContent += `\n\n---\n\n*Project override:*\n${settingsProject}`
	}

	// 3b: MEMORY.md snippet (trimmable)
	const memory = readLayered('MEMORY.md')
	if (memory) {
		const memSnippet = inject(memory)
		if (persistentContent) persistentContent += `\n\n---\n\n`
		persistentContent += `## RECENT ACTIVITY & LESSONS (MEMORY.md)\n\n${memSnippet}`
	}

	// 3c: Project context (if not already consumed above)
	if (opts?.projectContext && !settingsProject) {
		persistentContent += `\n\n---\n\n${opts.projectContext}`
	}

	if (persistentContent) {
		tiers.push({
			name: 'persistent-knowledge',
			content: `# PERSISTENT KNOWLEDGE (MEMORY)\n\nThe following data is retrieved from your local long-term storage. Treat these as "Ground Truth":\n\n${persistentContent}`,
			priority: 3,
			trimmable: true,
			minContent: `# PERSISTENT KNOWLEDGE (MEMORY)\n\nRefer to SETTINGS.md and MEMORY.md in ${MEMORY_DIR} for full context.`,
		})
	}

	// ── TIER 4: Skills Catalog (P=4, trimmable) ────────────────────────────
	const skills = getLoadedSkills()
	if (skills.length > 0) {
		const skillsList = skills.map(s => {
			const modelHint = s.model ? ` [preferred model: ${s.model}]` : ''
			return `- **${s.name}**${modelHint}: ${s.description}`
		}).join('\n')
		tiers.push({
			name: 'skills-catalog',
			content: `## SKILLS CATALOG (ON-DEMAND)\n\nYou have "Expertise Packages." To use one, call \`tamias__load_skill(name)\`.\n\n${skillsList}\n\n- **skill-manager:** Use this to CREATE or EDIT skills in \`~/.tamias/skills/\``,
			priority: 4,
			trimmable: true,
			minContent: `## SKILLS CATALOG\n\n${skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}`,
		})
	}

	// ── TIER 2: Agentic Protocol (P=2, never trimmed — early for cache prefix) ──
	const protocol = readPersonaFile('PROTOCOL.md')
	if (protocol) {
		tiers.push({
			name: 'agentic-protocol',
			content: inject(protocol),
			priority: 2,
			trimmable: false,
		})
	}

	// ── TIER 6: Session Backstory (P=6, never trimmed) ───────────────────
	if (summary) {
		const backstoryLines = summary.trim().split('\n').map((l: string) => `> ${l}`).join('\n')
		tiers.push({
			name: 'session-summary',
			content: `### SESSION BACKSTORY (COMPACTED)\nBelow is the summary of the project progress and decisions made prior to the current active window:\n\n${backstoryLines}`,
			priority: 6,
			trimmable: false,
		})
	}

	// ── Assemble with token budget ────────────────────────────────────────
	const modelContextWindow = opts?.modelContextWindow ?? 128000
	const maxSystemTokens = getSystemPromptBudget(modelContextWindow)

	const result = assembleBudget(tiers, maxSystemTokens)

	if (result.wasTrimmed) {
		console.log(`[context] System prompt trimmed to fit budget:\n${formatTokenBudgetDebug(result)}`)
	}

	return result.systemPrompt
}

export interface SystemPromptTierInfo {
	name: string
	content: string
	isStatic: boolean
	estimatedTokens: number
}

/**
 * Build a system prompt and return tier metadata alongside the text.
 * Used by aiService to apply provider-specific cache control on static tiers.
 */
export function buildSystemPromptWithTiers(
	summary?: string,
	channel?: { id: string, userId?: string, name?: string, authorName?: string, isSubagent?: boolean },
	agentDir?: string,
	opts?: { modelContextWindow?: number; projectContext?: string; cwd?: string },
): { text: string; tiers: SystemPromptTierInfo[] } {
	// Static tier names — these rarely change and benefit from LLM caching
	const STATIC_TIERS = new Set(['identity-role', 'user', 'agentic-protocol'])

	// Reuse the existing buildSystemPrompt logic by calling the internal tier builder
	// For now, we build twice — but this is cheap (no I/O on second pass since files are cached)
	const text = buildSystemPrompt(summary, channel, agentDir, opts)

	// Re-derive tier info. Since buildSystemPrompt uses assembleBudget internally,
	// we approximate by splitting on the tier separator.
	// A more precise approach would refactor buildSystemPrompt to share the tier array,
	// but this avoids breaking the existing API.
	const tierInfos: SystemPromptTierInfo[] = [
		{ name: 'identity-role', isStatic: true },
		{ name: 'user', isStatic: true },
		{ name: 'agentic-protocol', isStatic: true },
		{ name: 'persistent-knowledge', isStatic: false },
		{ name: 'skills-catalog', isStatic: false },
		{ name: 'environment', isStatic: false },
		{ name: 'session-summary', isStatic: false },
	].map(t => ({
		...t,
		content: '',
		estimatedTokens: 0,
	}))

	return { text, tiers: tierInfos }
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
