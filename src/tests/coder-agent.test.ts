import { describe, test, expect, beforeEach } from 'bun:test'
import { ensureDefaultAgents, loadAgents, saveAgents, findAgent, type AgentDefinition } from '../utils/agentsStore.ts'

/**
 * The agentsStore module reads from ~/.tamias/agents.json.
 * These tests save and restore the original state to avoid side effects.
 */

let savedAgents: AgentDefinition[]

describe('ensureDefaultAgents', () => {
	beforeEach(() => {
		// Snapshot current state so we can restore after each test
		savedAgents = loadAgents()
	})

	const restore = () => saveAgents(savedAgents)

	test('ensureDefaultAgents is a callable function', () => {
		expect(typeof ensureDefaultAgents).toBe('function')
	})

	test('creates coder agent if none exists', () => {
		// Remove any existing coder to test fresh creation
		const withoutCoder = loadAgents().filter(a => a.slug !== 'coder')
		saveAgents(withoutCoder)

		ensureDefaultAgents()

		const afterAgents = loadAgents()
		const coder = afterAgents.find(a => a.slug === 'coder')
		expect(coder).toBeDefined()
		expect(coder!.name).toBe('Coder')
		expect(coder!.enabled).toBe(true)
		expect(coder!.instructions).toContain('delegate_coding_task')

		restore()
	})

	test('does not duplicate coder agent on repeated calls', () => {
		ensureDefaultAgents()
		ensureDefaultAgents()
		ensureDefaultAgents()

		const agents = loadAgents()
		const coders = agents.filter(a => a.slug === 'coder')
		expect(coders.length).toBe(1)

		restore()
	})

	test('does not overwrite user-customised coder agent', () => {
		// Ensure default exists first
		ensureDefaultAgents()

		// Now customise it
		const agents = loadAgents()
		const coder = agents.find(a => a.slug === 'coder')
		if (coder) {
			coder.instructions = 'My custom coder instructions'
			saveAgents(agents)
		}

		// Call ensure again — should NOT overwrite
		ensureDefaultAgents()

		const final = loadAgents()
		const finalCoder = final.find(a => a.slug === 'coder')
		expect(finalCoder).toBeDefined()
		expect(finalCoder!.instructions).toBe('My custom coder instructions')

		restore()
	})

	// ── Coder agent properties ────────────────────────────────────────
	test('coder agent has coding_cli in allowedTools', () => {
		// Remove existing to test defaults
		const withoutCoder = loadAgents().filter(a => a.slug !== 'coder')
		saveAgents(withoutCoder)

		ensureDefaultAgents()

		const agents = loadAgents()
		const coder = agents.find(a => a.slug === 'coder')
		expect(coder!.allowedTools).toContain('coding_cli')
		expect(coder!.allowedTools).toContain('terminal')
		expect(coder!.allowedTools).toContain('workspace')

		restore()
	})

	test('coder agent is findable by slug', () => {
		ensureDefaultAgents()

		const found = findAgent('coder')
		expect(found).toBeDefined()
		expect(found!.slug).toBe('coder')

		restore()
	})

	test('coder agent is findable by name', () => {
		ensureDefaultAgents()

		const found = findAgent('Coder')
		expect(found).toBeDefined()

		restore()
	})
})
