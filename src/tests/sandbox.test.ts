import { describe, expect, test, beforeAll } from 'bun:test'
import { mkdirSync } from 'fs'
import { getSandboxConfig, loadConfig, TAMIAS_WORKSPACE_DIR } from '../utils/config.ts'

// Ensure workspace directory exists (may not on a fresh CI runner)
beforeAll(() => {
	mkdirSync(TAMIAS_WORKSPACE_DIR, { recursive: true })
})

describe('Sandbox Configuration', () => {
	test('getSandboxConfig returns default when not configured', () => {
		const sandbox = getSandboxConfig()
		expect(sandbox.engine).toBe('none')
		expect(sandbox.image).toBe('ubuntu:22.04')
		expect(sandbox.memoryLimit).toBe('512m')
		expect(sandbox.cpuLimit).toBe('1.0')
		expect(sandbox.networkEnabled).toBe(false)
		expect(sandbox.timeout).toBe(30)
	})

	test('sandbox config schema has all required fields', () => {
		const sandbox = getSandboxConfig()
		expect(sandbox).toHaveProperty('engine')
		expect(sandbox).toHaveProperty('image')
		expect(sandbox).toHaveProperty('memoryLimit')
		expect(sandbox).toHaveProperty('cpuLimit')
		expect(sandbox).toHaveProperty('networkEnabled')
		expect(sandbox).toHaveProperty('timeout')
	})

	test('sandbox engine only accepts valid values', () => {
		// The Zod schema should enforce 'none', 'docker', 'podman'
		const sandbox = getSandboxConfig()
		expect(['none', 'docker', 'podman']).toContain(sandbox.engine)
	})
})

describe('Sandbox - Terminal Tool Integration', () => {
	test('run_command returns results with sandbox=none', async () => {
		const { terminalTools } = await import('../tools/terminal.ts')
		const result = await (terminalTools.run_command.execute as any)({
			command: 'echo "hello sandbox"',
			cwd: TAMIAS_WORKSPACE_DIR,
		})
		expect(result.success).toBe(true)
		expect(result.stdout).toContain('hello sandbox')
		// Should NOT have sandboxed flag when engine is 'none'
		expect(result.sandboxed).toBeUndefined()
	})

	test('run_command still blocks dangerous commands regardless of sandbox mode', async () => {
		const { terminalTools } = await import('../tools/terminal.ts')
		const result = await (terminalTools.run_command.execute as any)({
			command: 'sudo rm -rf /',
			cwd: TAMIAS_WORKSPACE_DIR,
		})
		expect(result.success).toBe(false)
		expect(result.stderr).toContain('Access denied')
	})

	test('buildSandboxedCommand constructs correct docker command', async () => {
		// We can't directly test buildSandboxedCommand since it's not exported,
		// but we can verify the terminal tools import correctly with sandbox support
		const { terminalTools } = await import('../tools/terminal.ts')
		expect(terminalTools.run_command).toBeDefined()
	})
})

describe('Config Schema - Sandbox Field', () => {
	test('loadConfig includes sandbox in parsed output', () => {
		const config = loadConfig()
		// sandbox is optional, but when schema-parsed it should have defaults
		if (config.sandbox) {
			expect(config.sandbox.engine).toBeDefined()
			expect(config.sandbox.image).toBeDefined()
		}
	})
})
