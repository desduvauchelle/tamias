import { describe, expect, test, afterAll } from 'bun:test'
import { getOperation, getOperations, getDomains } from '../core/registry.ts'

// Side-effect: registers all domain operations
import '../core/domains/index.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = any // handler results are typed as unknown in the erased registry

// Track created agent ids for cleanup
const createdIds: string[] = []

afterAll(() => {
	const removeOp = getOperation('agents.remove')
	if (!removeOp) return
	for (const id of createdIds) {
		try {
			removeOp.handler({ id }).catch(() => { })
		} catch {
			// ignore cleanup errors
		}
	}
})

// ── Domain Registration ─────────────────────────────────────────────────────

describe('Agents Domain Registration', () => {
	test('agents domain is registered', () => {
		expect(getDomains()).toContain('agents')
	})

	test('all 5 agent operations are registered', () => {
		const ops = getOperations({ domain: 'agents' })
		const verbs = ops.map((o) => o.verb).sort()
		expect(verbs).toEqual(['create', 'list', 'remove', 'show', 'update'])
	})

	test('every agent operation has required metadata', () => {
		const ops = getOperations({ domain: 'agents' })
		for (const op of ops) {
			expect(op.id).toStartWith('agents.')
			expect(op.summary.length).toBeGreaterThan(5)
			expect(op.description.length).toBeGreaterThan(10)
			expect(op.surfaces.length).toBeGreaterThan(0)
			expect(Object.keys(op.args).length).toBeGreaterThan(0)
		}
	})

	test('every agent operation has ai + dashboard + docs surfaces', () => {
		const ops = getOperations({ domain: 'agents' })
		for (const op of ops) {
			expect(op.surfaces).toContain('ai')
			expect(op.surfaces).toContain('dashboard')
			expect(op.surfaces).toContain('docs')
		}
	})

	test('schema fields match args docs', () => {
		const ops = getOperations({ domain: 'agents' })
		for (const op of ops) {
			const schemaKeys = Object.keys(op.inputSchema.shape).sort()
			const argKeys = Object.keys(op.args).sort()
			expect(schemaKeys).toEqual(argKeys)
		}
	})

	test('all cli-surface ops have cliCommand', () => {
		const ops = getOperations({ domain: 'agents', surface: 'cli' })
		for (const op of ops) {
			expect(op.cliCommand).toBeTruthy()
			expect(op.cliCommand).toContain('tamias agents')
		}
	})
})

// ── Handler Integration Tests ───────────────────────────────────────────────

describe('Agents Domain Handlers', () => {
	test('agents.create creates an agent and returns success', async () => {
		const op = getOperation('agents.create')!
		const result: R = await op.handler({
			name: 'TestBot-Core',
			instructions: 'Test instructions for core layer test.',
		})
		expect(result.success).toBe(true)
		expect(result.agent).toBeDefined()
		expect(result.agent.name).toBe('TestBot-Core')
		expect(result.agent.id).toBeTruthy()
		expect(result.agent.slug).toBeTruthy()
		expect(result.message).toContain('TestBot-Core')
		createdIds.push(result.agent.id)
	})

	test('agents.create auto-derives slug from name', async () => {
		const op = getOperation('agents.create')!
		const result: R = await op.handler({
			name: 'My Cool Agent',
			instructions: 'Slug derivation test.',
		})
		expect(result.success).toBe(true)
		expect(result.agent.slug).toBe('my-cool-agent')
		createdIds.push(result.agent.id)
	})

	test('agents.list returns all agents', async () => {
		const op = getOperation('agents.list')!
		const result: R = await op.handler({})
		expect(result.success).toBe(true)
		expect(result.count).toBeGreaterThanOrEqual(0)
		expect(Array.isArray(result.agents)).toBe(true)
	})

	test('agents.list with enabledOnly filter', async () => {
		const op = getOperation('agents.list')!
		const result: R = await op.handler({ enabledOnly: true })
		expect(result.success).toBe(true)
		// All returned agents should be enabled
		for (const agent of result.agents) {
			expect(agent.enabled).toBe(true)
		}
	})

	test('agents.show finds agent by name', async () => {
		// Create an agent first
		const createOp = getOperation('agents.create')!
		const created: R = await createOp.handler({
			name: 'ShowTestBot',
			instructions: 'Find me by name.',
		})
		createdIds.push(created.agent.id)

		const showOp = getOperation('agents.show')!
		const result: R = await showOp.handler({ query: 'ShowTestBot' })
		expect(result.success).toBe(true)
		expect(result.agent.name).toBe('ShowTestBot')
		expect(result.personaDir).toBeTruthy()
	})

	test('agents.show returns error for unknown agent', async () => {
		const op = getOperation('agents.show')!
		const result: R = await op.handler({ query: 'definitely-not-an-agent-xyz' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('not found')
	})

	test('agents.update modifies agent fields', async () => {
		// Create, then update
		const createOp = getOperation('agents.create')!
		const created: R = await createOp.handler({
			name: 'UpdateTestBot',
			instructions: 'Original instructions.',
		})
		createdIds.push(created.agent.id)

		const updateOp = getOperation('agents.update')!
		const result: R = await updateOp.handler({
			id: created.agent.id,
			instructions: 'Updated instructions via core test.',
		})
		expect(result.success).toBe(true)
		expect(result.agent.instructions).toBe('Updated instructions via core test.')
		expect(result.agent.name).toBe('UpdateTestBot') // unchanged field preserved
	})

	test('agents.update throws for unknown agent', async () => {
		const op = getOperation('agents.update')!
		await expect(
			op.handler({ id: 'agent_nonexistent_xyz', name: 'Nope' }),
		).rejects.toThrow()
	})

	test('agents.remove deletes an agent', async () => {
		// Create, then remove
		const createOp = getOperation('agents.create')!
		const created: R = await createOp.handler({
			name: 'RemoveTestBot',
			instructions: 'I will be removed.',
		})

		const removeOp = getOperation('agents.remove')!
		const result: R = await removeOp.handler({ id: created.agent.id })
		expect(result.success).toBe(true)
		expect(result.removedId).toBe(created.agent.id)

		// Verify removal
		const showOp = getOperation('agents.show')!
		const showResult: R = await showOp.handler({ query: created.agent.id })
		expect(showResult.success).toBe(false)
	})

	test('agents.remove throws for unknown agent', async () => {
		const op = getOperation('agents.remove')!
		await expect(
			op.handler({ id: 'agent_nonexistent_xyz' }),
		).rejects.toThrow()
	})

	test('input schema validation works on agent operations', () => {
		const op = getOperation('agents.create')!
		// Valid input passes
		const valid = op.inputSchema.safeParse({ name: 'Test', instructions: 'Hello' })
		expect(valid.success).toBe(true)

		// Missing required field fails
		const invalid = op.inputSchema.safeParse({ name: 'Test' }) // missing instructions
		expect(invalid.success).toBe(false)

		// Empty name fails
		const emptyName = op.inputSchema.safeParse({ name: '', instructions: 'test' })
		expect(emptyName.success).toBe(false)
	})
})
