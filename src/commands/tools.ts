import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	loadConfig,
	getInternalToolConfig,
	setInternalToolConfig,
	getAllMcpServers,
	setMcpServerConfig,
	deleteMcpServer,
	type McpServerConfig,
} from '../utils/config.ts'
import { TERMINAL_TOOL_NAME, TERMINAL_TOOL_LABEL } from '../tools/terminal.ts'
import { TAMIAS_TOOL_NAME, TAMIAS_TOOL_LABEL } from '../tools/tamias.ts'
import { CRON_TOOL_NAME, CRON_TOOL_LABEL } from '../tools/cron.ts'
import { EMAIL_TOOL_NAME, EMAIL_TOOL_LABEL } from '../tools/email.ts'
import { GITHUB_TOOL_NAME, GITHUB_TOOL_LABEL } from '../tools/github.ts'
import { WORKSPACE_TOOL_NAME, WORKSPACE_TOOL_LABEL } from '../tools/workspace.ts'
import { GEMINI_TOOL_NAME, GEMINI_TOOL_LABEL } from '../tools/gemini.ts'
import { SUBAGENT_TOOL_NAME, SUBAGENT_TOOL_LABEL } from '../tools/subagent.ts'

// ─── Known internal tools ─────────────────────────────────────────────────────

const INTERNAL_TOOLS: Record<string, string> = {
	[TERMINAL_TOOL_NAME]: TERMINAL_TOOL_LABEL,
	[TAMIAS_TOOL_NAME]: TAMIAS_TOOL_LABEL,
	[CRON_TOOL_NAME]: CRON_TOOL_LABEL,
	[EMAIL_TOOL_NAME]: EMAIL_TOOL_LABEL,
	[GITHUB_TOOL_NAME]: GITHUB_TOOL_LABEL,
	[WORKSPACE_TOOL_NAME]: WORKSPACE_TOOL_LABEL,
	[GEMINI_TOOL_NAME]: GEMINI_TOOL_LABEL,
	[SUBAGENT_TOOL_NAME]: SUBAGENT_TOOL_LABEL,
}

// ─── List ─────────────────────────────────────────────────────────────────────

export const runToolsListCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Tools ')))

	console.log(pc.bold('\n  Internal Tools:\n'))
	for (const [name, label] of Object.entries(INTERNAL_TOOLS)) {
		const cfg = getInternalToolConfig(name)
		const status = cfg.enabled ? pc.green('enabled') : pc.red('disabled')
		console.log(`  ${pc.bold(pc.cyan(name))}  [${status}]  ${pc.dim(label)}`)
		if (cfg.functions) {
			for (const [fn, fnCfg] of Object.entries(cfg.functions)) {
				const fnStatus = fnCfg.enabled ? pc.green('on') : pc.red('off')
				const allowlistInfo = fnCfg.allowlist?.length
					? pc.dim(` allowlist: [${fnCfg.allowlist.join(', ')}]`)
					: ''
				console.log(`     ${pc.dim('↳')} ${fn} [${fnStatus}]${allowlistInfo}`)
			}
		}
	}

	const mcpServers = getAllMcpServers()
	console.log(pc.bold('\n  External MCPs:\n'))
	if (mcpServers.length === 0) {
		console.log(pc.dim('  No external MCPs configured. Use `tamias tools add mcp` to add one.'))
	} else {
		for (const s of mcpServers) {
			const status = s.enabled ? pc.green('enabled') : pc.red('disabled')
			const transport = s.transport === 'stdio'
				? `stdio: ${s.command} ${(s.args ?? []).join(' ')}`
				: `http: ${s.url}`
			console.log(`  ${pc.bold(pc.cyan(s.name))}  [${status}]  ${pc.dim(transport)}`)
		}
	}

	console.log('')
	p.outro(pc.dim('Run `tamias tools edit <name>` to configure.'))
}

// ─── Add MCP ─────────────────────────────────────────────────────────────────

