import { NextResponse } from 'next/server'
import { getTamiasAgents, saveTamiasAgents } from '../../tamias'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await params
		const updates = await req.json()
		const agents = await getTamiasAgents()
		const index = agents.findIndex(a => a.id === id)

		if (index === -1) {
			return NextResponse.json({ error: `Agent ${id} not found` }, { status: 404 })
		}

		// Don't allow changing id
		delete updates.id

		agents[index] = { ...agents[index], ...updates }
		await saveTamiasAgents(agents)

		return NextResponse.json(agents[index])
	} catch (error: unknown) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
	}
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const { id } = await params
		const agents = await getTamiasAgents()
		const filtered = agents.filter(a => a.id !== id)

		if (agents.length === filtered.length) {
			return NextResponse.json({ error: `Agent ${id} not found` }, { status: 404 })
		}

		await saveTamiasAgents(filtered)
		return NextResponse.json({ success: true })
	} catch (error: unknown) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
	}
}
