import { join, basename } from "path"
import { existsSync, readdirSync, promises as fsPromises, Dirent, statSync } from "fs"
import { homedir } from "os"

export interface Skill {
	name: string
	description: string
	sourceDir: string
	content: string
	isBuiltIn: boolean
}

const BUILTIN_SKILLS_DIR = join(import.meta.dir, "../../src/skills")
export const USER_SKILLS_DIR = join(homedir(), ".tamias", "skills")

let cachedSkills: Skill[] = []

/** Retrieves the list of currently loaded skills. */
export function getLoadedSkills(): Skill[] {
	return cachedSkills
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
	const loadFromDir = async (dirPath: string, isBuiltIn: boolean) => {
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
							isBuiltIn
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

	cachedSkills = loaded
}

/** Parses the simple YAML frontmatter to extract name and description */
function parseSkillMetadata(content: string, directoryName: string): { name: string, description: string } {
	let name = directoryName
	let description = "No description provided."

	if (content.startsWith("---")) {
		const endMatch = content.indexOf("---", 3)
		if (endMatch !== -1) {
			const frontmatter = content.substring(3, endMatch).trim()
			const lines = frontmatter.split("\n")
			for (const line of lines) {
				if (line.trim().startsWith("name:")) {
					name = line.replace("name:", "").trim()
					if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1)
				} else if (line.trim().startsWith("description:")) {
					// simple handling for single line description, ignoring complex YAML multiline for now
					description = line.replace("description:", "").trim()
					if (description.startsWith('"') && description.endsWith('"')) description = description.slice(1, -1)
				}
			}
		}
	}

	return { name, description }
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
export async function saveSkill(name: string, description: string, content: string): Promise<void> {
	// ensure directory format (lowercase-no-space-no-weird-characters)
	const safeDirName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")
	const skillDir = join(USER_SKILLS_DIR, safeDirName)

	if (!existsSync(skillDir)) {
		await fsPromises.mkdir(skillDir, { recursive: true })
	}

	const skillFile = join(skillDir, "SKILL.md")

	// Create content with frontmatter if the user didn't include it
	let finalContent = content
	if (!content.startsWith("---")) {
		finalContent = `---\nname: "${name}"\ndescription: "${description}"\n---\n\n${content}`
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
