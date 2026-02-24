import { describe, expect, test, beforeEach, spyOn } from 'bun:test'
import { join } from 'path'
import { homedir } from 'os'

// We need to import the auditCommand function. Since it's not exported,
// we'll use a trick to test it or we might need to export it for testing.
// Looking at terminal.ts, it's not exported. I should probably export it.

import { terminalTools } from '../tools/terminal.ts'

// For these tests, we'll reach into the internal auditCommand if we can,
// or test it via run_command which calls it.
const { run_command } = terminalTools
import { TAMIAS_WORKSPACE_DIR } from '../utils/config.ts'

describe('Terminal Command Audit', () => {
	const HOME = homedir()
	const TAMIAS_DIR = join(HOME, '.tamias')
	const TAMIAS_ENV_FILE = join(TAMIAS_DIR, '.env')

	test('should allow legitimate commands within workspace', async () => {
		const result = await (run_command.execute as any)({
			command: 'ls ~/.tamias/workspace',
			cwd: TAMIAS_WORKSPACE_DIR
		})
		// We don't care if the command actually succeeds in the environment (it might fail if dir doesn't exist)
		// but we care that it wasn't BLOCKED by the audit.
		// If it was blocked, the error message would start with "Access denied"
		expect(result.stderr).not.toContain('Access denied')
	})

	test('should block clear system path access', async () => {
		const result = await (run_command.execute as any)({ command: 'cat /etc/passwd', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
		expect(result.stderr).toContain('/etc/passwd')
	})

	test('should block privilege escalation', async () => {
		const result = await (run_command.execute as any)({ command: 'sudo apt update', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
		expect(result.stderr).toContain('privilege escalation')
	})

	test('should block secrets file access', async () => {
		const result = await (run_command.execute as any)({ command: `cat ${TAMIAS_ENV_FILE}`, cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
		expect(result.stderr).toContain('secrets file')
	})

	test('should block dangerous redirections to system paths', async () => {
		const result = await (run_command.execute as any)({ command: 'echo "dirty" > /etc/hosts', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
		expect(result.stderr).toContain('/etc/hosts')
	})

	test('should block tee redirection to system paths', async () => {
		const result = await (run_command.execute as any)({ command: 'echo "dirty" | tee /usr/bin/malicious', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
		expect(result.stderr).toContain('/usr/bin/malicious')
	})

	test('should block access to other user directories', async () => {
		const result = await (run_command.execute as any)({ command: 'ls ~/Documents', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
	})

	test('should allow redirection within workspace', async () => {
		const result = await (run_command.execute as any)({
			command: 'echo "test" > ~/.tamias/workspace/test.txt',
			cwd: TAMIAS_WORKSPACE_DIR
		})
		expect(result.stderr).not.toContain('Access denied')
	})

	test('should block bypass attempts with leading spaces', async () => {
		const result = await (run_command.execute as any)({ command: '   sudo ls', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
	})

	test('should block bypass attempts with quotes', async () => {
		const result = await (run_command.execute as any)({ command: 'cat "/etc/passwd"', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
	})

	test('should block access to system libraries', async () => {
		const result = await (run_command.execute as any)({ command: 'ls /lib/system', cwd: TAMIAS_WORKSPACE_DIR })
		expect(result.stderr).toContain('Access denied')
	})
})
