import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { getProjectDirectory } from '../../../../../../../core/projects'

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
	const { id } = await context.params
	const skillsDir = join(getProjectDirectory(id), 'skills')

	if (!existsSync(skillsDir)) {
		return NextResponse.json([])
	}

	const skills: { name: string; description: string; content: string }[] = []
	try {
		const entries = readdirSync(skillsDir, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			const skillFile = join(skillsDir, entry.name, 'SKILL.md')
			if (!existsSync(skillFile)) continue
			const content = readFileSync(skillFile, 'utf-8')
			// Extract description from frontmatter
			let description = ''
			if (content.startsWith('---')) {
				const endIdx = content.indexOf('---', 3)
				if (endIdx !== -1) {
					const frontmatter = content.substring(3, endIdx)
					const descMatch = frontmatter.match(/description:\s*"?([^"\n]+)"?/)
					if (descMatch) description = descMatch[1].trim()
				}
			}
			skills.push({ name: entry.name, description, content })
		}
	} catch {
		// Ignore read errors
	}

	return NextResponse.json(skills)
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const body = await req.json()

		if (!body.name || !body.content) {
			return NextResponse.json({ error: 'Name and content are required' }, { status: 400 })
		}

		const safeName = body.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
		const skillDir = join(getProjectDirectory(id), 'skills', safeName)
		mkdirSync(skillDir, { recursive: true })

		writeFileSync(join(skillDir, 'SKILL.md'), body.content, 'utf-8')

		return NextResponse.json({ success: true, name: safeName })
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const { searchParams } = new URL(req.url)
		const skillName = searchParams.get('name')

		if (!skillName) {
			return NextResponse.json({ error: 'Skill name is required' }, { status: 400 })
		}

		const safeName = skillName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
		const skillDir = join(getProjectDirectory(id), 'skills', safeName)

		// Verify it's within the project skills directory
		const projectSkillsDir = join(getProjectDirectory(id), 'skills')
		if (!skillDir.startsWith(projectSkillsDir) || !existsSync(skillDir)) {
			return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
		}

		rmSync(skillDir, { recursive: true, force: true })
		return NextResponse.json({ success: true })
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}
