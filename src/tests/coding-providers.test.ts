import { describe, test, expect } from 'bun:test'
import { CodingProviderSchema, TamiasConfigSchema, type CodingProvider } from '../utils/config.ts'

describe('CodingProviderSchema', () => {
	const validProvider: CodingProvider = {
		name: 'claude-code',
		enabled: true,
		priority: 1,
		command: 'claude',
		smartModel: 'opus',
		normalModel: 'sonnet',
		autoAcceptFlag: '--permission-mode bypassPermissions',
		outputFlag: '--output-format stream-json -p',
		additionalFlags: '',
		timeout: 600,
		maxRetries: 1,
		complexityThreshold: 50,
	}

	// ── Happy path ─────────────────────────────────────────────────────────
	test('parses a fully specified provider', () => {
		const result = CodingProviderSchema.parse(validProvider)
		expect(result.name).toBe('claude-code')
		expect(result.command).toBe('claude')
		expect(result.smartModel).toBe('opus')
		expect(result.normalModel).toBe('sonnet')
		expect(result.timeout).toBe(600)
		expect(result.priority).toBe(1)
	})

	test('parses minimal provider with defaults', () => {
		const result = CodingProviderSchema.parse({
			name: 'aider',
			command: 'aider',
		})
		expect(result.enabled).toBe(true)
		expect(result.priority).toBe(0)
		expect(result.timeout).toBe(300)
		expect(result.maxRetries).toBe(1)
		expect(result.complexityThreshold).toBe(50)
		expect(result.smartModel).toBeUndefined()
		expect(result.normalModel).toBeUndefined()
	})

	// ── Validation errors ─────────────────────────────────────────────────
	test('rejects provider without name', () => {
		expect(() => CodingProviderSchema.parse({ command: 'claude' })).toThrow()
	})

	test('rejects provider without command', () => {
		expect(() => CodingProviderSchema.parse({ name: 'test' })).toThrow()
	})

	test('rejects empty name string', () => {
		expect(() => CodingProviderSchema.parse({ name: '', command: 'x' })).toThrow()
	})

	test('rejects empty command string', () => {
		expect(() => CodingProviderSchema.parse({ name: 'x', command: '' })).toThrow()
	})

	test('rejects negative timeout', () => {
		expect(() => CodingProviderSchema.parse({
			name: 'x', command: 'x', timeout: -1,
		})).toThrow()
	})

	test('rejects negative maxRetries', () => {
		expect(() => CodingProviderSchema.parse({
			name: 'x', command: 'x', maxRetries: -1,
		})).toThrow()
	})

	// ── Boundary cases ────────────────────────────────────────────────────
	test('accepts timeout of 1 second', () => {
		const result = CodingProviderSchema.parse({
			name: 'fast', command: 'fast', timeout: 1,
		})
		expect(result.timeout).toBe(1)
	})

	test('accepts maxRetries of 0 (no retries)', () => {
		const result = CodingProviderSchema.parse({
			name: 'noretry', command: 'x', maxRetries: 0,
		})
		expect(result.maxRetries).toBe(0)
	})

	test('accepts complexityThreshold of 0', () => {
		const result = CodingProviderSchema.parse({
			name: 'always-smart', command: 'x', complexityThreshold: 0,
		})
		expect(result.complexityThreshold).toBe(0)
	})
})

describe('TamiasConfigSchema codingProviders field', () => {
	const minimalConfig = {
		version: '1.0' as const,
		connections: {},
		bridges: { terminal: { enabled: true } },
	}

	test('accepts config without codingProviders', () => {
		const result = TamiasConfigSchema.parse(minimalConfig)
		expect(result.codingProviders).toBeUndefined()
	})

	test('accepts config with empty codingProviders array', () => {
		const result = TamiasConfigSchema.parse({
			...minimalConfig,
			codingProviders: [],
		})
		expect(result.codingProviders).toEqual([])
	})

	test('accepts config with one provider', () => {
		const result = TamiasConfigSchema.parse({
			...minimalConfig,
			codingProviders: [{
				name: 'claude-code',
				command: 'claude',
				smartModel: 'opus',
				normalModel: 'sonnet',
			}],
		})
		expect(result.codingProviders).toHaveLength(1)
		expect(result.codingProviders![0].name).toBe('claude-code')
	})

	test('accepts config with multiple providers in priority order', () => {
		const result = TamiasConfigSchema.parse({
			...minimalConfig,
			codingProviders: [
				{ name: 'claude-code', command: 'claude', priority: 1 },
				{ name: 'copilot', command: 'gh copilot', priority: 2 },
				{ name: 'aider', command: 'aider', priority: 3 },
			],
		})
		expect(result.codingProviders).toHaveLength(3)
	})

	test('rejects invalid provider in array', () => {
		expect(() => TamiasConfigSchema.parse({
			...minimalConfig,
			codingProviders: [{ name: '', command: '' }],
		})).toThrow()
	})
})
