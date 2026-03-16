import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * These tests verify the CLI command structure by running the entry point
 * with the --help flag and checking for the presence of required commands.
 * This prevents regressions where commands are accidentally hidden or
 * chained as sub-commands.
 */

describe('CLI Structure', () => {
	const entryPoint = join(import.meta.dir, '../index.ts')

	const runHelp = (args: string[] = []) => {
		return spawnSync('bun', ['run', entryPoint, ...args, '--help'], {
			encoding: 'utf8',
		})
	}

	test('top-level help shows all required commands', () => {
		const result = runHelp()
		expect(result.status).toBe(0)

		const commands = [
			'start',
			'stop',
			'status',
			'doctor',
		]

		for (const cmd of commands) {
			expect(result.stdout).toContain(cmd)
		}
	})

	test('removed commands are no longer present', () => {
		const result = runHelp()
		expect(result.status).toBe(0)

		const removedCommands = [
			'chat',
			'config',
			'setup',
			'onboarding',
			'restart',
			'history',
			'usage',
			'models',
			'tools',
			'channels',
			'emails',
			'workspace',
			'browser',
			'uninstall',
			'backup',
			'restore',
			'readme',
			'prompt',
			'docs',
			'migrate',
			'project',
			'tenant',
			'token',
		]

		for (const cmd of removedCommands) {
			// Commands section should not contain these as registered commands
			const commandsSection = result.stdout.split('Commands:')[1] || ''
			expect(commandsSection).not.toContain(`  ${cmd} `)
		}
	})

	test('start command is present and has expected options', () => {
		const result = runHelp(['start'])
		expect(result.status).toBe(0)
		expect(result.stdout).toContain('--daemon')
		expect(result.stdout).toContain('--verbose')
	})
})
