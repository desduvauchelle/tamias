import { NextResponse } from 'next/server'
import { getProjects, addProject } from '../../../../../core/projects'

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
		if (!body.name || !body.path) {
			return NextResponse.json({ error: 'Name and path are required' }, { status: 400 })
		}

		// Reject if the path is already registered to another project
		const existing = getProjects()
		const duplicate = Object.values(existing).find(p => p.path === body.path)
		if (duplicate) {
			return NextResponse.json(
				{ error: `Path "${body.path}" is already used by project "${duplicate.name}"` },
				{ status: 409 }
			)
		}

		const newProject = addProject({
			name: body.name,
			description: body.description,
			path: body.path,
			discordServerId: body.discordServerId,
			discordChannelId: body.discordChannelId,
			contextFile: body.contextFile
		})
		return NextResponse.json(newProject)
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}
