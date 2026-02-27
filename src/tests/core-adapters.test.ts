import { describe, expect, test } from 'bun:test'
import { getOperations, getDomains } from '../core/registry.ts'
import { buildToolsForDomain, buildAllDomainTools } from '../core/adapters/ai-tools.ts'
import { executeOperation, getDashboardOperations } from '../core/adapters/dashboard.ts'
import { generateFullCatalog, generateAICatalog, generateOperationsSummary, generateDomainDocs } from '../core/adapters/docs.ts'
import { getAllInternalToolNames } from '../tools/internalToolNames.ts'

// Side-effect: registers all domain operations
import '../core/domains/index.ts'

// ── AI Tools Adapter ────────────────────────────────────────────────────────

describe('AI Tools Adapter', () => {
	test('buildToolsForDomain returns tool objects for agents', () => {
		const tools = buildToolsForDomain('agents')
		expect(Object.keys(tools).sort()).toEqual(['create', 'list', 'remove', 'show', 'update'])
	})

	test('each tool has description and execute', () => {
		const tools = buildToolsForDomain('agents')
		for (const [verb, t] of Object.entries(tools)) {
			expect(t.description).toBeTruthy()
			expect(typeof t.execute).toBe('function')
		}
	})

	test('buildToolsForDomain returns empty for unknown domain', () => {
		const tools = buildToolsForDomain('nonexistent')
		expect(Object.keys(tools)).toHaveLength(0)
	})

	test('buildAllDomainTools returns flat domain__verb keys', () => {
		const tools = buildAllDomainTools()
		expect(tools).toHaveProperty('agents__create')
		expect(tools).toHaveProperty('agents__list')
		expect(tools).toHaveProperty('agents__show')
	})

	test('tool execute delegates to handler and returns result', async () => {
		const tools = buildToolsForDomain('agents')
		const result = await tools.list.execute({})
		expect(result.success).toBe(true)
		expect(Array.isArray(result.agents)).toBe(true)
	})

	test('tool execute catches handler errors', async () => {
		const tools = buildToolsForDomain('agents')
		const result = await tools.remove.execute({ id: 'nonexistent_agent_xyz' })
		expect(result.success).toBe(false)
		expect(result.error).toBeTruthy()
	})
})

// ── Dashboard Adapter ───────────────────────────────────────────────────────

describe('Dashboard Adapter', () => {
	test('executeOperation returns 404 for unknown operation', async () => {
		const result = await executeOperation('nope.nope', {})
		expect(result.status).toBe(404)
	})

	test('executeOperation returns 400 for invalid input', async () => {
		const result = await executeOperation('agents.create', {}) // missing name + instructions
		expect(result.status).toBe(400)
		expect((result.body as any).error).toBe('Validation failed')
	})

	test('executeOperation returns 200 on success', async () => {
		const result = await executeOperation('agents.list', {})
		expect(result.status).toBe(200)
		expect((result.body as any).success).toBe(true)
	})

	test('getDashboardOperations returns metadata for agents', () => {
		const ops = getDashboardOperations('agents')
		expect(ops.length).toBeGreaterThanOrEqual(5)
		for (const op of ops) {
			expect(op.domain).toBe('agents')
			expect(op.summary).toBeTruthy()
			expect(op.args).toBeTruthy()
		}
	})

	test('getDashboardOperations without domain returns all', () => {
		const all = getDashboardOperations()
		expect(all.length).toBeGreaterThanOrEqual(5) // at least agents ops
	})
})

// ── Docs Adapter ────────────────────────────────────────────────────────────

