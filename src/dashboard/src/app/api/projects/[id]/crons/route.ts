import { NextResponse } from 'next/server'
import { getProjectCrons, addProjectCron, updateProjectCron, removeProjectCron } from '../../../../../../../core/projects'

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
	const { id } = await context.params
	return NextResponse.json(getProjectCrons(id))
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const body = await req.json()

		if (!body.name || !body.schedule || !body.prompt) {
			return NextResponse.json({ error: 'Name, schedule, and prompt are required' }, { status: 400 })
		}

		const cron = addProjectCron(id, {
			name: body.name,
			schedule: body.schedule,
			type: body.type || 'ai',
			prompt: body.prompt,
			skills: body.skills,
			context: body.context,
			delivery: body.delivery,
			target: body.target || 'last',
		})

		return NextResponse.json(cron)
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const body = await req.json()

		if (!body.jobId) {
			return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
		}

		const { jobId, ...updates } = body
		const updated = updateProjectCron(id, jobId, updates)
		return NextResponse.json(updated)
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await context.params
		const { searchParams } = new URL(req.url)
		const jobId = searchParams.get('jobId')

		if (!jobId) {
			return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
		}

		removeProjectCron(id, jobId)
		return NextResponse.json({ success: true })
	} catch (error) {
		return NextResponse.json({ error: String(error) }, { status: 500 })
	}
}
