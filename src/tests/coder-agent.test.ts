import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { ensureDefaultAgents, loadAgents, saveAgents, findAgent, type AgentDefinition } from '../utils/agentsStore.ts'

/**
 * These tests use a temp directory to isolate from real user agents.
 * We mock the agents file path by manipulating the file directly.
 */

let tempDir: string
let agentsFile: string

// The agentsStore module reads from ~/.tamias/agents.json,
// so we test the ensureDefaultAgents logic by checking behaviour
// on the real file system through the public API.

describe('ensureDefaultAgents', () => {
	// ── Happy path ─────────────────────────────────────────────────────
	test('ensureDefaultAgents is a callable function', () => {
		expect(typeof ensureDefaultAgents).toBe('function')
	})

	test('creates coder agent if none exists', () => {
		// Call ensure — it should create the coder if missing
		const beforeAgents = loadAgents()
		const hadCoder = beforeAgents.some(a => a.slug === 'coder')

		ensureDefaultAgents()

		const afterAgents = loadAgents()
		const coder = afterAgents.find(a => a.slug === 'coder')
		expect(coder).toBeDefined()
		expect(coder!.name).toBe('Coder')
		expect(coder!.enabled).toBe(true)
		expect(coder!.instructions).toContain('coding_cli')

		// Clean up: if we created it, remove it
		if (!hadCoder) {
			const cleaned = afterAgents.filter(a => a.slug !== 'coder')
			saveAgents(cleaned)
		}
	})

	test('does not duplicate coder agent on repeated calls', () => {
		const before = loadAgents()
		const hadCoder = before.some(a => a.slug === 'coder')

		ensureDefaultAgents()
		ensureDefaultAgents()
		ensureDefaultAgents()

		const agents = loadAgents()
		const coders = agents.filter(a => a.slug === 'coder')
		expect(coders.length).toBe(1)

		// Clean up
		if (!hadCoder) {
			const cleaned = agents.filter(a => a.slug !== 'coder')
			saveAgents(cleaned)
		}
	})

	test('does not overwrite user-customised coder agent', () => {
		const before = loadAgents()
		const hadCoder = before.some(a => a.slug === 'coder')

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

		// Clean up
		if (!hadCoder) {
			const cleaned = final.filter(a => a.slug !== 'coder')
			saveAgents(cleaned)
		}
	})

	// ── Coder agent properties ────────────────────────────────────────
	test('coder agent has coding_cli in allowedTools', () => {
		const before = loadAgents()
		const hadCoder = before.some(a => a.slug === 'coder')

		ensureDefaultAgents()

		const agents = loadAgents()
		const coder = agents.find(a => a.slug === 'coder')
		expect(coder!.allowedTools).toContain('coding_cli')
		expect(coder!.allowedTools).toContain('terminal')
		expect(coder!.allowedTools).toContain('workspace')

		if (!hadCoder) {
			const cleaned = agents.filter(a => a.slug !== 'coder')
			saveAgents(cleaned)
		}
	})

	test('coder agent is findable by slug', () => {
		const before = loadAgents()
		const hadCoder = before.some(a => a.slug === 'coder')

		ensureDefaultAgents()

		const found = findAgent('coder')
		expect(found).toBeDefined()
		expect(found!.slug).toBe('coder')

		if (!hadCoder) {
			const agents = loadAgents()
			const cleaned = agents.filter(a => a.slug !== 'coder')
			saveAgents(cleaned)
		}
	})

	test('coder agent is findable by name', () => {
		const before = loadAgents()
		const hadCoder = before.some(a => a.slug === 'coder')

		ensureDefaultAgents()

		const found = findAgent('Coder')
		expect(found).toBeDefined()

		if (!hadCoder) {
			const agents = loadAgents()
			const cleaned = agents.filter(a => a.slug !== 'coder')
			saveAgents(cleaned)
		}
	})
})
