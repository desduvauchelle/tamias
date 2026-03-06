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
		const updated = updateProject(id, body)
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
