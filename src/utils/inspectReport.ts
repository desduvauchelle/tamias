import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { buildSystemPrompt } from './memory.ts'
import {
	loadConfig,
	getAllMcpServers,
	getInternalToolConfig,
	getBridgesConfig,
	getDefaultModel,
	getSmartModels,
	TAMIAS_DIR,
} from './config.ts'
import { estimateTokens } from './tokenBudget.ts'
import { getAllInternalToolNames } from '../tools/internalToolNames.ts'
import type { Session } from '../services/aiService.ts'

// ─── Zod parameter introspection ─────────────────────────────────────────────

function zodTypeName(field: any): string {
	const def = field?.def ?? field?._def ?? {}
	const type = def.type ?? field?.type ?? 'unknown'
	if (type === 'optional') return zodTypeName(def.innerType) + '?'
	if (type === 'array') return `${zodTypeName(def.element)}[]`
	if (type === 'enum') return (def.entries ? Object.keys(def.entries) : def.values ?? []).map((v: string) => `"${v}"`).join(' | ')
	return String(type)
}

function zodDescription(field: any): string {
	const outerDesc = field?.meta?.()?.description
	if (outerDesc) return outerDesc
	const def = field?.def ?? field?._def ?? {}
	if (def.type === 'optional') {
		return def.innerType?.meta?.()?.description ?? ''
	}
	return ''
}

function renderParams(inputSchema: any): string {
	if (!inputSchema) return ''
	const shape = inputSchema._def?.shape ?? inputSchema.def?.shape ?? {}
	const lines: string[] = []
	for (const [name, field] of Object.entries(shape)) {
		const type = zodTypeName(field)
		const desc = zodDescription(field)
		lines.push(`  - \`${name}\` (${type})${desc ? ` — ${desc}` : ''}`)
	}
	return lines.join('\n')
}

// ─── Static tool catalog ─────────────────────────────────────────────────────

