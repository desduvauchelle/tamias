import { tool } from 'ai'
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getLoadedSkills, loadSkills, saveSkill, deleteSkill } from '../utils/skills.ts'

export const SKILLS_TOOL_NAME = 'skills'
export const SKILLS_TOOL_LABEL = '📚 Skills (load, save, list, delete custom AI skills)'

export const skillsTools = {
	load: tool({
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
					hint: 'Use skills__load with one of the available skill names above, or use the skill-manager skill to create a new one.',
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

	save: tool({
		description: 'Create or update a custom AI skill. Skills are Markdown files that live at ~/.tamias/skills/<folder>/SKILL.md and are injected into the system prompt. The `description` field is the ONLY thing the AI sees before deciding to read the full skill — write it as a trigger phrase: "Use this when the user asks to...". Use `tags` to categorise, `parent` (folder name) to mark a skill as a child step in a multi-step orchestrator sequence, and `model` to specify a preferred model (e.g. "xai/grok-3" for X/Twitter searches).',
		inputSchema: z.object({
			name: z.string().describe('Human-readable name of the skill, e.g. "React Expert"'),
			description: z.string().describe('Trigger phrase: when should the AI use this skill? e.g. "Use this when the user asks to research stocks or run investment analysis"'),
			content: z.string().describe('Detailed instructions / knowledge for this skill in Markdown format.'),
			tags: z.array(z.string()).optional().describe('Optional list of topic tags for filtering and grouping, e.g. ["investment", "research"]'),
			parent: z.string().optional().describe('Optional folder name of the parent/orchestrator skill this one belongs to, e.g. "investment-master-research". Makes it appear as a numbered child step under the parent in the UI.'),
			model: z.string().optional().describe('Optional preferred model for this skill, in "nickname/modelId" format, e.g. "xai/grok-3". The AI will use this model when spawning sub-agents for this skill.'),
		}),
		execute: async ({ name, description, content, tags, parent, model }: { name: string; description: string; content: string; tags?: string[]; parent?: string; model?: string }) => {
			try {
				await saveSkill(name, description, content, tags, parent, model)
				// Trigger a tool refresh since skills are injected into system prompt
				return { success: true, message: `Skill '${name}' saved successfully. It will be available in future sessions.` }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	list: tool({
		description: 'List all available custom and built-in skills, including their tags, parent relationships, and preferred models.',
		inputSchema: z.object({}),
		execute: async () => {
			await loadSkills()
			const skills = getLoadedSkills()
			return {
				skills: skills.map(s => ({
					name: s.name,
					description: s.description,
					folder: s.sourceDir.split('/').pop(),
					isBuiltIn: s.isBuiltIn,
					tags: s.tags ?? [],
					parent: s.parent ?? null,
					model: s.model ?? null,
				}))
			}
		},
	}),

	delete: tool({
		description: 'Delete a custom user skill by its folder name.',
		inputSchema: z.object({
			folder: z.string().describe('The folder name of the skill to delete (e.g. "react-expert")'),
		}),
		execute: async ({ folder }: { folder: string }) => {
			try {
				await deleteSkill(folder)
				return { success: true, message: `Skill folder '${folder}' deleted.` }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),
}
