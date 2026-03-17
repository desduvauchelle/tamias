import { NextResponse } from 'next/server'
import { getProjectAgents, addProjectAgent, removeProjectAgent } from '../../../../../../../core/projects'

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
	const { id } = await context.params
	return NextResponse.json(getProjectAgents(id))
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const body = await req.json()

		if (!body.name || !body.instructions) {
			return NextResponse.json({ error: 'Name and instructions are required' }, { status: 400 })
		}

		const agent = addProjectAgent(id, {
			slug: body.slug || '',
			name: body.name,
			instructions: body.instructions,
			model: body.model,
			modelFallbacks: body.modelFallbacks,
			channels: body.channels,
			extraSkills: body.extraSkills,
			allowedTools: body.allowedTools,
			allowedMcpServers: body.allowedMcpServers,
		})

		return NextResponse.json(agent)
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const { searchParams } = new URL(req.url)
		const slug = searchParams.get('slug')

		if (!slug) {
			return NextResponse.json({ error: 'Agent slug is required' }, { status: 400 })
		}

		removeProjectAgent(id, slug)
		return NextResponse.json({ success: true })
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}