async function buildStaticToolCatalog(): Promise<Map<string, { description: string; paramsMd: string }>> {
	const catalog = new Map<string, { description: string; paramsMd: string }>()

	const stubService = {
		getSession: () => undefined,
		getAllSessions: () => [],
		emit: () => {},
	} as any

	const [
		{ terminalTools },
		{ createTamiasTools },
		{ createCronTools },
		{ emailTools },
		{ githubTools },
		{ createWorkspaceTools },
		{ geminiTools },
		{ createSubagentTools },
		{ createImageTools },
		{ createBrowserTools },
		{ createPdfTools },
		{ memoryTools },
		{ createSwarmTools },
		{ createSessionTools },
		{ skillsTools },
		{ createWebsearchTools },
		projectsModule,
	] = await Promise.all([
		import('../tools/terminal.ts'),
		import('../tools/tamias.ts'),
		import('../tools/cron.ts'),
		import('../tools/email.ts'),
		import('../tools/github.ts'),
		import('../tools/workspace.ts'),
		import('../tools/gemini.ts'),
		import('../tools/subagent.ts'),
		import('../tools/image.ts'),
		import('../tools/browser.ts'),
		import('../tools/pdf.ts'),
		import('../tools/memory.ts'),
		import('../tools/swarm.ts'),
		import('../tools/session.ts'),
		import('../tools/skills.ts'),
		import('../tools/websearch.ts'),
		import('../tools/projects.ts'),
	])

	const factories: Record<string, () => Record<string, any>> = {
		terminal: () => terminalTools as any,
		tamias: () => createTamiasTools(stubService, 'inspect'),
		cron: () => createCronTools(stubService, 'inspect'),
		email: () => emailTools as any,
		github: () => githubTools as any,
		workspace: () => createWorkspaceTools(undefined),
		gemini: () => geminiTools as any,
		subagent: () => createSubagentTools(stubService, 'inspect'),
		image: () => createImageTools(stubService, 'inspect', undefined),
		browser: () => createBrowserTools(stubService, 'inspect'),
		pdf: () => createPdfTools(stubService, 'inspect'),
		memory: () => memoryTools as any,
		swarm: () => createSwarmTools(stubService, 'inspect'),
		session: () => createSessionTools(stubService, 'inspect'),
		skills: () => skillsTools as any,
		websearch: () => createWebsearchTools(stubService, 'inspect'),
		projects: () => projectsModule as any,
	}

	for (const [ns, buildToolSet] of Object.entries(factories)) {
		const cfg = getInternalToolConfig(ns)
		if (!cfg.enabled) continue
		let toolSet: Record<string, any>
		try {
			toolSet = buildToolSet()
		} catch {
			continue // skip this namespace if factory fails
		}
		for (const [fnName, t] of Object.entries(toolSet)) {
			if (typeof (t as any)?.execute !== 'function') continue
			const fullName = `${ns}__${fnName}`
			const description = (t as any).description ?? ''
			const paramsMd = renderParams((t as any).inputSchema)
			catalog.set(fullName, { description, paramsMd })
		}
	}

	return catalog
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildMetadataSection(session?: Session): string {
	const now = new Date()
	const lines: string[] = ['## 1. Session Metadata', '']

	if (session) {
		lines.push(`- **Session ID:** \`${session.id}\``)
		lines.push(`- **Channel:** \`${session.channelId}\``)
		if (session.channelName) lines.push(`- **Channel Name:** ${session.channelName}`)
		lines.push(`- **Model:** ${session.model}`)
		if (session.modelTier) lines.push(`- **Model Tier:** ${session.modelTier}`)
		lines.push(`- **Workspace:** \`${session.workspacePath}\``)
		if (session.agentId) lines.push(`- **Named Agent:** ${session.agentId}`)
		if (session.projectSlug) lines.push(`- **Project:** ${session.projectSlug}`)
	} else {
		lines.push('- **Channel:** terminal (synthetic — CLI mode)')
		lines.push(`- **Default Model:** ${getDefaultModel() ?? '(not set)'}`)
		const smartModels = getSmartModels()
		if (smartModels.length > 0) lines.push(`- **Smart Models:** ${smartModels.join(', ')}`)
	}

	lines.push(`- **Generated:** ${now.toISOString()}`)
	return lines.join('\n')
}

function buildConfigSection(): string {
	const bridges = getBridgesConfig()
	const mcpServers = getAllMcpServers()
	const allToolNames = getAllInternalToolNames()

	const lines: string[] = ['## 2. Configuration Snapshot', '']

	lines.push('### Bridges', '')
	lines.push(`- terminal: ${bridges.terminal?.enabled !== false ? '**enabled**' : 'disabled'}`)
	const discords = bridges.discords ?? {}
	for (const [key, dc] of Object.entries(discords)) {
		lines.push(`- discord/${key}: ${dc.enabled ? '**enabled**' : 'disabled'}`)
	}
	const telegrams = bridges.telegrams ?? {}
	for (const [key, tg] of Object.entries(telegrams)) {
		lines.push(`- telegram/${key}: ${tg.enabled ? '**enabled**' : 'disabled'}`)
	}
	const waUnofficial = bridges.whatsappUnofficials ?? {}
	for (const [key, wa] of Object.entries(waUnofficial)) {
		lines.push(`- whatsapp-unofficial/${key}: ${wa.enabled ? '**enabled**' : 'disabled'}`)
	}

	lines.push('', '### MCP Servers', '')
	if (mcpServers.length === 0) {
		lines.push('_(none configured)_')
	} else {
		for (const mcp of mcpServers) {
			lines.push(`- **${mcp.name}** (${mcp.transport}): ${mcp.enabled ? '**enabled**' : 'disabled'}${mcp.label ? ` — ${mcp.label}` : ''}`)
		}
	}

	lines.push('', '### Internal Tool Namespaces', '')
	for (const name of allToolNames) {
		const cfg = getInternalToolConfig(name)
		lines.push(`- **${name}**: ${cfg.enabled ? '**enabled**' : 'disabled'}`)
	}

	lines.push('', '### Models', '')
	lines.push(`- Default: ${getDefaultModel() ?? '(not set)'}`)
	const smartModels = getSmartModels()
	if (smartModels.length > 0) lines.push(`- Smart: ${smartModels.join(', ')}`)

	return lines.join('\n')
}

function buildSystemPromptSection(session?: Session): string {
	const lines: string[] = ['## 3. System Prompt', '']

	try {
		const config = loadConfig()
		const contextWindow = session
			? (config.connections[session.connectionNickname]?.contextWindow ?? 128000)
			: 128000

		const channelCtx = session
			? { id: session.channelId, userId: session.channelUserId, name: session.channelName, isSubagent: session.isSubagent }
			: { id: 'terminal:inspect', name: 'inspect' }

		const prompt = buildSystemPrompt(
			session?.summary,
			channelCtx,
			session?.agentDir,
			{ modelContextWindow: contextWindow, sessionWorkspacePath: session?.workspacePath },
		)

		const tokenCount = estimateTokens(prompt)
		lines.push(`> **Estimated tokens:** ~${tokenCount.toLocaleString()} / ${contextWindow.toLocaleString()}`, '')
		lines.push(prompt)
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err)
		lines.push(`> [error rendering system prompt: ${message}]`)
	}

	return lines.join('\n')
}