describe('Docs Adapter', () => {
	test('generateFullCatalog produces markdown with agents section', () => {
		const md = generateFullCatalog()
		expect(md).toContain('# Operations Reference')
		expect(md).toContain('agents.create')
		expect(md).toContain('agents.update')
		expect(md).toContain('agents.remove')
	})

	test('generateDomainDocs produces markdown for a specific domain', () => {
		const md = generateDomainDocs('agents')
		expect(md).toContain('## Agents Operations')
		expect(md).toContain('| Argument | Required |')
	})

	test('generateDomainDocs returns empty string for unknown domain', () => {
		const md = generateDomainDocs('nonexistent')
		expect(md).toBe('')
	})

	test('generateAICatalog returns operation objects with arg metadata', () => {
		const catalog = generateAICatalog()
		expect(Array.isArray(catalog)).toBe(true)
		expect(catalog.length).toBeGreaterThanOrEqual(5)

		const createOp = (catalog as any[]).find((o: any) => o.id === 'agents.create')
		expect(createOp).toBeDefined()
		expect(createOp.domain).toBe('agents')
		expect(createOp.args.name).toBeDefined()
		expect(createOp.args.name.description).toBeTruthy()
		expect(createOp.args.name.required).toBe(true)
	})

	test('generateOperationsSummary produces compact table', () => {
		const md = generateOperationsSummary()
		expect(md).toContain('### Available Operations')
		expect(md).toContain('| Operation | CLI | Description |')
		expect(md).toContain('agents.create')
	})
})

// ── Auto-wiring Integration ─────────────────────────────────────────────────

describe('Auto-wiring', () => {
	test('getAllInternalToolNames includes registry domains', async () => {
		const { getAllInternalToolNames } = await import('../tools/internalToolNames.ts')
		const names = getAllInternalToolNames()
		expect(names).toContain('agents') // auto-discovered from registry
		expect(names).toContain('terminal') // legacy
		expect(names).toContain('swarm') // legacy
	})

	test('registry domains are not in static INTERNAL_TOOL_NAMES', async () => {
		const { INTERNAL_TOOL_NAMES } = await import('../tools/internalToolNames.ts')
		// 'agents' should NOT be in the static list — it's auto-discovered
		expect(INTERNAL_TOOL_NAMES).not.toContain('agents')
		// legacy tools should remain
		expect(INTERNAL_TOOL_NAMES).toContain('terminal')
	})
})

// ── Registry Conformance (replaces scripts/check-registry.ts) ───────────────

describe('Registry Conformance', () => {
	const ops = getOperations()
	const allToolNames = getAllInternalToolNames()
	const internalSet = new Set(allToolNames)

	test('every operation has summary >= 5 chars and description >= 10 chars', () => {
		for (const op of ops) {
			expect(op.summary.length).toBeGreaterThanOrEqual(5)
			expect(op.description.length).toBeGreaterThanOrEqual(10)
		}
	})

	test('every operation schema field has a matching args doc entry', () => {
		for (const op of ops) {
			const schemaKeys = Object.keys(op.inputSchema.shape).sort()
			const argKeys = Object.keys(op.args).sort()
			expect(schemaKeys).toEqual(argKeys)
		}
	})

	test('every ai-surface operation domain is a known internal tool name', () => {
		for (const op of ops) {
			if (op.surfaces.includes('ai')) {
				expect(internalSet.has(op.domain)).toBe(true)
			}
		}
	})

	test('every cli-surface operation has a cliCommand set', () => {
		for (const op of ops) {
			if (op.surfaces.includes('cli')) {
				expect(op.cliCommand).toBeTruthy()
			}
		}
	})

	test('every arg doc has a description >= 3 chars', () => {
		for (const op of ops) {
			for (const [argName, argDoc] of Object.entries(op.args)) {
				expect(argDoc.description.length).toBeGreaterThanOrEqual(3)
			}
		}
	})

	test('at least one operation is registered', () => {
		expect(ops.length).toBeGreaterThan(0)
	})

	test('every registered domain has at least one operation', () => {
		for (const domain of getDomains()) {
			const domainOps = getOperations({ domain })
			expect(domainOps.length).toBeGreaterThan(0)
		}
	})
})

// ── CLI-Tool Protocol Conformance (replaces scripts/check-cli-tool-protocol.ts) ─

describe('CLI-Tool Protocol Conformance', () => {
	test('every protocol entry references valid tool namespaces', async () => {
		const { CLI_TOOL_PROTOCOL } = await import('../utils/cliToolProtocol.ts')
		const allNames = new Set(getAllInternalToolNames())

		for (const entry of CLI_TOOL_PROTOCOL) {
			if (entry.mode === 'required') {
				expect(entry.toolNamespaces.length).toBeGreaterThan(0)
			}
			if (entry.mode === 'none') {
				expect(entry.toolNamespaces.length).toBe(0)
			}
			for (const ns of entry.toolNamespaces) {
				expect(allNames.has(ns)).toBe(true)
			}
		}
	})
})
