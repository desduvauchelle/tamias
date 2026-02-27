import { NextResponse } from 'next/server'
import { executeOperation } from '../../../../../core/adapters/dashboard'

// Ensure domain registrations are loaded
import '../../../../../core/domains/index'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const result = await executeOperation('agents.list', { enabledOnly: false })
		const body = result.body as { agents?: unknown[] }
		return NextResponse.json(body.agents ?? [], { status: result.status })
	} catch (error) {
		return NextResponse.json([], { status: 500 })
	}
}

export async function POST(req: Request) {
	try {
		const body = await req.json()
		const result = await executeOperation('agents.create', body)
		const agent = (result.body as { agent?: unknown }).agent
		return NextResponse.json(agent ?? result.body, { status: result.status === 200 ? 201 : result.status })
	} catch (error: unknown) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
	}
}
