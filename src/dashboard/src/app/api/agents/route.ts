import { NextResponse } from 'next/server'
import { getTamiasAgents, saveTamiasAgents, scaffoldAgentDir, type AgentDefinition } from '../tamias'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const agents = await getTamiasAgents()
		return NextResponse.json(agents)
	} catch (error) {
		return NextResponse.json([], { status: 500 })
	}
}

export async function POST(req: Request) {
	try {
		const body = await req.json()
		const { name, slug, model, modelFallbacks, instructions, channels, extraSkills, allowedTools, allowedMcpServers } = body

		if (!name || !instructions) {
			return NextResponse.json({ error: 'Name and instructions are required' }, { status: 400 })
		}

		const agents = await getTamiasAgents()
		const derivedSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

		// Check for duplicate slug
		if (agents.some(a => a.slug === derivedSlug)) {
			return NextResponse.json({ error: `An agent with slug "${derivedSlug}" already exists` }, { status: 409 })
		}

		const newAgent: AgentDefinition = {
			id: `agent_${Math.random().toString(36).slice(2, 6)}`,
			slug: derivedSlug,
			name,
			model: model || undefined,
			modelFallbacks: modelFallbacks?.length ? modelFallbacks : undefined,
			instructions,
			enabled: true,
			channels: channels?.length ? channels : undefined,
			extraSkills: extraSkills?.length ? extraSkills : undefined,
			allowedTools: allowedTools?.length ? allowedTools : undefined,
			allowedMcpServers: allowedMcpServers?.length ? allowedMcpServers : undefined,
		}

		agents.push(newAgent)
		await saveTamiasAgents(agents)
		await scaffoldAgentDir(derivedSlug)

		return NextResponse.json(newAgent, { status: 201 })
	} catch (error: unknown) {
		return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
	}
}
