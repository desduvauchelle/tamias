import { describe, expect, test, beforeEach, afterAll } from 'bun:test'
import { z } from 'zod'
import {
	registerOperation,
	getOperation,
	getOperations,
	getDomains,
	clearRegistry,
} from '../core/registry.ts'
import { registerAllDomains } from '../core/domains/index.ts'

// ── Core Registry Unit Tests ────────────────────────────────────────────────

describe('Core Registry', () => {
	beforeEach(() => clearRegistry())

	// Restore domain registrations for other test files sharing this process
	afterAll(() => {
		clearRegistry()
		registerAllDomains()
	})

	function makeOp(overrides: Record<string, unknown> = {}) {
		return {
			id: 'test.create',
			domain: 'test',
			verb: 'create',
			summary: 'Create a test entity',
			description: 'Creates a test entity for unit testing.',
			inputSchema: z.object({ name: z.string() }),
			args: { name: { description: 'entity name', required: true } },
			surfaces: ['ai' as const, 'docs' as const],
			handler: async (input: { name: string }) => ({ success: true, name: input.name }),
			...overrides,
		}
	}

	test('registerOperation stores and retrieves an operation', () => {
		registerOperation(makeOp())
		const op = getOperation('test.create')
		expect(op).toBeDefined()
		expect(op!.id).toBe('test.create')
		expect(op!.domain).toBe('test')
		expect(op!.verb).toBe('create')
		expect(op!.summary).toBe('Create a test entity')
	})

	test('rejects duplicate operation ids', () => {
		registerOperation(makeOp())
		expect(() => registerOperation(makeOp())).toThrow('already registered')
	})

	test('getOperation returns undefined for unknown id', () => {
		expect(getOperation('nope.nope')).toBeUndefined()
	})

	test('getOperations returns all registered operations', () => {
		registerOperation(makeOp({ id: 'test.create' }))
		registerOperation(makeOp({ id: 'test.update', verb: 'update' }))
		expect(getOperations()).toHaveLength(2)
	})

	test('getOperations filters by domain', () => {
		registerOperation(makeOp({ id: 'alpha.op1', domain: 'alpha' }))
		registerOperation(makeOp({ id: 'beta.op1', domain: 'beta' }))
		registerOperation(makeOp({ id: 'alpha.op2', domain: 'alpha', verb: 'update' }))
		const alphaOps = getOperations({ domain: 'alpha' })
		expect(alphaOps).toHaveLength(2)
		expect(alphaOps.every((o) => o.domain === 'alpha')).toBe(true)
	})

	test('getOperations filters by surface', () => {
		registerOperation(makeOp({ id: 'test.ai', surfaces: ['ai'] }))
		registerOperation(makeOp({ id: 'test.cli', verb: 'list', surfaces: ['cli'] }))
		const aiOps = getOperations({ surface: 'ai' })
		expect(aiOps).toHaveLength(1)
		expect(aiOps[0].id).toBe('test.ai')
	})

	test('getOperations filters by domain + surface combined', () => {
		registerOperation(makeOp({ id: 'a.op1', domain: 'a', surfaces: ['ai', 'dashboard'] }))
		registerOperation(makeOp({ id: 'a.op2', domain: 'a', verb: 'list', surfaces: ['cli'] }))
		registerOperation(makeOp({ id: 'b.op1', domain: 'b', surfaces: ['ai'] }))
		const result = getOperations({ domain: 'a', surface: 'ai' })
		expect(result).toHaveLength(1)
		expect(result[0].id).toBe('a.op1')
	})

	test('getDomains returns unique domain names', () => {
		registerOperation(makeOp({ id: 'x.a', domain: 'x' }))
		registerOperation(makeOp({ id: 'x.b', domain: 'x', verb: 'update' }))
		registerOperation(makeOp({ id: 'y.a', domain: 'y' }))
		const domains = getDomains()
		expect(domains).toHaveLength(2)
		expect(domains).toContain('x')
		expect(domains).toContain('y')
	})

	test('clearRegistry empties all operations', () => {
		registerOperation(makeOp())
		expect(getOperations()).toHaveLength(1)
		clearRegistry()
		expect(getOperations()).toHaveLength(0)
		expect(getDomains()).toHaveLength(0)
	})

	test('handler receives validated input and returns output', async () => {
		const op = registerOperation(makeOp())
		const result = await op.handler({ name: 'hello' })
		expect(result).toEqual({ success: true, name: 'hello' })
	})
})
