import { describe, test, expect } from 'bun:test'
import { estimateComplexity, type ComplexityResult } from '../utils/complexityEstimator.ts'

describe('estimateComplexity', () => {
	// ── Happy path ─────────────────────────────────────────────────────────
	test('returns normal tier for simple bug fix', () => {
		const result = estimateComplexity('Fix the typo in the README')
		expect(result.tier).toBe('normal')
		expect(result.score).toBeLessThanOrEqual(50)
		expect(result.matchedSignals).toContain('trivial change')
	})

	test('returns smart tier for large refactoring task', () => {
		const result = estimateComplexity(
			'Refactor the authentication module to use a new design pattern across multiple files'
		)
		expect(result.tier).toBe('smart')
		expect(result.score).toBeGreaterThan(50)
		expect(result.matchedSignals).toContain('refactor/redesign/migrate')
		expect(result.matchedSignals).toContain('multi-file scope')
	})

	test('accumulates score from multiple matching signals', () => {
		const result = estimateComplexity(
			'Implement a new feature with full test coverage across several modules and database migrations'
		)
		expect(result.score).toBeGreaterThan(50)
		expect(result.matchedSignals.length).toBeGreaterThan(2)
	})

	test('returns correct structure', () => {
		const result = estimateComplexity('Add a button to the UI')
		expect(result).toHaveProperty('score')
		expect(result).toHaveProperty('tier')
		expect(result).toHaveProperty('matchedSignals')
		expect(typeof result.score).toBe('number')
		expect(['smart', 'normal']).toContain(result.tier)
		expect(Array.isArray(result.matchedSignals)).toBe(true)
	})

	// ── Specific signal matching ──────────────────────────────────────────
	test('detects refactor/redesign/migrate keywords', () => {
		expect(estimateComplexity('Migrate the database schema').matchedSignals).toContain('refactor/redesign/migrate')
		expect(estimateComplexity('Redesign the user flow').matchedSignals).toContain('refactor/redesign/migrate')
		expect(estimateComplexity('Rewrite the parser').matchedSignals).toContain('refactor/redesign/migrate')
	})

	test('detects architecture/pattern keywords', () => {
		const result = estimateComplexity('Apply the observer design pattern to the event system')
		expect(result.matchedSignals).toContain('architecture/patterns')
	})

	test('detects new feature/implement keywords', () => {
		expect(estimateComplexity('Implement pagination for the API').matchedSignals).toContain('new feature/implement')
		expect(estimateComplexity('Build a caching layer').matchedSignals).toContain('new feature/implement')
		expect(estimateComplexity('Create a new dashboard widget').matchedSignals).toContain('new feature/implement')
	})

	test('detects testing scope keywords', () => {
		expect(estimateComplexity('Add tests for the auth module').matchedSignals).toContain('testing scope')
		expect(estimateComplexity('Write a full test suite').matchedSignals).toContain('testing scope')
		expect(estimateComplexity('Get full coverage on utils').matchedSignals).toContain('testing scope')
	})

	test('detects multi-file scope keywords', () => {
		expect(estimateComplexity('Update multiple files in src/').matchedSignals).toContain('multi-file scope')
		expect(estimateComplexity('Changes across several components').matchedSignals).toContain('multi-file scope')
	})

	test('detects performance/optimization keywords', () => {
		const result = estimateComplexity('Optimize the query performance')
		expect(result.matchedSignals).toContain('performance/optimization')
	})

	test('detects security keywords', () => {
		const result = estimateComplexity('Fix the authentication vulnerability')
		expect(result.matchedSignals).toContain('security concerns')
	})

	test('detects database work keywords', () => {
		const result = estimateComplexity('Add a new database migration for the users schema')
		expect(result.matchedSignals).toContain('database work')
	})

	test('detects bug fix keywords', () => {
		expect(estimateComplexity('Fix the broken login flow').matchedSignals).toContain('bug fix')
		expect(estimateComplexity('Patch the memory leak').matchedSignals).toContain('bug fix')
	})

	test('detects trivial change keywords', () => {
		expect(estimateComplexity('Fix the typo in docs').matchedSignals).toContain('trivial change')
		expect(estimateComplexity('Rename the variable').matchedSignals).toContain('trivial change')
	})

	// ── Custom threshold ──────────────────────────────────────────────────
	test('respects custom threshold', () => {
		const task = 'Implement a new feature with tests'
		const lowThreshold = estimateComplexity(task, 10)
		const highThreshold = estimateComplexity(task, 200)
		expect(lowThreshold.tier).toBe('smart')
		expect(highThreshold.tier).toBe('normal')
		// Score should be the same regardless of threshold
		expect(lowThreshold.score).toBe(highThreshold.score)
	})

	// ── Long description bonus ────────────────────────────────────────────
	test('awards bonus for very long descriptions (>100 words)', () => {
		const shortTask = 'Fix a bug'
		const longTask = Array(101).fill('word').join(' ') + ' fix a bug'
		const shortResult = estimateComplexity(shortTask)
		const longResult = estimateComplexity(longTask)
		expect(longResult.matchedSignals).toContain('long description (>100 words)')
		expect(longResult.score).toBeGreaterThan(shortResult.score)
	})

	test('does not award bonus for short descriptions', () => {
		const result = estimateComplexity('Fix a bug in the login page')
		expect(result.matchedSignals).not.toContain('long description (>100 words)')
	})

	// ── Empty/missing input ───────────────────────────────────────────────
	test('returns zero score and normal tier for empty string', () => {
		const result = estimateComplexity('')
		expect(result.score).toBe(0)
		expect(result.tier).toBe('normal')
		expect(result.matchedSignals).toEqual([])
	})

	test('returns zero score for undefined-like input', () => {
		// @ts-expect-error — intentionally testing bad input
		const result = estimateComplexity(undefined)
		expect(result.score).toBe(0)
		expect(result.tier).toBe('normal')
	})

	test('returns zero score for null input', () => {
		// @ts-expect-error — intentionally testing bad input
		const result = estimateComplexity(null)
		expect(result.score).toBe(0)
		expect(result.tier).toBe('normal')
	})

	test('returns zero score for numeric input', () => {
		// @ts-expect-error — intentionally testing bad input
		const result = estimateComplexity(42)
		expect(result.score).toBe(0)
		expect(result.tier).toBe('normal')
	})

	// ── Boundary cases ────────────────────────────────────────────────────
	test('score exactly at threshold boundary yields normal tier', () => {
		// Find a task that scores exactly 50 or close
		// "fix" (10) + "implement" (20) + "test" (20) = 50 → NOT > 50 → normal
		const result = estimateComplexity('Fix the bug and add tests', 30)
		// Score is 10 (fix) + 20 (test) = 30, which is NOT > 30 → normal
		expect(result.tier).toBe('normal')
	})

	test('score just above threshold yields smart tier', () => {
		const result = estimateComplexity('Fix the bug and add tests', 29)
		// Score 30 > 29 → smart
		expect(result.tier).toBe('smart')
	})

	test('handles special characters in task description', () => {
		const result = estimateComplexity('Fix the $PATH issue in ~/.config/app.json [urgent!]')
		expect(result).toHaveProperty('score')
		expect(result).toHaveProperty('tier')
	})

	test('zero threshold always yields smart for any non-trivial task', () => {
		const result = estimateComplexity('Fix a bug', 0)
		expect(result.tier).toBe('smart')
	})

	test('very high threshold always yields normal', () => {
		const result = estimateComplexity(
			'Refactor and redesign the entire architecture with full test coverage across multiple files',
			9999
		)
		expect(result.tier).toBe('normal')
	})
})
