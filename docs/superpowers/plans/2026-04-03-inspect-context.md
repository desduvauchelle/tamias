# Inspect Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tamias inspect` CLI command and `tamias__inspect_context` AI tool that generate a comprehensive debug report (system prompt, tools with schemas, session metadata, config snapshot) as a markdown file — the AI tool sends it as a file attachment in Discord/Telegram.

**Architecture:** A shared `generateInspectReport(session?)` function in `src/utils/inspectReport.ts` assembles the full markdown report from system prompt tiers, a static tool catalog (introspected from tool modules directly using stub factories for CLI, or live buildActiveTools for AI tool), and config state. CLI writes the file locally; AI tool emits a `file` DaemonEvent.

**Tech Stack:** Bun + TypeScript, Vercel AI SDK `tool()`, Zod v4 (`meta()` for descriptions), `@clack/prompts` for CLI output, existing `buildSystemPrompt()` + `getInternalToolConfig()` + `getBridgesConfig()` + `getAllMcpServers()`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/inspectReport.ts` | **Create** | Shared report generator: system prompt, tool catalog, config, session metadata |
| `src/commands/inspect.ts` | **Create** | CLI command: calls generator with synthetic context, writes file |
| `src/index.ts` | **Modify** | Register `tamias inspect` command |
| `src/tools/tamias.ts` | **Modify** | Add `inspect_context` tool at the end of `createTamiasTools` |
| `src/tests/inspect.test.ts` | **Create** | Unit tests for `generateInspectReport()` |

---

## Task 1: Core report generator

**Files:**
- Create: `src/utils/inspectReport.ts`

The generator calls `buildSystemPrompt()` for the system prompt section, imports all internal tool modules with a stub factory to get descriptions, reads `getBridgesConfig()` / `getAllMcpServers()` for config snapshot, and assembles the 4-section markdown document.

- [ ] **Step 1: Write the failing test for `generateInspectReport` with no session**

File: `src/tests/inspect.test.ts`

```ts
import { describe, it, expect } from 'bun:test'
import { generateInspectReport } from '../utils/inspectReport.ts'

