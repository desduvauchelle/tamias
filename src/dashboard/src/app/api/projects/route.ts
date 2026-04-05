import { NextResponse } from 'next/server'
import { getProjects, addProject, slugifyProject } from '../../../../../core/projects'

export async function GET() {
	try {
		const projects = getProjects()
		return NextResponse.json(Object.values(projects))
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}

export async function POST(req: Request) {
	try {
		const body = await req.json()
		if (!body.name) {
			return NextResponse.json({ error: 'Name is required' }, { status: 400 })
		}

		// Derive slug from path or name
		const slug = body.path ? slugifyProject(body.path) : slugifyProject(body.name)

		// Reject if the slug is already registered to another project
		const existing = getProjects()
		const duplicate = Object.values(existing).find(p => p.id === slug)
		if (duplicate) {
			return NextResponse.json(
				{ error: `Folder "${slug}" is already used by project "${duplicate.name}"` },
				{ status: 409 }
			)
		}

		const newProject = addProject({
			name: body.name,
			description: body.description,
			path: slug,
			discordServerId: body.discordServerId,
			discordChannelId: body.discordChannelId,
		})
		return NextResponse.json(newProject)
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}
