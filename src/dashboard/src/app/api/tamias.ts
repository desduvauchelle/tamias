import { join } from 'path'
import { homedir } from 'os'
import { readFile, writeFile, mkdir } from 'fs/promises'

const TAMIAS_DIR = join(homedir(), '.tamias')
const CONFIG_PATH = join(TAMIAS_DIR, 'config.json')
const ENV_PATH = join(TAMIAS_DIR, '.env')
const CRONS_PATH = join(TAMIAS_DIR, 'cron.json')
const USER_SKILLS_DIR = join(TAMIAS_DIR, 'skills')
// Next.js runs from src/dashboard, so project root is ../../..
const BUILTIN_SKILLS_DIR = join(process.cwd(), '../../../src/skills')

export async function getTamiasConfig() {
	try {
		const content = await readFile(CONFIG_PATH, 'utf8')
		return JSON.parse(content)
	} catch {
		return { version: '1.0', connections: {}, bridges: { terminal: { enabled: true } } }
	}
}

export async function saveTamiasConfig(config: any) {
	await mkdir(TAMIAS_DIR, { recursive: true })
	await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

export async function getTamiasEnv() {
	const env: Record<string, string> = {}
	try {
		const content = await readFile(ENV_PATH, 'utf8')
		for (const line of content.split('\n')) {
			const clean = line.trim()
			if (!clean || clean.startsWith('#')) continue
			const eq = clean.indexOf('=')
			if (eq > 0) {
				const key = clean.slice(0, eq).trim()
				const val = clean.slice(eq + 1).trim()
				env[key] = val
			}
		}
	} catch { }
	return env
}

export async function setTamiasEnvVar(key: string, value: string) {
	const env = await getTamiasEnv()
	if (value) {
		env[key] = value
	} else {
		delete env[key]
	}

	const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`)
	await mkdir(TAMIAS_DIR, { recursive: true })
	await writeFile(ENV_PATH, lines.join('\n') + '\n', 'utf8')
}

export async function getTamiasCrons() {
	try {
		const content = await readFile(CRONS_PATH, 'utf8')
		return JSON.parse(content)
	} catch {
		return []
	}
}

export async function saveTamiasCrons(crons: any[]) {
	await mkdir(TAMIAS_DIR, { recursive: true })
	await writeFile(CRONS_PATH, JSON.stringify(crons, null, 2), 'utf8')
}

export async function getTamiasSkills() {
	const skills: any[] = []

	const loadFromDir = async (dirPath: string, isBuiltIn: boolean) => {
		try {
			const { readdir, readFile } = await import('fs/promises')
			const entries = await readdir(dirPath, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const skillDir = join(dirPath, entry.name)
					const skillFile = join(skillDir, 'SKILL.md')
					try {
						const rawContent = await readFile(skillFile, 'utf8')
						const { data, content } = (await import('gray-matter')).default(rawContent)

						const name = data.name || entry.name
						const description = data.description || 'No description provided.'

						skills.push({
							name,
							description,
							content: rawContent,
							isBuiltIn,
							folder: entry.name,
							filePath: skillFile
						})
					} catch (e) { /* skip */ }
				}
			}
		} catch (e) { /* skip */ }
	}

	await loadFromDir(BUILTIN_SKILLS_DIR, true)
	await loadFromDir(USER_SKILLS_DIR, false)
	return skills
}

export async function saveTamiasSkill(name: string, description: string, content: string) {
	const safeDirName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")
	const skillDir = join(USER_SKILLS_DIR, safeDirName)

	const { mkdir, writeFile } = await import('fs/promises')
	await mkdir(skillDir, { recursive: true })

	const { data, content: body } = (await import('gray-matter')).default(content)
	const matter = (await import('gray-matter')).default

	const finalContent = matter.stringify(body, {
		name,
		description
	})

	await writeFile(join(skillDir, 'SKILL.md'), finalContent, 'utf8')
}

export async function deleteTamiasSkill(folder: string) {
	const skillDir = join(USER_SKILLS_DIR, folder)
	if (skillDir.startsWith(USER_SKILLS_DIR)) {
		const { rm } = await import('fs/promises')
		try {
			await rm(skillDir, { recursive: true, force: true })
		} catch (e) { /* ignore */ }
	}
}
