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
			'restart',
			'status',
			'chat',
			'config',
			'history',
			'usage',
			'cron',
			'agents',
			'models',
			'tools',
			'channels',
			'emails',
			'workspace',
			'doctor'
		]

		for (const cmd of commands) {
			expect(result.stdout).toContain(cmd)
		}
	})

	test('stop command is a top-level command, not a subcommand of history', () => {
		// history help should NOT contain 'stop' in its commands section
		const result = runHelp(['history'])
		expect(result.status).toBe(0)

		// Commander help output usually lists subcommands under "Commands:"
		// We want to make sure 'stop' isn't one of them.
		const commandsSection = result.stdout.split('Commands:')[1] || ''
		expect(commandsSection).not.toContain('stop')

		// But the main help SHOULD contain it
		const mainResult = runHelp()
		expect(mainResult.stdout).toContain('stop')
	})

	test('start command is present and has expected options', () => {
		const result = runHelp(['start'])
		expect(result.status).toBe(0)
		expect(result.stdout).toContain('--daemon')
		expect(result.stdout).toContain('--verbose')
	})
})
