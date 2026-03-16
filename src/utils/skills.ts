import { join, basename } from "path"
import { existsSync, readdirSync, promises as fsPromises, Dirent, statSync } from "fs"
import { homedir } from "os"

export interface Skill {
	name: string
	description: string
	sourceDir: string
	content: string
	isBuiltIn: boolean
	tags?: string[]
	parent?: string
	/** Optional preferred model override, e.g. "xai/grok-3" */
	model?: string
	/** If set, this skill belongs to a specific project */
	projectId?: string
}

const BUILTIN_SKILLS_DIR = join(import.meta.dir, "../../src/skills")
export const USER_SKILLS_DIR = join(homedir(), ".tamias", "skills")
const PROJECTS_DIR = join(homedir(), ".tamias", "projects")

let cachedSkills: Skill[] = []

/** Retrieves the list of currently loaded skills. */
export function getLoadedSkills(): Skill[] {
	return cachedSkills
}

/** Get skills available for a specific project (global + project-local) */
export function getSkillsForProject(projectId: string): Skill[] {
	const globalSkills = cachedSkills.filter(s => !s.projectId)
	const projectSkills = cachedSkills.filter(s => s.projectId === projectId)

	// Project skills override globals with the same name
	const result = [...globalSkills]
	for (const ps of projectSkills) {
		const idx = result.findIndex(s => s.name.toLowerCase() === ps.name.toLowerCase())
		if (idx >= 0) {
			result[idx] = ps
		} else {
			result.push(ps)
		}
	}
	return result
}

/**
 * Scans directories and loads skills into memory.
 */
export async function loadSkills(): Promise<void> {
	const loaded: Skill[] = []

	if (!existsSync(USER_SKILLS_DIR)) {
		await fsPromises.mkdir(USER_SKILLS_DIR, { recursive: true })
	}

	// Helper to load skills from a given directory
	const loadFromDir = async (dirPath: string, isBuiltIn: boolean, projectId?: string) => {
		if (!existsSync(dirPath)) return
		try {
			const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const skillDir = join(dirPath, entry.name)
					const skillFile = join(skillDir, "SKILL.md")
					if (existsSync(skillFile)) {
						const content = await fsPromises.readFile(skillFile, "utf-8")
						const parsed = parseSkillMetadata(content, entry.name)
						loaded.push({
							name: parsed.name,
							description: parsed.description,
							sourceDir: skillDir,
							content,
							isBuiltIn,
							tags: parsed.tags,
							parent: parsed.parent,
							model: parsed.model,
							projectId,
						})
					}
				}
			}
		} catch (err) {
			console.error(`Failed to load skills from ${dirPath}:`, err)
		}
	}

	await loadFromDir(BUILTIN_SKILLS_DIR, true)
	await loadFromDir(USER_SKILLS_DIR, false)

	// Load per-project skills
	if (existsSync(PROJECTS_DIR)) {
		try {
			const projectEntries = await fsPromises.readdir(PROJECTS_DIR, { withFileTypes: true })
			for (const entry of projectEntries) {
				if (!entry.isDirectory()) continue
				const projectSkillsDir = join(PROJECTS_DIR, entry.name, 'skills')
				if (existsSync(projectSkillsDir)) {
					await loadFromDir(projectSkillsDir, false, entry.name)
				}
			}
		} catch {
			// Ignore errors scanning projects
		}
	}

	cachedSkills = loaded
}

