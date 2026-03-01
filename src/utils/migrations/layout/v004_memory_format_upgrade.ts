/**
 * Layout migration v004: Migrate MEMORY.md from legacy format to new format.
 *
 * The old format mixed "Active Projects" table + recent activity in one file.
 * The new format separates concerns:
 *   - MEMORY.md   → recent activity, lessons learned, pending items
 *   - SETTINGS.md → the projects registry
 *
 * Also archives any legacy SYSTEM.md left in the memory dir
 * (it was superseded by PROTOCOL.md which is force-refreshed on every start).
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Migration } from '../types.ts'

const NEW_MEMORY_TEMPLATE = `# MEMORY.md — Recent Activity & Lessons

*This file is rewritten on every compaction. It captures what happened recently, lessons worth carrying forward, and open threads.*

## Last Session

*(Filled in after the first compaction — what was discussed, what was accomplished.)*

## Lessons Learned

- *(Things discovered that should guide future work: API quirks, user preferences, bugs found, conventions to follow.)*

## Pending

- *(Tasks or reminders that carry over to the next session.)*
`

/**
 * Detect legacy MEMORY.md: the old format had an "## Active Projects" section
 * or a projects markdown table directly in the memory file.
 */
function isLegacyMemory(content: string): boolean {
	return /##\s*Active\s*Projects?/i.test(content)
}

/**
 * Check whether SETTINGS.md projects table is still empty (just the header row).
 */
function settingsHasNoProjects(content: string): boolean {
	// Match the table header + separator + nothing else before the next section
	return /\|\s*Name\s*\|[^\n]*\n\|[-\s|]+\|\n\n/.test(content)
}

export const migration: Migration = {
	version: 4,
	domain: 'layout',
	description: 'Migrate MEMORY.md from legacy format (projects + activity) to new split format',
	aiAssisted: true,
	up: async (tamiasDirPath: string, aiGenerate) => {
		const memoryDir = join(tamiasDirPath, 'memory')
		if (!existsSync(memoryDir)) {
			return { success: true, message: 'No memory dir found, nothing to migrate' }
		}

		const results: string[] = []

		// ── 1. Archive legacy SYSTEM.md (superseded by PROTOCOL.md) ────────────
		const legacySystemPath = join(memoryDir, 'SYSTEM.md')
		if (existsSync(legacySystemPath)) {
			const bakPath = join(memoryDir, 'legacy-SYSTEM.md.bak')
			if (!existsSync(bakPath)) {
				renameSync(legacySystemPath, bakPath)
				results.push('Archived legacy SYSTEM.md → legacy-SYSTEM.md.bak')
			}
		}

		// ── 2. Check MEMORY.md format ────────────────────────────────────────────
		const memoryPath = join(memoryDir, 'MEMORY.md')
		if (!existsSync(memoryPath)) {
			return {
				success: true,
				message: results.length > 0 ? results.join('; ') : 'No MEMORY.md found, nothing to migrate',
			}
		}

		const memoryContent = readFileSync(memoryPath, 'utf-8')

		if (!isLegacyMemory(memoryContent)) {
			return {
				success: true,
				message: results.length > 0
					? results.join('; ') + '; MEMORY.md already in new format'
					: 'MEMORY.md already in new format',
			}
		}

		// ── 3. AI-assisted reformat ──────────────────────────────────────────────
		if (!aiGenerate) {
			// Mark as deferred — will retry once a model is available
			return {
				success: true,
				message: (results.length > 0 ? results.join('; ') + '; ' : '') +
					'Legacy MEMORY.md detected but no AI available — deferred',
				deferred: true,
			}
		}

		const prompt = `You are migrating a Tamias AI memory file from a legacy format to a new format.

LEGACY MEMORY.md content:
\`\`\`markdown
${memoryContent}
\`\`\`

The legacy format mixed an "Active Projects" table with recent activity in one file.
The new architecture separates these concerns:
  - MEMORY.md → recent activity, lessons learned, pending items only
  - SETTINGS.md → the projects registry (separate file)

Please reformat this content. Return ONLY a valid JSON object with these two string fields:
{
  "newMemory": "...",
  "projectRows": "..."
}

Rules:
- "newMemory": A reformatted MEMORY.md in the new format. Keep the heading "# MEMORY.md — Recent Activity & Lessons". Include "## Last Session", "## Lessons Learned", and "## Pending" sections. Preserve any real activity/session/lesson content from the original. If there's no real content, use the default placeholder text.
- "projectRows": Extract the rows (not the header) from any Active Projects table. Each row should be a markdown table row like "| Name | Description | Folder | Channel |". If there are no projects, return an empty string.

Do NOT include any explanation. Return ONLY the JSON object.`

		let newMemory: string
		let projectRows: string

		try {
			const raw = await aiGenerate(prompt)
			// Strip markdown code fences if the model wraps the response
			const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
			const parsed = JSON.parse(cleaned)
			newMemory = typeof parsed.newMemory === 'string' ? parsed.newMemory : NEW_MEMORY_TEMPLATE
			projectRows = typeof parsed.projectRows === 'string' ? parsed.projectRows.trim() : ''
		} catch {
			// Fallback: preserve original content under Last Session
			newMemory = `# MEMORY.md — Recent Activity & Lessons

*This file is rewritten on every compaction.*

## Last Session

*(Migrated from legacy format — see raw content below)*

${memoryContent}

## Lessons Learned

- *(Add lessons here.)*

## Pending

- *(Add pending items here.)*
`
			projectRows = ''
		}

		writeFileSync(memoryPath, newMemory, 'utf-8')
		results.push('Reformatted MEMORY.md to new activity-only format')

		// ── 4. Migrate projects into SETTINGS.md ─────────────────────────────────
		if (projectRows) {
			const settingsPath = join(memoryDir, 'SETTINGS.md')

			// Scaffold SETTINGS.md from template if missing
			if (!existsSync(settingsPath)) {
				const templatePath = join(import.meta.dir, '../../../templates/SETTINGS.md')
				if (existsSync(templatePath)) {
					let content = readFileSync(templatePath, 'utf-8')
					// Strip frontmatter
					if (content.startsWith('---')) {
						const end = content.indexOf('---', 3)
						if (end !== -1) content = content.slice(end + 3).trimStart()
					}
					writeFileSync(settingsPath, content, 'utf-8')
				}
			}

			if (existsSync(settingsPath)) {
				const settingsContent = readFileSync(settingsPath, 'utf-8')
				if (settingsHasNoProjects(settingsContent)) {
					// Insert rows after the header + separator row
					const newSettings = settingsContent.replace(
						/((?:\|[-\s|]+\|)\n)\n/,
						`$1${projectRows}\n\n`
					)
					if (newSettings !== settingsContent) {
						writeFileSync(settingsPath, newSettings, 'utf-8')
						results.push('Migrated projects from MEMORY.md → SETTINGS.md')
					}
				}
			}
		}

		return { success: true, message: results.join('; ') }
	},
}
