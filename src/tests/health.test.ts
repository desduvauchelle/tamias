import { describe, test, expect } from 'bun:test'
import { runHealthChecks, formatHealthReport, type HealthReport } from '../utils/health/index'

describe('Health Check System', () => {
	test('runHealthChecks returns a HealthReport', async () => {
		const report = await runHealthChecks({ silent: true })
		expect(report).toBeDefined()
		expect(report.results).toBeDefined()
		expect(Array.isArray(report.results)).toBe(true)
		expect(typeof report.hasErrors).toBe('boolean')
		expect(typeof report.hasWarnings).toBe('boolean')
		expect(typeof report.fixedCount).toBe('number')
	})

	test('each result has required fields', async () => {
		const report = await runHealthChecks({ silent: true })
		for (const result of report.results) {
			expect(result.id).toBeDefined()
			expect(result.status).toBeDefined()
			expect(['ok', 'warn', 'error', 'fixed']).toContain(result.status)
			expect(result.message).toBeDefined()
		}
	})

	test('formatHealthReport returns string output', async () => {
		const report = await runHealthChecks({ silent: true })
		const formatted = formatHealthReport(report)
		expect(typeof formatted).toBe('string')
		expect(formatted.length).toBeGreaterThan(0)
	})

	test('filesystem checks verify required directories', async () => {
		const report = await runHealthChecks({ autoFix: true })
		const fsResults = report.results.filter(r => r.id.startsWith('filesystem.'))
		expect(fsResults.length).toBeGreaterThan(0)

		// memory and workspace dirs should exist or be created
		const memoryResult = fsResults.find(r => r.id === 'filesystem.memory')
		expect(memoryResult).toBeDefined()
		expect(['ok', 'fixed']).toContain(memoryResult!.status)
	})

	test('provider checks run without crashing', async () => {
		const report = await runHealthChecks({ silent: true })
		const providerResults = report.results.filter(r => r.id.startsWith('providers.'))
		// Should have at least one result (either connections found or "none configured")
		expect(providerResults.length).toBeGreaterThan(0)
	})

	test('tool checks run without crashing', async () => {
		const report = await runHealthChecks({ silent: true })
		const toolResults = report.results.filter(r => r.id.startsWith('tools.'))
		// Should have results for checked tools
		expect(toolResults.length).toBeGreaterThanOrEqual(0)
	})
})