export const runToolsAddMcpCommand = async () => {
	p.intro(pc.bgCyan(pc.black(' Tamias — Add External MCP ')))

	const name = await p.text({
		message: 'Short name for this MCP (no spaces):',
		placeholder: 'gdrive',
		validate: (v) => { if (!v || /\s/.test(v)) return 'Required, no spaces' },
	})
	if (p.isCancel(name)) { p.cancel('Cancelled.'); process.exit(0) }

	const label = await p.text({
		message: 'Human-readable label (optional):',
		placeholder: 'Google Drive',
	})

	const transport = await p.select({
		message: 'Transport type:',
		options: [
			{ value: 'stdio', label: 'stdio  — spawn a local process (e.g. npx gdrive-mcp)' },
			{ value: 'http', label: 'http   — connect to a remote MCP URL' },
		],
	})
	if (p.isCancel(transport)) { p.cancel('Cancelled.'); process.exit(0) }

	let mcpConfig: McpServerConfig

	if (transport === 'stdio') {
		const command = await p.text({
			message: 'Command to run (e.g. npx):',
			placeholder: 'npx',
			validate: (v) => { if (!v) return 'Required' },
		})
		if (p.isCancel(command)) { p.cancel('Cancelled.'); process.exit(0) }

		const argsRaw = await p.text({
			message: 'Arguments (space-separated):',
			placeholder: '-y @some/mcp-server',
		})
		if (p.isCancel(argsRaw)) { p.cancel('Cancelled.'); process.exit(0) }

		const envRaw = await p.text({
			message: 'Env vars (KEY=VAL comma-separated, or leave blank):',
			placeholder: 'API_KEY=abc123,TOKEN=xyz',
		})
		if (p.isCancel(envRaw)) { p.cancel('Cancelled.'); process.exit(0) }

		const env: Record<string, string> = {}
		for (const pair of (envRaw as string).split(',').filter(Boolean)) {
			const [k, ...rest] = pair.split('=')
			if (k) env[k.trim()] = rest.join('=').trim()
		}

		mcpConfig = {
			enabled: true,
			label: label as string || undefined,
			transport: 'stdio',
			command: command as string,
			args: (argsRaw as string).split(' ').filter(Boolean),
			env: Object.keys(env).length ? env : undefined,
		}
	} else {
		const url = await p.text({
			message: 'MCP server URL:',
			placeholder: 'https://mcp.example.com/',
			validate: (v) => {
				if (!v) return 'Required'
				try { new URL(v); return undefined } catch { return 'Must be a valid URL' }
			},
		})
		if (p.isCancel(url)) { p.cancel('Cancelled.'); process.exit(0) }

		const headersRaw = await p.text({
			message: 'Request headers (KEY:VAL comma-separated, or leave blank):',
			placeholder: 'Authorization:Bearer abc',
		})
		if (p.isCancel(headersRaw)) { p.cancel('Cancelled.'); process.exit(0) }

		const headers: Record<string, string> = {}
		for (const pair of (headersRaw as string).split(',').filter(Boolean)) {
			const [k, ...rest] = pair.split(':')
			if (k) headers[k.trim()] = rest.join(':').trim()
		}

		mcpConfig = {
			enabled: true,
			label: label as string || undefined,
			transport: 'http',
			url: url as string,
			headers: Object.keys(headers).length ? headers : undefined,
		}
	}

	setMcpServerConfig(name as string, mcpConfig)
	p.outro(pc.green(`✅ MCP server '${name}' added. Run \`tamias tools list\` to verify.`))
}

// ─── Enable / Disable ────────────────────────────────────────────────────────

export const runToolsEnableCommand = async (name?: string) => {
	await toggleTool(name, true)
}

export const runToolsDisableCommand = async (name?: string) => {
	await toggleTool(name, false)
}

async function pickToolName(prompt: string): Promise<string | undefined> {
	const internal = Object.keys(INTERNAL_TOOLS)
	const mcps = getAllMcpServers().map((s) => s.name)
	const all = [...internal.map((n) => `internal:${n}`), ...mcps.map((n) => `mcp:${n}`)]
	if (all.length === 0) { p.cancel(pc.yellow('No tools configured.')); process.exit(0) }
	const chosen = await p.select({
		message: prompt,
		options: all.map((v) => ({ value: v, label: v })),
	})
	if (p.isCancel(chosen)) { p.cancel('Cancelled.'); process.exit(0) }
	return chosen as string
}