/** Parses the simple YAML frontmatter to extract name, description, tags, parent and model */
function parseSkillMetadata(content: string, directoryName: string): { name: string, description: string, tags: string[], parent?: string, model?: string } {
	let name = directoryName
	let description = "No description provided."
	let tags: string[] = []
	let parent: string | undefined = undefined
	let model: string | undefined = undefined

	if (content.startsWith("---")) {
		const endMatch = content.indexOf("---", 3)
		if (endMatch !== -1) {
			const frontmatter = content.substring(3, endMatch).trim()
			const lines = frontmatter.split("\n")
			let inTagsBlock = false
			// Track whether we're collecting a YAML block-scalar description (>- / > / | / |- etc.)
			let inBlockDescription = false
			const blockDescriptionLines: string[] = []

			for (const line of lines) {
				// If in a block-scalar description, collect indented continuation lines.
				if (inBlockDescription) {
					if (line.startsWith(" ") || line.startsWith("\t")) {
						blockDescriptionLines.push(line.trim())
						continue
					} else {
						// Non-indented line ends the block; join collected lines.
						description = blockDescriptionLines.join(" ").trim() || "No description provided."
						inBlockDescription = false
						blockDescriptionLines.length = 0
						// Fall through to process this line as a new key.
					}
				}

				if (line.trim().startsWith("name:")) {
					inTagsBlock = false
					name = line.replace("name:", "").trim()
					if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1)
				} else if (line.trim().startsWith("description:")) {
					inTagsBlock = false
					const raw = line.replace("description:", "").trim()
					const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
					// Detect YAML block-scalar indicators (>- > | |- |+ >+)
					if (/^[>|][+-]?$/.test(unquoted)) {
						// Start collecting the following indented lines
						inBlockDescription = true
						blockDescriptionLines.length = 0
					} else {
						description = unquoted
					}
				} else if (line.trim().startsWith("model:")) {
					inTagsBlock = false
					model = line.replace("model:", "").trim()
					if (model.startsWith('"') && model.endsWith('"')) model = model.slice(1, -1)
				} else if (line.trim().startsWith("parent:")) {
					inTagsBlock = false
					parent = line.replace("parent:", "").trim()
					if (parent.startsWith('"') && parent.endsWith('"')) parent = parent.slice(1, -1)
				} else if (line.trim().startsWith("tags:")) {
					// Inline array: tags: [foo, bar]  OR start of block list
					const raw = line.replace("tags:", "").trim()
					if (raw.startsWith("[")) {
						tags = raw.slice(1, raw.lastIndexOf("]")).split(",").map(t => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
						inTagsBlock = false
					} else {
						inTagsBlock = true
					}
				} else if (inTagsBlock && line.trim().startsWith("- ")) {
					const tag = line.trim().slice(2).trim().replace(/^["']|["']$/g, "")
					if (tag) tags.push(tag)
				} else if (inTagsBlock && line.trim() !== "") {
					inTagsBlock = false
				}
			}

			// Flush any remaining block-scalar lines at end of frontmatter
			if (inBlockDescription && blockDescriptionLines.length > 0) {
				description = blockDescriptionLines.join(" ").trim()
			}
		}
	}

	return { name, description, tags, parent, model }
}

export async function watchSkills(): Promise<void> {
	// Initial load
	await loadSkills()

	const handleWatch = async (eventType: string, filename: string | null) => {
		if (filename && (filename.endsWith("SKILL.md") || !filename.includes("."))) {
			await loadSkills()
		}
	}

	try {
		if (existsSync(BUILTIN_SKILLS_DIR)) {
			import("fs").then(fs => fs.watch(BUILTIN_SKILLS_DIR, { recursive: true }, handleWatch))
		}
	} catch (e) { console.warn(`[skills] Failed to watch built-in skills directory '${BUILTIN_SKILLS_DIR}':`, e) }

	try {
		if (existsSync(USER_SKILLS_DIR)) {
			import("fs").then(fs => fs.watch(USER_SKILLS_DIR, { recursive: true }, handleWatch))
		}
	} catch (e) { console.warn(`[skills] Failed to watch user skills directory '${USER_SKILLS_DIR}':`, e) }
}

/** Create or update a user skill */
export async function saveSkill(name: string, description: string, content: string, tags?: string[], parent?: string, model?: string): Promise<void> {
	// ensure directory format (lowercase-no-space-no-weird-characters)
	const safeDirName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")
	const skillDir = join(USER_SKILLS_DIR, safeDirName)

	if (!existsSync(skillDir)) {
		await fsPromises.mkdir(skillDir, { recursive: true })
	}

	const skillFile = join(skillDir, "SKILL.md")

	// Build frontmatter
	const frontmatterLines = [`name: "${name}"`, `description: "${description}"`]
	if (model) {
		frontmatterLines.push(`model: "${model}"`)
	}
	if (tags && tags.length > 0) {
		frontmatterLines.push(`tags: [${tags.map(t => `"${t}"`).join(', ')}]`)
	}
	if (parent) {
		frontmatterLines.push(`parent: "${parent}"`)
	}

	let finalContent = content
	if (!content.startsWith("---")) {
		finalContent = `---\n${frontmatterLines.join('\n')}\n---\n\n${content}`
	}

	await fsPromises.writeFile(skillFile, finalContent, "utf-8")
	await loadSkills() // refresh cache
}

/** Delete a user skill */
export async function deleteSkill(safeDirName: string): Promise<void> {
	const skillDir = join(USER_SKILLS_DIR, safeDirName)
	// Verify it's actually in our user skills directory
	if (skillDir.startsWith(USER_SKILLS_DIR) && existsSync(skillDir)) {
		await fsPromises.rm(skillDir, { recursive: true, force: true })
		await loadSkills() // refresh cache
	}
}
