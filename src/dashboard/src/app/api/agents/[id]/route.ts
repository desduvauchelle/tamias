import { NextResponse } from 'next/server'
import { executeOperation } from '../../../../../../core/adapters/dashboard'

// Ensure domain registrations are loaded
import '../../../../../../core/domains/index'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await params
		const updates = await req.json()
		const result = await executeOperation('agents.update', { id, ...updates })
		const agent = (result.body as { agent?: unknown }).agent
		return NextResponse.json(agent ?? result.body, { status: result.status })
	} catch (error: unknown) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
	}
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await params
		const result = await executeOperation('agents.remove', { id })
		return NextResponse.json(result.body, { status: result.status })
	} catch (error: unknown) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
	}
}
