/**
 * Tests for scripts/sync-cli-docs.ts
 *
 * Validates that:
 *  - The Commander tree is walked correctly and produces expected commands
 *  - renderMarkdown() outputs valid Markdown with tables
 *  - inject() replaces content between markers and is idempotent
 *  - All real target files contain the markers
 *  - The generated CLI reference includes every top-level command from index.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { collectCommands, renderMarkdown, inject, START_MARKER, END_MARKER, TARGET_FILES, type CmdInfo } from '../../scripts/sync-cli-docs.ts'

// We import `program` from index.ts — safe because of import.meta.main guard
const { program } = await import('../../src/index.ts')

const ROOT = join(import.meta.dir, '..', '..')

// ── collectCommands ────────────────────────────────────────────────────────
describe('collectCommands', () => {
	let commands: CmdInfo[]

	beforeAll(() => {
		commands = collectCommands(program)
	})

	test('returns a non-empty array of commands', () => {
		expect(commands.length).toBeGreaterThan(0)
	})

	test('every command has a "tamias " prefix', () => {
		for (const cmd of commands) {
			expect(cmd.full).toStartWith('tamias ')
		}
	})

	test('every command has a description', () => {
		for (const cmd of commands) {
			expect(cmd.description.length).toBeGreaterThan(0)
		}
	})

	test('includes known top-level commands', () => {
		const names = commands.map(c => c.full)
		expect(names).toContain('tamias chat')
		expect(names).toContain('tamias start')
		expect(names).toContain('tamias stop')
		expect(names).toContain('tamias status')
		expect(names).toContain('tamias config')
		expect(names).toContain('tamias setup')
		expect(names).toContain('tamias update')
	})

	test('includes subcommands (e.g. agents add, models list)', () => {
		const names = commands.map(c => c.full)
		expect(names).toContain('tamias agents add')
		expect(names).toContain('tamias agents list')
		expect(names).toContain('tamias models list')
		expect(names).toContain('tamias config show')
		expect(names).toContain('tamias channels add')
	})

	test('captures options for commands that have them', () => {
		const start = commands.find(c => c.full === 'tamias start')
		expect(start).toBeDefined()
		expect(start!.options.length).toBeGreaterThan(0)
		expect(start!.options.some(o => o.includes('--daemon'))).toBe(true)
	})

	test('captures arguments for commands that have them', () => {
		const usage = commands.find(c => c.full === 'tamias usage')
		expect(usage).toBeDefined()
		expect(usage!.args.length).toBeGreaterThan(0)
		expect(usage!.args[0]).toBe('[period]')
	})

	test('includes the token command', () => {
		const names = commands.map(c => c.full)
		expect(names).toContain('tamias token')
	})

	test('includes skills subcommands', () => {
		const names = commands.map(c => c.full)
		expect(names).toContain('tamias skills')
		expect(names).toContain('tamias skills list')
		expect(names).toContain('tamias skills add')
	})

	test('includes project subcommands', () => {
		const names = commands.map(c => c.full)
		expect(names).toContain('tamias project')
		expect(names).toContain('tamias project list')
		expect(names).toContain('tamias project create')
	})

	test('includes tenant subcommands', () => {
		const names = commands.map(c => c.full)
		expect(names).toContain('tamias tenant')
		expect(names).toContain('tamias tenant list')
		expect(names).toContain('tamias tenant create')
		expect(names).toContain('tamias tenant switch')
	})
})

// ── renderMarkdown ─────────────────────────────────────────────────────────
describe('renderMarkdown', () => {
	test('produces a string containing "## CLI Reference"', () => {
		const commands = collectCommands(program)
		const md = renderMarkdown(commands)
		expect(md).toContain('## CLI Reference')
	})

	test('contains Markdown table headers', () => {
		const commands = collectCommands(program)
		const md = renderMarkdown(commands)
		expect(md).toContain('| Command | Description |')
		expect(md).toContain('|---|---|')
	})

	test('contains command entries in table rows', () => {
		const commands = collectCommands(program)
		const md = renderMarkdown(commands)
		expect(md).toContain('`tamias chat`')
		expect(md).toContain('`tamias agents add`')
		expect(md).toContain('`tamias start`')
	})

	test('groups commands under ### headers', () => {
		const commands = collectCommands(program)
		const md = renderMarkdown(commands)
		expect(md).toContain('### `tamias config`')
		expect(md).toContain('### `tamias agents`')
		expect(md).toContain('### `tamias models`')
	})

	test('minimal input produces valid output', () => {
		const fakeCmds: CmdInfo[] = [
			{ full: 'tamias foo', description: 'Do foo', options: [], args: [] },
			{ full: 'tamias foo bar', description: 'Do bar', options: ['--baz  Baz flag'], args: ['[qux]'] },
		]
		const md = renderMarkdown(fakeCmds)
		expect(md).toContain('### `tamias foo`')
		expect(md).toContain('| `tamias foo` | Do foo |')
		expect(md).toContain('| `tamias foo bar [qux]` | Do bar (`--baz`) |')
	})
})

// ── inject ─────────────────────────────────────────────────────────────────
describe('inject', () => {
	const tmpDir = join(tmpdir(), `tamias-sync-test-${Date.now()}`)

	beforeAll(() => {
		mkdirSync(tmpDir, { recursive: true })
	})

	test('replaces content between markers', () => {
		const file = join(tmpDir, 'test-inject.md')
		writeFileSync(file, `# Title\n\n${START_MARKER}\nold content\n${END_MARKER}\n\nfooter\n`)

		const result = inject(file, 'NEW CONTENT')
		expect(result).toBe(true)

		const updated = readFileSync(file, 'utf-8')
		expect(updated).toContain('NEW CONTENT')
		expect(updated).not.toContain('old content')
		expect(updated).toContain('# Title')
		expect(updated).toContain('footer')
		expect(updated).toContain(START_MARKER)
		expect(updated).toContain(END_MARKER)
	})

	test('is idempotent (returns false when content unchanged)', () => {
		const file = join(tmpDir, 'test-idempotent.md')
		// Start with different content so the first inject actually changes it
		writeFileSync(file, `${START_MARKER}\nold stuff\n${END_MARKER}\n`)

		// First injection changes the content
		const first = inject(file, 'STABLE')
		expect(first).toBe(true)

		// Second injection with same content — no change
		const second = inject(file, 'STABLE')
		expect(second).toBe(false)
	})

	test('returns false for missing file', () => {
		const result = inject(join(tmpDir, 'nonexistent.md'), 'content')
		expect(result).toBe(false)
	})

	test('returns false when markers are missing', () => {
		const file = join(tmpDir, 'no-markers.md')
		writeFileSync(file, '# Just a file\n\nNo markers here.\n')

		const result = inject(file, 'content')
		expect(result).toBe(false)
	})

	test('returns false when markers are in wrong order', () => {
		const file = join(tmpDir, 'bad-order.md')
		writeFileSync(file, `${END_MARKER}\nbody\n${START_MARKER}\n`)

		const result = inject(file, 'content')
		expect(result).toBe(false)
	})

	test('preserves content before and after markers', () => {
		const file = join(tmpDir, 'preserve.md')
		const before = '# Header\n\nSome intro text.\n\n'
		const after = '\n\n## Footer\n\nClosing text.\n'
		writeFileSync(file, `${before}${START_MARKER}\nplaceholder\n${END_MARKER}${after}`)

		inject(file, 'INJECTED')
		const result = readFileSync(file, 'utf-8')
		expect(result).toStartWith('# Header')
		expect(result).toContain('Some intro text.')
		expect(result).toContain('INJECTED')
		expect(result).toContain('## Footer')
		expect(result).toContain('Closing text.')
	})
})

// ── Target files have markers ──────────────────────────────────────────────
describe('target files contain markers', () => {
	for (const rel of TARGET_FILES) {
		test(`${rel} has both START and END markers`, () => {
			const abs = join(ROOT, rel)
			expect(existsSync(abs)).toBe(true)

			const content = readFileSync(abs, 'utf-8')
			expect(content).toContain(START_MARKER)
			expect(content).toContain(END_MARKER)

			// START must come before END
			expect(content.indexOf(START_MARKER)).toBeLessThan(content.indexOf(END_MARKER))
		})
	}
})

// ── End-to-end: generated content matches what's in the files ──────────────
describe('end-to-end sync consistency', () => {
	test('generated CLI reference is present in README.md', () => {
		const commands = collectCommands(program)
		const md = renderMarkdown(commands)

		const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8')
		const startIdx = readme.indexOf(START_MARKER)
		const endIdx = readme.indexOf(END_MARKER)
		const current = readme.slice(startIdx + START_MARKER.length, endIdx).trim()

		// The content between markers should match what we'd generate
		expect(current).toBe(md.trim())
	})

	test('running inject on README.md is a no-op (already up to date)', () => {
		const commands = collectCommands(program)
		const md = renderMarkdown(commands)

		const result = inject(join(ROOT, 'README.md'), md)
		expect(result).toBe(false) // no change needed
	})
})
