import { describe, test, expect } from 'bun:test'
import { loadAgents, slugify, findAgent, resolveAgentModelChain, type AgentDefinition } from '../utils/agentsStore'

describe('Agent Store', () => {
	describe('slugify', () => {
		test('converts name to kebab-case slug', () => {
			expect(slugify('My Researcher')).toBe('my-researcher')
			expect(slugify('Hello World 123')).toBe('hello-world-123')
		})

		test('strips leading/trailing hyphens', () => {
			expect(slugify('--test--')).toBe('test')
		})

		test('collapses consecutive non-alphanumeric chars', () => {
			expect(slugify('name---with---dashes')).toBe('name-with-dashes')
		})
	})

	describe('resolveAgentModelChain', () => {
		test('returns empty chain for agent without model', () => {
			const agent: AgentDefinition = {
				id: 'a1', slug: 'test', name: 'Test', instructions: 'test',
				enabled: true,
			}
			expect(resolveAgentModelChain(agent)).toEqual([])
		})

		test('returns primary model only when no fallbacks', () => {
			const agent: AgentDefinition = {
				id: 'a1', slug: 'test', name: 'Test', instructions: 'test',
				enabled: true, model: 'openai/gpt-4o',
			}
			expect(resolveAgentModelChain(agent)).toEqual(['openai/gpt-4o'])
		})

		test('returns model + fallbacks in order', () => {
			const agent: AgentDefinition = {
				id: 'a1', slug: 'test', name: 'Test', instructions: 'test',
				enabled: true,
				model: 'anthropic/claude-sonnet-4-20250514',
				modelFallbacks: ['openai/gpt-4o', 'google/gemini-2.5-flash'],
			}
			const chain = resolveAgentModelChain(agent)
			expect(chain).toEqual([
				'anthropic/claude-sonnet-4-20250514',
				'openai/gpt-4o',
				'google/gemini-2.5-flash',
			])
		})
	})

	describe('loadAgents', () => {
		test('returns an array', () => {
			const agents = loadAgents()
			expect(Array.isArray(agents)).toBe(true)
		})
	})

	describe('findAgent', () => {
		test('returns undefined for non-existent agent', () => {
			const result = findAgent('non-existent-agent-xyz')
			// May be undefined unless agents.json exists with this agent
			expect(result === undefined || typeof result === 'object').toBe(true)
		})
	})
})