async function buildToolsSection(
	liveCatalog?: Map<string, { description: string; paramsMd: string }>,
): Promise<string> {
	const lines: string[] = ['## 4. Available Tools', '']

	const catalog = liveCatalog ?? await buildStaticToolCatalog()

	const byNs = new Map<string, Array<[string, { description: string; paramsMd: string }]>>()
	for (const [fullName, info] of catalog) {
		const ns = fullName.includes('__') ? fullName.slice(0, fullName.indexOf('__')) : fullName
		if (!byNs.has(ns)) byNs.set(ns, [])
		byNs.get(ns)!.push([fullName, info])
	}

	for (const [ns, tools] of byNs) {
		lines.push(`### internal:${ns} (${tools.length} function${tools.length === 1 ? '' : 's'})`, '')
		for (const [fullName, { description, paramsMd }] of tools) {
			const fnName = fullName.includes('__') ? fullName.slice(fullName.indexOf('__') + 2) : fullName
			lines.push(`#### ${fnName}`)
			if (description) lines.push(`> ${description}`)
			if (paramsMd) lines.push(paramsMd)
			lines.push('')
		}
	}

	return lines.join('\n')
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateInspectReport(
	session?: Session,
	liveCatalog?: Map<string, { description: string; paramsMd: string }>,
): Promise<string> {
	const now = new Date()
	const sessionId = session?.id ?? 'cli'
	const channel = session?.channelId ?? 'terminal'

	const header = [
		'# Tamias Context Inspection Report',
		'',
		`Generated: ${now.toISOString()} | Session: ${sessionId} | Channel: ${channel}`,
		'',
		'---',
		'',
	].join('\n')

	const [metaSection, configSection, promptSection, toolsSection] = await Promise.all([
		Promise.resolve(buildMetadataSection(session)),
		Promise.resolve(buildConfigSection()),
		Promise.resolve(buildSystemPromptSection(session)),
		buildToolsSection(liveCatalog),
	])

	return [header, metaSection, '', configSection, '', promptSection, '', toolsSection].join('\n')
}

export function writeInspectReport(content: string, dir: string = TAMIAS_DIR): string {
	const now = new Date()
	const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const fileName = `inspect-${stamp}.md`
	const filePath = join(dir, fileName)
	mkdirSync(dir, { recursive: true })
	writeFileSync(filePath, content, 'utf-8')
	return filePath
}