async function toggleTool(name: string | undefined, enabled: boolean) {
	const qualifier = name ?? await pickToolName(`Which tool to ${enabled ? 'enable' : 'disable'}?`)
	if (!qualifier) return

	if (qualifier?.startsWith('internal:') || INTERNAL_TOOLS[qualifier ?? '']) {
		const toolName = qualifier.replace('internal:', '')
		const cfg = getInternalToolConfig(toolName)
		setInternalToolConfig(toolName, { ...cfg, enabled })
		console.log(pc.green(`✅ internal:${toolName} is now ${enabled ? 'enabled' : 'disabled'}.`))
	} else {
		const serverName = qualifier.replace('mcp:', '')
		const cfg = getAllMcpServers().find((s) => s.name === serverName)
		if (!cfg) { console.error(pc.red(`MCP '${serverName}' not found.`)); process.exit(1) }
		setMcpServerConfig(serverName, { ...cfg, enabled })
		console.log(pc.green(`✅ mcp:${serverName} is now ${enabled ? 'enabled' : 'disabled'}.`))
	}
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

export const runToolsEditCommand = async (name?: string) => {
	p.intro(pc.bgYellow(pc.black(' Tamias — Edit Tool ')))

	const qualifier = name ?? await pickToolName('Which tool do you want to configure?')
	if (!qualifier) return

	const isInternal = (qualifier as string).startsWith('internal:') || INTERNAL_TOOLS[qualifier as string]
	const toolName = (qualifier as string).replace(/^(internal|mcp):/, '')

	if (isInternal) {
		await editInternalTool(toolName)
	} else {
		const mcpCfg = getAllMcpServers().find((s) => s.name === toolName)
		if (!mcpCfg) { p.cancel(pc.red(`MCP '${toolName}' not found.`)); process.exit(1) }
		await editMcpServer(toolName, mcpCfg)
	}
}

async function editInternalTool(toolName: string) {
	const cfg = getInternalToolConfig(toolName)

	const action = await p.select({
		message: `Editing internal tool: ${pc.bold(toolName)}`,
		options: [
			{ value: 'toggle', label: cfg.enabled ? '🔴 Disable entire tool' : '🟢 Enable entire tool' },
			{ value: 'functions', label: '⚙️  Configure individual functions' },
		],
	})
	if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0) }

	if (action === 'toggle') {
		setInternalToolConfig(toolName, { ...cfg, enabled: !cfg.enabled })
		p.outro(pc.green(`✅ ${toolName} is now ${!cfg.enabled ? 'enabled' : 'disabled'}.`))
		return
	}

	// Function-level editor
	const fnName = await p.text({
		message: 'Function name to configure:',
		placeholder: 'run_command',
		validate: (v) => { if (!v) return 'Required' },
	})
	if (p.isCancel(fnName)) { p.cancel('Cancelled.'); process.exit(0) }

	const existingFnCfg = cfg.functions?.[fnName as string] ?? { enabled: true }

	const fnAction = await p.select({
		message: `Configuring '${fnName}':`,
		options: [
			{ value: 'toggle', label: existingFnCfg.enabled ? '🔴 Disable this function' : '🟢 Enable this function' },
			{ value: 'allowlist', label: '🔒 Edit allowlist (regex patterns)' },
		],
	})
	if (p.isCancel(fnAction)) { p.cancel('Cancelled.'); process.exit(0) }

	if (fnAction === 'toggle') {
		setInternalToolConfig(toolName, {
			...cfg,
			functions: { ...cfg.functions, [fnName as string]: { ...existingFnCfg, enabled: !existingFnCfg.enabled } },
		})
		p.outro(pc.green(`✅ ${toolName}.${fnName} is now ${!existingFnCfg.enabled ? 'enabled' : 'disabled'}.`))
	} else {
		const currentList = existingFnCfg.allowlist?.join(', ') ?? ''
		const raw = await p.text({
			message: 'Allowlist regex patterns (comma-separated, empty = allow all):',
			placeholder: '^ls ,^cat ',
			initialValue: currentList,
		})
		if (p.isCancel(raw)) { p.cancel('Cancelled.'); process.exit(0) }

		const allowlist = (raw as string).split(',').map((s) => s.trim()).filter(Boolean)
		setInternalToolConfig(toolName, {
			...cfg,
			functions: { ...cfg.functions, [fnName as string]: { ...existingFnCfg, allowlist: allowlist.length ? allowlist : undefined } },
		})
		p.outro(pc.green(`✅ Allowlist updated for ${toolName}.${fnName}.`))
	}
}

async function editMcpServer(name: string, mcpCfg: ReturnType<typeof getAllMcpServers>[number]) {
	const action = await p.select({
		message: `Editing MCP: ${pc.bold(name)}`,
		options: [
			{ value: 'toggle', label: mcpCfg.enabled ? '🔴 Disable' : '🟢 Enable' },
			{ value: 'remove', label: '🗑️  Remove this MCP server' },
		],
	})
	if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0) }

	if (action === 'toggle') {
		setMcpServerConfig(name, { ...mcpCfg, enabled: !mcpCfg.enabled })
		p.outro(pc.green(`✅ mcp:${name} is now ${!mcpCfg.enabled ? 'enabled' : 'disabled'}.`))
	} else {
		const confirmed = await p.confirm({ message: `Remove mcp:${pc.red(name)}?`, initialValue: false })
		if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }
		deleteMcpServer(name)
		p.outro(pc.green(`✅ MCP server '${name}' removed.`))
	}
}

// ─── Remove MCP ───────────────────────────────────────────────────────────────

export const runToolsRemoveMcpCommand = async (name?: string) => {
	const serverName = name ?? (await pickToolName('Which MCP to remove?'))?.replace('mcp:', '')
	if (!serverName) return
	const confirmed = await p.confirm({ message: `Remove mcp:${pc.red(serverName)}?`, initialValue: false })
	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }
	deleteMcpServer(serverName)
	console.log(pc.green(`✅ MCP server '${serverName}' removed.`))
}

// ─── Main tools command (interactive menu) ────────────────────────────────────

export const runToolsCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Tool Manager ')))

	const action = await p.select({
		message: 'What would you like to do?',
		options: [
			{ value: 'list', label: '📋 List all tools & MCPs' },
			{ value: 'add-mcp', label: '🌐 Add an external MCP server' },
			{ value: 'edit', label: '⚙️  Configure a tool or MCP' },
			{ value: 'enable', label: '✅ Enable a tool' },
			{ value: 'disable', label: '🚫 Disable a tool' },
			{ value: 'remove-mcp', label: '🗑️  Remove an external MCP' },
		],
	})
	if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0) }

	switch (action) {
		case 'list': return runToolsListCommand()
		case 'add-mcp': return runToolsAddMcpCommand()
		case 'edit': return runToolsEditCommand()
		case 'enable': return runToolsEnableCommand()
		case 'disable': return runToolsDisableCommand()
		case 'remove-mcp': return runToolsRemoveMcpCommand()
	}
}
