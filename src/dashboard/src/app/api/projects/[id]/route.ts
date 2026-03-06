import { NextResponse } from 'next/server'
import { getProject, updateProject, deleteProject } from '../../../../../../core/projects'

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
	const { id } = await context.params
	const project = getProject(id)
	if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	return NextResponse.json(project)
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const body = await req.json()
		const oldProject = getProject(id)
		const oldKanban = oldProject?.kanban || []

		const updated = updateProject(id, body)

		if (body.kanban) {
			try {
				const { join } = await import('path')
				const { homedir } = await import('os')
				const { readFile } = await import('fs/promises')
				const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')
				const str = await readFile(DAEMON_FILE, 'utf-8')
				const info = JSON.parse(str)
				if (info.port) {
					fetch(`http://127.0.0.1:${info.port}/project-event`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ type: 'kanban_changed', projectId: id, oldKanban, newKanban: body.kanban })
					}).catch(e => console.error("Daemon IPC Error:", e))
				}
			} catch (e) {
				// Ignore if daemon is not running
			}
		}

		return NextResponse.json(updated)
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		deleteProject(id)
		return NextResponse.json({ success: true })
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}
