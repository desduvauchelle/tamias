/**
 * Tests for per-session workspace isolation.
 *
 * Verifies that:
 *  1. validatePath respects a per-session workspace root override
 *  2. createWorkspaceTools enforces session-specific workspace boundaries
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync, realpathSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { validatePath } from '../utils/path.ts'
import { createWorkspaceTools } from '../tools/workspace.ts'

// ── validatePath with override ────────────────────────────────────────────────

describe('validatePath with workspaceRoot override', () => {
	let tmpDir: string
	let realTmpDir: string

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'tamias-ws-test-'))
		realTmpDir = realpathSync(tmpDir)
	})

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test('resolves relative path within override workspace', () => {
		const result = validatePath('notes.md', tmpDir)
		expect(result).toBe(join(realTmpDir, 'notes.md'))
	})

	test('resolves nested relative path within override workspace', () => {
		const result = validatePath('docs/api.md', tmpDir)
		expect(result).toBe(join(realTmpDir, 'docs', 'api.md'))
	})

	test('allows absolute path inside override workspace', () => {
		const target = join(tmpDir, 'file.ts')
		const result = validatePath(target, tmpDir)
		expect(result).toBe(join(realTmpDir, 'file.ts'))
	})

	test('blocks absolute path outside override workspace', () => {
		expect(() => validatePath('/etc/passwd', tmpDir)).toThrow(/Access denied/)
	})

	test('blocks path traversal attempt (../../)', () => {
		expect(() => validatePath('../../etc/passwd', tmpDir)).toThrow(/Access denied/)
	})

	test('blocks path traversal via absolute path to sibling dir', () => {
		const sibling = tmpDir.replace(/[^/]+$/, 'other-dir')
		expect(() => validatePath(sibling + '/secret', tmpDir)).toThrow(/Access denied/)
	})
})

// ── createWorkspaceTools isolation ────────────────────────────────────────────

/** Helper to call a tool's execute function safely in tests */
async function exec(tool: { execute?: Function }, args: Record<string, unknown>): Promise<any> {
	if (!tool.execute) throw new Error('Tool has no execute function')
	return tool.execute(args, {} as any)
}

describe('createWorkspaceTools per-session workspace', () => {
	let channelADir: string
	let channelBDir: string

	beforeEach(() => {
		channelADir = mkdtempSync(join(tmpdir(), 'tamias-channel-a-'))
		channelBDir = mkdtempSync(join(tmpdir(), 'tamias-channel-b-'))
	})

	afterEach(() => {
		rmSync(channelADir, { recursive: true, force: true })
		rmSync(channelBDir, { recursive: true, force: true })
	})

	test('write_file creates file in session workspace', async () => {
		const tools = createWorkspaceTools(channelADir)
		const result = await exec(tools.write_file, { path: 'hello.txt', content: 'hello' })
		expect(result.success).toBe(true)
		expect(existsSync(join(channelADir, 'hello.txt'))).toBe(true)
	})

	test('write_file rejects path outside session workspace', async () => {
		const tools = createWorkspaceTools(channelADir)
		// channelBDir is outside channelADir
		const result = await exec(tools.write_file, { path: channelBDir + '/evil.txt', content: 'x' })
		expect(result.success).toBe(false)
		expect(result.error).toMatch(/Access denied/)
	})

	test('read_file reads file inside session workspace', async () => {
		writeFileSync(join(channelADir, 'data.txt'), 'channel-a-data')
		const tools = createWorkspaceTools(channelADir)
		const result = await exec(tools.read_file, { path: 'data.txt' })
		expect(result.success).toBe(true)
		expect(result.content).toBe('channel-a-data')
	})

	test('read_file rejects file from different channel workspace', async () => {
		writeFileSync(join(channelBDir, 'secret.txt'), 'channel-b-secret')
		const toolsA = createWorkspaceTools(channelADir)
		const result = await exec(toolsA.read_file, { path: join(channelBDir, 'secret.txt') })
		expect(result.success).toBe(false)
		expect(result.error).toMatch(/Access denied/)
	})

	test('list_dir defaults to session workspace', async () => {
		writeFileSync(join(channelADir, 'project.md'), '# Project')
		const tools = createWorkspaceTools(channelADir)
		const result = await exec(tools.list_dir, { path: '.' })
		expect(result.success).toBe(true)
		const names = result.entries?.map((e: { name: string }) => e.name)
		expect(names).toContain('project.md')
	})

	test('two sessions with different workspace paths are fully isolated', async () => {
		const toolsA = createWorkspaceTools(channelADir)
		const toolsB = createWorkspaceTools(channelBDir)

		// Write different content into each channel workspace
		await exec(toolsA.write_file, { path: 'notes.md', content: '# Channel A' })
		await exec(toolsB.write_file, { path: 'notes.md', content: '# Channel B' })

		// Read back from each — they should be different files
		const readA = await exec(toolsA.read_file, { path: 'notes.md' })
		const readB = await exec(toolsB.read_file, { path: 'notes.md' })

		expect(readA.content).toBe('# Channel A')
		expect(readB.content).toBe('# Channel B')

		// Cross-reading must fail
		const crossRead = await exec(toolsA.read_file, { path: join(channelBDir, 'notes.md') })
		expect(crossRead.success).toBe(false)
	})
})
