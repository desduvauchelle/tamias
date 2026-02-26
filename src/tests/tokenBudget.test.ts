import { describe, test, expect } from 'bun:test'
import { estimateTokens, assembleSystemPrompt, getSystemPromptBudget, formatTokenBudgetDebug, type ContextTier } from '../utils/tokenBudget'

describe('Token Budget', () => {
	describe('estimateTokens', () => {
		test('returns 0 for empty string', () => {
			expect(estimateTokens('')).toBe(0)
		})

		test('estimates tokens using chars/3.5 heuristic', () => {
			const text = 'Hello, World!' // 13 chars
			const estimate = estimateTokens(text)
			expect(estimate).toBe(Math.ceil(13 / 3.5)) // 4
		})

		test('handles long text', () => {
			const text = 'a'.repeat(3500)
			expect(estimateTokens(text)).toBe(1000)
		})
	})

	describe('getSystemPromptBudget', () => {
		test('returns 35% of context window by default', () => {
			expect(getSystemPromptBudget(100000)).toBe(35000)
		})

		test('enforces minimum of 4000', () => {
			expect(getSystemPromptBudget(1000)).toBe(4000)
		})

		test('accepts custom ratio', () => {
			expect(getSystemPromptBudget(100000, 0.5)).toBe(50000)
		})
	})

	describe('assembleSystemPrompt', () => {
		test('includes all tiers when within budget', () => {
			const tiers: ContextTier[] = [
				{ name: 'system', content: 'System instructions', priority: 0, trimmable: false },
				{ name: 'identity', content: 'Identity info', priority: 1, trimmable: false },
				{ name: 'memory', content: 'Memory content', priority: 5, trimmable: true },
			]

			const result = assembleSystemPrompt(tiers, 10000)
			expect(result.wasTrimmed).toBe(false)
			expect(result.systemPrompt).toContain('System instructions')
			expect(result.systemPrompt).toContain('Identity info')
			expect(result.systemPrompt).toContain('Memory content')
			expect(result.tiers).toHaveLength(3)
		})

		test('trims lowest priority tiers first when over budget', () => {
			const tiers: ContextTier[] = [
				{ name: 'system', content: 'A'.repeat(350), priority: 0, trimmable: false }, // ~100 tokens
				{ name: 'identity', content: 'B'.repeat(350), priority: 1, trimmable: false }, // ~100 tokens
				{ name: 'memory', content: 'C'.repeat(3500), priority: 5, trimmable: true }, // ~1000 tokens
			]

			// Budget of 250 — needs to trim memory
			const result = assembleSystemPrompt(tiers, 250)
			expect(result.wasTrimmed).toBe(true)
			expect(result.systemPrompt).toContain('A'.repeat(350))
			expect(result.systemPrompt).toContain('B'.repeat(350))
		})

		test('replaces with minContent when trimmable', () => {
			const tiers: ContextTier[] = [
				{ name: 'system', content: 'Short system', priority: 0, trimmable: false },
				{
					name: 'memory',
					content: 'M'.repeat(7000), // ~2000 tokens
					priority: 5,
					trimmable: true,
					minContent: 'See MEMORY.md',
				},
			]

			const result = assembleSystemPrompt(tiers, 50)
			expect(result.wasTrimmed).toBe(true)
			const memoryTier = result.tiers.find(t => t.name === 'memory')
			expect(memoryTier?.trimmed).toBe(true)
		})

		test('skips empty tiers', () => {
			const tiers: ContextTier[] = [
				{ name: 'system', content: 'System', priority: 0, trimmable: false },
				{ name: 'empty', content: '', priority: 1, trimmable: false },
				{ name: 'memory', content: 'Memory', priority: 5, trimmable: true },
			]

			const result = assembleSystemPrompt(tiers, 10000)
			const emptyTier = result.tiers.find(t => t.name === 'empty')
			expect(emptyTier?.estimatedTokens).toBe(0)
		})

		test('sorts by priority (important first)', () => {
			const tiers: ContextTier[] = [
				{ name: 'low', content: 'Low priority', priority: 10, trimmable: true },
				{ name: 'high', content: 'High priority', priority: 0, trimmable: false },
				{ name: 'mid', content: 'Mid priority', priority: 5, trimmable: true },
			]

			const result = assembleSystemPrompt(tiers, 10000)
			// In the final joined prompt, high should come first
			const highIdx = result.systemPrompt.indexOf('High priority')
			const midIdx = result.systemPrompt.indexOf('Mid priority')
			const lowIdx = result.systemPrompt.indexOf('Low priority')
			expect(highIdx).toBeLessThan(midIdx)
			expect(midIdx).toBeLessThan(lowIdx)
		})
	})

	describe('formatTokenBudgetDebug', () => {
		test('formats a readable debug string', () => {
			const result = {
				systemPrompt: 'test',
				estimatedTokens: 500,
				tiers: [
					{ name: 'system', estimatedTokens: 200, trimmed: false },
					{ name: 'memory', estimatedTokens: 300, trimmed: true },
				],
				wasTrimmed: true,
			}

			const debug = formatTokenBudgetDebug(result)
			expect(debug).toContain('500')
			expect(debug).toContain('TRIMMED')
			expect(debug).toContain('system')
			expect(debug).toContain('memory')
			expect(debug).toContain('[trimmed]')
		})
	})
})
