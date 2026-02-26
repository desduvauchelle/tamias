import { describe, expect, test } from 'bun:test'
import { getContextVariables, injectDynamicVariables, buildSystemPrompt, scaffoldFromTemplates } from '../utils/memory.ts'

describe('Dynamic Prompting - Context Variables', () => {
	test('getContextVariables returns all expected keys', () => {
		const vars = getContextVariables()
		const expectedKeys = [
			'date', 'time', 'datetime', 'day_of_week', 'month', 'year',
			'timestamp', 'timezone', 'tenant_id', 'active_project',
			'active_channel', 'tamias_version', 'platform', 'system_load',
			'memory_free', 'memory_total', 'home_dir', 'tamias_dir',
		]
		for (const key of expectedKeys) {
			expect(vars).toHaveProperty(key)
			expect(typeof vars[key]).toBe('string')
		}
	})

	test('date format is YYYY-MM-DD', () => {
		const vars = getContextVariables()
		expect(vars.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	test('time format is HH:MM', () => {
		const vars = getContextVariables()
		expect(vars.time).toMatch(/^\d{2}:\d{2}$/)
	})

	test('day_of_week is valid', () => {
		const vars = getContextVariables()
		const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
		expect(validDays).toContain(vars.day_of_week)
	})

	test('platform includes os info', () => {
		const vars = getContextVariables()
		expect(vars.platform).toContain('/')
	})

	test('system_load ends with %', () => {
		const vars = getContextVariables()
		expect(vars.system_load).toMatch(/\d+%/)
	})

	test('memory values end with GB', () => {
		const vars = getContextVariables()
		expect(vars.memory_free).toMatch(/[\d.]+GB/)
		expect(vars.memory_total).toMatch(/[\d.]+GB/)
	})

	test('channel parameter is reflected', () => {
		const vars = getContextVariables('discord')
		expect(vars.active_channel).toBe('discord')
	})

	test('default channel is terminal', () => {
		const vars = getContextVariables()
		expect(vars.active_channel).toBe('terminal')
	})

	test('tamias_version is not "unknown"', () => {
		const vars = getContextVariables()
		// In test env it should read package.json
		expect(vars.tamias_version).not.toBe('unknown')
	})
})

describe('Dynamic Prompting - Variable Injection', () => {
	test('replaces known variables', () => {
		const result = injectDynamicVariables('Today is {{date}}, a {{day_of_week}}.', {
			date: '2025-01-15',
			day_of_week: 'Wednesday',
		})
		expect(result).toBe('Today is 2025-01-15, a Wednesday.')
	})

	test('leaves unknown variables untouched', () => {
		const result = injectDynamicVariables('Hello {{unknown_var}}!', {})
		expect(result).toBe('Hello {{unknown_var}}!')
	})

	test('handles multiple replacements of same variable', () => {
		const result = injectDynamicVariables('{{date}} and again {{date}}', { date: '2025-06-01' })
		expect(result).toBe('2025-06-01 and again 2025-06-01')
	})

	test('handles empty content', () => {
		const result = injectDynamicVariables('', { date: '2025-01-01' })
		expect(result).toBe('')
	})

	test('handles content with no variables', () => {
		const result = injectDynamicVariables('No variables here.', { date: '2025-01-01' })
		expect(result).toBe('No variables here.')
	})
})

describe('Dynamic Prompting - buildSystemPrompt Integration', () => {
	test('buildSystemPrompt includes date/time context', () => {
		// Re-scaffold to ensure updated SYSTEM.md template with {{date}} etc.
		scaffoldFromTemplates()
		const prompt = buildSystemPrompt([], '')
		// The SYSTEM.md template has {{date}}, {{time}}, etc. which should be resolved
		expect(prompt).toContain('Date')
		expect(prompt).toContain('Time')
		expect(prompt).not.toContain('{{date}}')
		expect(prompt).not.toContain('{{time}}')
	})

	test('buildSystemPrompt resolves platform variable', () => {
		scaffoldFromTemplates()
		const prompt = buildSystemPrompt([], '')
		// Should not contain raw {{platform}}
		expect(prompt).not.toContain('{{platform}}')
	})

	test('buildSystemPrompt resolves tamias_version', () => {
		scaffoldFromTemplates()
		const prompt = buildSystemPrompt([], '')
		expect(prompt).not.toContain('{{tamias_version}}')
	})
})