describe('generateInspectReport', () => {
  it('returns a string with all 4 section headers (no session)', async () => {
    const report = await generateInspectReport()
    expect(report).toContain('## 1. Session Metadata')
    expect(report).toContain('## 2. Configuration Snapshot')
    expect(report).toContain('## 3. System Prompt')
    expect(report).toContain('## 4. Available Tools')
  })

  it('includes "terminal" in channel metadata when no session provided', async () => {
    const report = await generateInspectReport()
    expect(report).toContain('terminal')
  })

  it('includes at least one internal tool namespace', async () => {
    const report = await generateInspectReport()
    // Tool namespaces appear as ### headers
    expect(report).toMatch(/### internal:/)
  })

  it('does not crash when a tool has no description', async () => {
    // Just verifying the function completes without throwing
    await expect(generateInspectReport()).resolves.toBeDefined()
  })

  it('config snapshot lists bridge status', async () => {
    const report = await generateInspectReport()
    expect(report).toContain('### Bridges')
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
bun test --preload ./src/tests/setup.ts src/tests/inspect.test.ts
```

Expected: `error: Cannot find module '../utils/inspectReport.ts'`

- [ ] **Step 3: Create `src/utils/inspectReport.ts`**

```ts
import { join } from 'path'
import { writeFileSync } from 'fs'
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

/** Extract a human-readable type label from a Zod v4 field */
function zodTypeName(field: any): string {
	const def = field?.def ?? field?._def ?? {}
	const type = def.type ?? field?.type ?? 'unknown'
	if (type === 'optional') return zodTypeName(def.innerType) + '?'
	if (type === 'array') return `${zodTypeName(def.element)}[]`
	if (type === 'enum') return (def.entries ? Object.keys(def.entries) : def.values ?? []).map((v: string) => `"${v}"`).join(' | ')
	return String(type)
}

/** Extract the description from a Zod v4 field (handles describe() before or after .optional()) */
function zodDescription(field: any): string {
	// describe() after optional() stores on the outer field's meta()
	const outerDesc = field?.meta?.()?.description
	if (outerDesc) return outerDesc
	// describe() before optional() stores on the inner type
	const def = field?.def ?? field?._def ?? {}
	if (def.type === 'optional') {
		return def.innerType?.meta?.()?.description ?? ''
	}
	return ''
}

/** Render the parameter table for one tool's inputSchema */
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

// ─── Static tool catalog (no live connections needed) ────────────────────────

/** Build a flat map of fullToolName -> { description, paramsMd } for all internal tools.
 * Uses a stub aiService so factory functions can be called without a live daemon. */
async function buildStaticToolCatalog(): Promise<Map<string, { description: string; paramsMd: string }>> {
	const catalog = new Map<string, { description: string; paramsMd: string }>()

	const stubService = {
		getSession: () => undefined,
		getAllSessions: () => [],
		emit: () => {},
	} as any

	// Import all internal tool modules
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

	const internalCatalog: Record<string, Record<string, any>> = {
		terminal: terminalTools as any,
		tamias: createTamiasTools(stubService, 'inspect'),
		cron: createCronTools(stubService, 'inspect'),
		email: emailTools as any,
		github: githubTools as any,
		workspace: createWorkspaceTools(undefined),
		gemini: geminiTools as any,
		subagent: createSubagentTools(stubService, 'inspect'),
		image: createImageTools(stubService, 'inspect', undefined),
		browser: createBrowserTools(stubService, 'inspect'),
		pdf: createPdfTools(stubService, 'inspect'),
		memory: memoryTools as any,
		swarm: createSwarmTools(stubService, 'inspect'),
		session: createSessionTools(stubService, 'inspect'),
		skills: skillsTools as any,
		websearch: createWebsearchTools(stubService, 'inspect'),
		projects: projectsModule as any,
	}

	for (const [ns, toolSet] of Object.entries(internalCatalog)) {
		const cfg = getInternalToolConfig(ns)
		if (!cfg.enabled) continue
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
	const config = loadConfig()
	const bridges = getBridgesConfig()
	const mcpServers = getAllMcpServers()
	const allToolNames = getAllInternalToolNames()

	const lines: string[] = ['## 2. Configuration Snapshot', '']

	// Bridges
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

	// MCP Servers
	lines.push('', '### MCP Servers', '')
	if (mcpServers.length === 0) {
		lines.push('_(none configured)_')
	} else {
		for (const mcp of mcpServers) {
			lines.push(`- **${mcp.name}** (${mcp.transport}): ${mcp.enabled ? '**enabled**' : 'disabled'}${mcp.label ? ` — ${mcp.label}` : ''}`)
		}
	}

	// Internal tool namespaces
	lines.push('', '### Internal Tool Namespaces', '')
	for (const name of allToolNames) {
		const cfg = getInternalToolConfig(name)
		lines.push(`- **${name}**: ${cfg.enabled ? '**enabled**' : 'disabled'}`)
	}

	// Models
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
	} catch (err: any) {
		lines.push(`> [error rendering system prompt: ${err.message ?? String(err)}]`)
	}

	return lines.join('\n')
}

async function buildToolsSection(
	liveCatalog?: Map<string, { description: string; paramsMd: string }>,
): Promise<string> {
	const lines: string[] = ['## 4. Available Tools', '']

	const catalog = liveCatalog ?? await buildStaticToolCatalog()

	// Group by namespace
	const byNs = new Map<string, Array<[string, { description: string; paramsMd: string }]>>()
	for (const [fullName, info] of catalog) {
		const ns = fullName.includes('__') ? fullName.slice(0, fullName.indexOf('__')) : fullName
		if (!byNs.has(ns)) byNs.set(ns, [])
		byNs.get(ns)!.push([fullName, info])
	}

	for (const [ns, tools] of byNs) {
		lines.push(`### ${ns} (${tools.length} function${tools.length === 1 ? '' : 's'})`, '')
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

/**
 * Generate a full debug report: session metadata, config snapshot, system prompt, and tool catalog.
 * - If `session` is provided (AI tool context): uses real session data and live tools.
 * - If `session` is omitted (CLI context): uses synthetic terminal context and static tool catalog.
 *
 * Optional `liveCatalog` lets callers pass a pre-built tool map (e.g. from buildActiveTools).
 */
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

/** Write a report to a file and return the absolute path */
export function writeInspectReport(content: string, dir: string = TAMIAS_DIR): string {
	const now = new Date()
	const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const fileName = `inspect-${stamp}.md`
	const filePath = join(dir, fileName)
	writeFileSync(filePath, content, 'utf-8')
	return filePath
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
bun test --preload ./src/tests/setup.ts src/tests/inspect.test.ts
```

Expected: `5 pass, 0 fail`

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/inspectReport.ts src/tests/inspect.test.ts
git commit -m "feat: add generateInspectReport utility and tests"
```

---

## Task 2: CLI command

**Files:**
- Create: `src/commands/inspect.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing CLI smoke test**

Add to `src/tests/inspect.test.ts`:

```ts
import { writeInspectReport } from '../utils/inspectReport.ts'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'

describe('writeInspectReport', () => {
  it('writes a file and returns the path', async () => {
    const content = '# test report'
    const dir = tmpdir()
    const filePath = writeInspectReport(content, dir)
    expect(filePath).toMatch(/inspect-.*\.md$/)
    expect(existsSync(filePath)).toBe(true)
    unlinkSync(filePath) // cleanup
  })
})
```

- [ ] **Step 2: Run test to confirm pass (writeInspectReport already implemented)**

```bash
bun test --preload ./src/tests/setup.ts src/tests/inspect.test.ts
```

Expected: `6 pass, 0 fail`

- [ ] **Step 3: Create `src/commands/inspect.ts`**

```ts
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { generateInspectReport, writeInspectReport } from '../utils/inspectReport.ts'
import { TAMIAS_DIR } from '../utils/config.ts'

export async function runInspectCommand(opts: { print?: boolean }) {
	p.intro(pc.bgBlue(pc.white(' Tamias — Inspect Context ')))

	const spinner = p.spinner()
	spinner.start('Building inspection report…')

	let report: string
	try {
		report = await generateInspectReport()
		spinner.stop('Report generated.')
	} catch (err: any) {
		spinner.stop('Failed to generate report.')
		p.log.error(err.message ?? String(err))
		process.exit(1)
	}

	if (opts.print) {
		console.log(report)
	} else {
		const filePath = writeInspectReport(report, TAMIAS_DIR)
		p.log.success(`Report written to: ${pc.cyan(filePath)}`)
	}

	p.outro('Done.')
}
```

- [ ] **Step 4: Register command in `src/index.ts`**

Add import after the existing imports (around line 7):

```ts
import { runInspectCommand } from './commands/inspect.ts'
```

Add command registration after the `cronCommand` line (around line 17):

```ts
// ─── tamias inspect ───────────────────────────────────────────────────────────
program
	.command('inspect')
	.description('Generate a debug report of the current system prompt, tools, and config')
	.option('--print', 'Print the report to terminal instead of writing a file')
	.action((opts: { print?: boolean }) => runInspectCommand(opts))
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors

- [ ] **Step 6: Smoke-test the CLI command**

```bash
bun src/index.ts inspect
```

Expected: output like:
```
◆  Tamias — Inspect Context
✓  Report generated.
✔  Report written to: /Users/.../.tamias/inspect-2026-04-03T....md
◆  Done.
```

- [ ] **Step 7: Commit**

```bash
git add src/commands/inspect.ts src/index.ts
git commit -m "feat: add tamias inspect CLI command"
```

---

## Task 3: AI tool

**Files:**
- Modify: `src/tools/tamias.ts`

Add `inspect_context` tool at the end of the return object inside `createTamiasTools` (before the closing `}`).

- [ ] **Step 1: Add the test for the AI tool shape**

Add to `src/tests/inspect.test.ts`:

```ts
import { createTamiasTools } from '../tools/tamias.ts'

describe('tamias__inspect_context tool', () => {
  it('is exported from createTamiasTools', () => {
    const stubService = { getSession: () => undefined, getAllSessions: () => [], emit: () => {} } as any
    const tools = createTamiasTools(stubService, 'test-session')
    expect(typeof tools.inspect_context).toBe('object')
    expect(typeof tools.inspect_context.execute).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
bun test --preload ./src/tests/setup.ts src/tests/inspect.test.ts
```

Expected: `Expected "object", received "undefined"` (inspect_context doesn't exist yet)

- [ ] **Step 3: Add `inspect_context` tool to `src/tools/tamias.ts`**

At the very end of the return object in `createTamiasTools` (just before the final `}`), add:

```ts
		inspect_context: tool({
			description: 'Generate a debug report showing the current system prompt, all available tools with descriptions and input schemas, session metadata, and configuration snapshot. Sends the report as a downloadable .md file attachment.',
			inputSchema: z.object({}),
			execute: async () => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const { generateInspectReport, writeInspectReport } = await import('../utils/inspectReport.ts')
					const { buildActiveTools } = await import('../utils/toolRegistry.ts')

					// Build live tool catalog with real descriptions
					let liveCatalog: Map<string, { description: string; paramsMd: string }> | undefined
					try {
						const { tools: activeTools } = await buildActiveTools(aiService, sessionId)
						liveCatalog = new Map()
						for (const [fullName, t] of Object.entries(activeTools)) {
							const anyT = t as any
							const description = anyT.description ?? ''
							// Render params using the same Zod introspection
							const shape = anyT.inputSchema?._def?.shape ?? anyT.inputSchema?.def?.shape ?? {}
							const paramLines: string[] = []
							for (const [pName, field] of Object.entries(shape)) {
								const anyF = field as any
								const isOpt = (anyF.def ?? anyF._def)?.type === 'optional'
								const inner = isOpt ? (anyF.def ?? anyF._def).innerType : anyF
								const type = inner?.type ?? (inner?.def ?? inner?._def)?.type ?? 'unknown'
								const desc = anyF.meta?.()?.description ?? inner?.meta?.()?.description ?? ''
								paramLines.push(`  - \`${pName}\` (${type}${isOpt ? '?' : ''})${desc ? ` — ${desc}` : ''}`)
							}
							liveCatalog.set(fullName, { description, paramsMd: paramLines.join('\n') })
						}
					} catch {
						// Falls back to static catalog inside generateInspectReport
					}

					const report = await generateInspectReport(session, liveCatalog)
					const filePath = writeInspectReport(report, session.workspacePath)

					const buffer = Buffer.from(report, 'utf-8')
					session.emitter.emit('event', {
						type: 'file',
						name: 'inspect-context.md',
						buffer,
						mimeType: 'text/markdown',
					} as DaemonEvent)

					return { success: true, filePath, message: 'Inspection report generated and sent as a file attachment.' }
				} catch (err: any) {
					return { success: false, error: err.message ?? String(err) }
				}
			},
		}),
```

- [ ] **Step 4: Run tests**

```bash
bun test --preload ./src/tests/setup.ts src/tests/inspect.test.ts
```

Expected: `8 pass, 0 fail`

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors

- [ ] **Step 6: Run full test suite**

```bash
bun test --preload ./src/tests/setup.ts src/tests/*.test.ts src/utils/*.test.ts
```

Expected: all pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/tools/tamias.ts src/tests/inspect.test.ts
git commit -m "feat: add tamias__inspect_context AI tool"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task covering it |
|-----------------|-----------------|
| `tamias inspect` CLI command | Task 2 |
| `tamias__inspect_context` AI tool | Task 3 |
| Sends file via Discord file attachment | Task 3 (emits `DaemonEvent file`) |
| Full system prompt in report | Task 1 (`buildSystemPromptSection`) |
| All tools with descriptions + schemas | Task 1 (`buildToolsSection`) |
| Session metadata | Task 1 (`buildMetadataSection`) |
| Config snapshot (bridges, MCPs, tools) | Task 1 (`buildConfigSection`) |
| Writes markdown file | Task 1 (`writeInspectReport`) + Task 2 |
| CLI works without running daemon | Task 1 (standalone, no REST calls) |
| Error handling for tier render failures | Task 1 (try/catch in `buildSystemPromptSection`) |
| Tests for all 4 section headers | Task 1, Step 1 |
| Tests for file write | Task 2, Step 1 |
| Tests for AI tool shape | Task 3, Step 1 |

### Placeholder scan

No TBDs, no "fill in later", no "similar to above". All code is explicit.

### Type consistency

- `generateInspectReport(session?: Session, liveCatalog?: Map<string, ...>)` — consistent across Task 1, 3
- `writeInspectReport(content: string, dir: string)` — consistent across Task 1, 2, 3
- `DaemonEvent` imported in `tamias.ts` already — no new import needed
- `buildActiveTools` imported dynamically in Task 3 — same signature as in `toolRegistry.ts`
