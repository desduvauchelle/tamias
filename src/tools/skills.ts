import { tool } from 'ai'
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getLoadedSkills, USER_SKILLS_DIR } from '../utils/skills.ts'

export const SKILLS_TOOL_NAME = 'skills'
export const SKILLS_TOOL_LABEL = '🧩 Skills (load skill reference documents on demand)'

/**
 * Load a skill's full SKILL.md content into the conversation context.
 * This is the implementation behind the SKILLS CATALOG "call load_skill(name)" instruction.
 */
export const skillsTools = {
	load_skill: tool({
		description:
			'Load the full reference document for a skill into context. Use this when you need to follow a skill\'s instructions. ' +
			'Returns the complete SKILL.md content for the requested skill. ' +
			'If the skill is not found, returns a list of available skills.',
		inputSchema: z.object({
			name: z.string().describe('The skill name to load, e.g. "researcher", "coder", "skill-manager"'),
		}),
		execute: async ({ name }: { name: string }) => {
			const skills = getLoadedSkills()
			const normalised = name.trim().toLowerCase()

			// Try exact match first, then prefix/fuzzy
			let skill = skills.find(s => s.name.toLowerCase() === normalised)
			if (!skill) {
				skill = skills.find(s => s.name.toLowerCase().includes(normalised) || normalised.includes(s.name.toLowerCase()))
			}

			if (!skill) {
				const available = skills.length > 0
					? skills.map(s => `- \`${s.name}\`: ${s.description}`).join('\n')
					: '(no skills installed yet — use `tamias skills add` to create one)'
				return {
					success: false,
					error: `Skill "${name}" not found.`,
					availableSkills: available,
					hint: 'Use tamias__load_skill with one of the available skill names above, or use the skill-manager skill to create a new one.',
				}
			}

			// Read live content from disk (may have been updated since cache)
			const skillFilePath = join(skill.sourceDir, 'SKILL.md')
			let content = skill.content
			if (existsSync(skillFilePath)) {
				try {
					content = readFileSync(skillFilePath, 'utf-8')
				} catch { /* fall back to cached content */ }
			}

			return {
				success: true,
				skillName: skill.name,
				description: skill.description,
				sourceDir: skill.sourceDir,
				content,
			}
		},
	}),
}
