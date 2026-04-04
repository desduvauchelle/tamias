import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
	buildCliArgs,
	isCommandAvailable,
	PROVIDER_PRESETS,
	type ProviderPreset,
} from '../tools/codingCli.ts'
import type { CodingProvider } from '../utils/config.ts'

// ─── buildCliArgs ──────────────────────────────────────────────────────────

describe('buildCliArgs', () => {
	const baseProvider: CodingProvider = {
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

	// ── Happy path ─────────────────────────────────────────────────────
	test('builds args with smart model for Claude Code', () => {
		const args = buildCliArgs(baseProvider, 'Fix the login bug', 'smart')
		expect(args).toContain('--permission-mode')
		expect(args).toContain('bypassPermissions')
		expect(args).toContain('--model')
		expect(args).toContain('opus')
		expect(args).toContain('Fix the login bug')
		expect(args[args.length - 1]).toBe('Fix the login bug')
	})

	test('builds args with normal model for Claude Code', () => {
		const args = buildCliArgs(baseProvider, 'Fix a typo', 'normal')
		expect(args).toContain('--model')
		expect(args).toContain('sonnet')
		expect(args).not.toContain('opus')
	})

	test('includes output flag tokens', () => {
		const args = buildCliArgs(baseProvider, 'task', 'normal')
		expect(args).toContain('--output-format')
		expect(args).toContain('stream-json')
		expect(args).toContain('-p')
	})

	test('includes additional flags', () => {
		const provider: CodingProvider = {
			...baseProvider,
			additionalFlags: '--verbose --no-cache',
		}
		const args = buildCliArgs(provider, 'task', 'normal')
		expect(args).toContain('--verbose')
		expect(args).toContain('--no-cache')
	})

	// ── Minimal provider ──────────────────────────────────────────────
	test('builds args for provider with no optional flags', () => {
		const minimal: CodingProvider = {
			name: 'bare',
			enabled: true,
			priority: 1,
			command: 'some-cli',
			timeout: 60,
			maxRetries: 0,
			complexityThreshold: 50,
		}
		const args = buildCliArgs(minimal, 'do something', 'normal')
		// Should just have the task prompt
		expect(args).toEqual(['do something'])
	})

	test('omits --model when model alias is empty string', () => {
		const provider: CodingProvider = {
			...baseProvider,
			smartModel: '',
			normalModel: '',
		}
		const args = buildCliArgs(provider, 'task', 'smart')
		expect(args).not.toContain('--model')
	})

	test('omits --model when model alias is undefined', () => {
		const provider: CodingProvider = {
			...baseProvider,
			smartModel: undefined,
			normalModel: undefined,
		}
		const args = buildCliArgs(provider, 'task', 'smart')
		expect(args).not.toContain('--model')
	})

	// ── Task is always last ───────────────────────────────────────────
	test('task prompt is always the last argument', () => {
		const args = buildCliArgs(baseProvider, 'my task description', 'smart')
		expect(args[args.length - 1]).toBe('my task description')
	})

	// ── Edge cases ────────────────────────────────────────────────────
	test('handles task with special characters', () => {
		const args = buildCliArgs(baseProvider, 'Fix the $PATH issue in "config.ts"', 'normal')
		expect(args[args.length - 1]).toBe('Fix the $PATH issue in "config.ts"')
	})

	test('handles empty autoAcceptFlag', () => {
		const provider: CodingProvider = { ...baseProvider, autoAcceptFlag: '' }
		const args = buildCliArgs(provider, 'task', 'normal')
		// Should not have empty string tokens
		expect(args.filter(a => a === '')).toEqual([])
	})
})

// ─── isCommandAvailable ────────────────────────────────────────────────────

describe('isCommandAvailable', () => {
	test('returns true for a known command (echo)', () => {
		expect(isCommandAvailable('which echo')).toBe(true)
	})

	test('returns false for a non-existent command', () => {
		expect(isCommandAvailable('which nonexistent_command_xyz_123')).toBe(false)
	})

	test('returns true for sh -c true', () => {
		expect(isCommandAvailable('true')).toBe(true)
	})

	test('returns false for sh -c false', () => {
		expect(isCommandAvailable('false')).toBe(false)
	})
})

// ─── PROVIDER_PRESETS ──────────────────────────────────────────────────────

describe('PROVIDER_PRESETS', () => {
	test('has at least 3 presets', () => {
		expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(3)
	})

	test('claude-code preset has correct structure', () => {
		const claude = PROVIDER_PRESETS.find(p => p.name === 'claude-code')
		expect(claude).toBeDefined()
		expect(claude!.command).toBe('claude')
		expect(claude!.smartModel).toBe('opus')
		expect(claude!.normalModel).toBe('sonnet')
		expect(claude!.autoAcceptFlag).toContain('bypassPermissions')
		expect(claude!.detectCommand).toBe('which claude')
	})

	test('copilot-cli preset has correct structure', () => {
		const copilot = PROVIDER_PRESETS.find(p => p.name === 'copilot-cli')
		expect(copilot).toBeDefined()
		expect(copilot!.command).toBe('gh copilot')
	})

	test('aider preset has correct structure', () => {
		const aider = PROVIDER_PRESETS.find(p => p.name === 'aider')
		expect(aider).toBeDefined()
		expect(aider!.command).toBe('aider')
		expect(aider!.autoAcceptFlag).toContain('--yes')
	})

	test('all presets have required fields', () => {
		for (const preset of PROVIDER_PRESETS) {
			expect(preset.name).toBeTruthy()
			expect(preset.displayName).toBeTruthy()
			expect(preset.command).toBeTruthy()
			expect(preset.detectCommand).toBeTruthy()
			expect(typeof preset.timeout).toBe('number')
			expect(preset.timeout).toBeGreaterThan(0)
		}
	})

	test('all presets have unique names', () => {
		const names = PROVIDER_PRESETS.map(p => p.name)
		expect(new Set(names).size).toBe(names.length)
	})
})
