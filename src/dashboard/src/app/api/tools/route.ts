import { NextResponse } from 'next/server'
import { getTamiasConfig, saveTamiasConfig } from '../tamias'
import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

type AvailableToolDetails = {
	label: string
	functions: string[]
}

async function getAvailableToolsDetails(): Promise<Record<string, AvailableToolDetails>> {
	const candidates = [
		join(process.cwd(), 'src', 'tools'),
		join(process.cwd(), '..', 'tools'),
		join(process.cwd(), '..', '..', 'src', 'tools'),
	]

	const toolsDir = candidates.find(p => existsSync(p))
	if (!toolsDir) return {}

	const details: Record<string, AvailableToolDetails> = {}
	const files = (await readdir(toolsDir)).filter(name => name.endsWith('.ts'))

	for (const fileName of files) {
		const content = await readFile(join(toolsDir, fileName), 'utf-8')
		const nameMatch = content.match(/export const [A-Z_]+_TOOL_NAME = ['\"]([^'\"]+)['\"]/)
		const labelMatch = content.match(/export const [A-Z_]+_TOOL_LABEL = ['\"]([^'\"]+)['\"]/)

		if (!nameMatch || !labelMatch) continue

		const toolName = nameMatch[1]
		const toolLabel = labelMatch[1]
		const functionMatches = content.matchAll(/([a-zA-Z0-9_]+):\s*tool\(/g)
		const functions = Array.from(new Set(Array.from(functionMatches).map(match => match[1]))).sort()

		details[toolName] = { label: toolLabel, functions }
	}

	return details
}

export async function GET() {
	try {
		const config = await getTamiasConfig()
		const availableToolsDetails = await getAvailableToolsDetails()
		const availableInternalTools = Object.fromEntries(
			Object.entries(availableToolsDetails).map(([toolName, details]) => [toolName, details.label]),
		)
		const availableFunctions = Object.fromEntries(
			Object.entries(availableToolsDetails).map(([toolName, details]) => [toolName, details.functions]),
		)

		return NextResponse.json({
			internalTools: config.internalTools || {},
			mcpServers: config.mcpServers || {},
			emails: config.emails || {},
			defaultImageModels: config.defaultImageModels || [],
			availableInternalTools,
			availableFunctions,
			availableToolsDetails,
		})
	} catch (error) {
		return NextResponse.json({
			internalTools: {},
			mcpServers: {},
			emails: {},
			defaultImageModels: [],
			availableInternalTools: {},
			availableFunctions: {},
			availableToolsDetails: {},
		})
	}
}

export async function POST(request: Request) {
	try {
		const { internalTools, mcpServers, emails, defaultImageModels } = await request.json()
		const config = await getTamiasConfig()

		if (internalTools) config.internalTools = internalTools
		if (mcpServers) config.mcpServers = mcpServers
		if (emails) config.emails = emails
		if (defaultImageModels !== undefined) config.defaultImageModels = defaultImageModels

		await saveTamiasConfig(config)
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error(error)
		return NextResponse.json({ error: 'Failed to update tools configuration' }, { status: 500 })
	}
}
