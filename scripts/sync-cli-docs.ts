#!/usr/bin/env bun
/**
 * sync-cli-docs.ts
 *
 * Reads the Commander program tree from src/index.ts and generates a
 * Markdown CLI reference.  Then injects it between
 *   <!-- CLI_DOCS_START --> … <!-- CLI_DOCS_END -->
 * markers in every target file.
 *
 * Usage:  bun run scripts/sync-cli-docs.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Command } from 'commander'

// ── Paths (relative to repo root) ──────────────────────────────────────────
const ROOT = join(import.meta.dir, '..')

export const TARGET_FILES = [
	'README.md',
	'src/templates/AGENTS.md',
	'src/templates/SYSTEM.md',
	'docs/index.md',
]

export const START_MARKER = '<!-- CLI_DOCS_START -->'
export const END_MARKER = '<!-- CLI_DOCS_END -->'

// ── Walk Commander tree ────────────────────────────────────────────────────
export interface CmdInfo {
	full: string        // e.g. "tamias agents add"
	description: string
	options: string[]   // e.g. ["--name <name>  Name of the agent"]
	args: string[]      // e.g. ["[nickname]"]
}

export function collectCommands(cmd: Command, prefix = ''): CmdInfo[] {
	const results: CmdInfo[] = []
	const subs = (cmd as any).commands as Command[]

	for (const sub of subs) {
		const full = prefix ? `${prefix} ${sub.name()}` : `tamias ${sub.name()}`
		const desc = sub.description() || ''

		const options: string[] = []
		for (const opt of (sub as any).options ?? []) {
			options.push(`${opt.flags}  ${opt.description || ''}`.trim())
		}

		const args: string[] = []
		for (const arg of (sub as any)._args ?? []) {
			const wrap = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`
			args.push(wrap)
		}

		results.push({ full, description: desc, options, args })

		// Recurse into sub-commands
		const children = collectCommands(sub, full)
		results.push(...children)
	}

	return results
}

// ── Render Markdown ────────────────────────────────────────────────────────
export function renderMarkdown(commands: CmdInfo[]): string {
	const lines: string[] = []
	lines.push('')
	lines.push('## CLI Reference')
	lines.push('')

	// Group by top-level command
	const groups = new Map<string, CmdInfo[]>()

	for (const cmd of commands) {
		// "tamias agents add" → top = "agents"
		const parts = cmd.full.split(' ')
		const top = parts[1] || ''
		if (!groups.has(top)) groups.set(top, [])
		groups.get(top)!.push(cmd)
	}

	for (const [group, cmds] of groups) {
		lines.push(`### \`tamias ${group}\``)
		lines.push('')

		// If the group itself has a description, show it
		const root = cmds.find(c => c.full === `tamias ${group}`)
		if (root?.description) {
			lines.push(`${root.description}`)
			lines.push('')
		}

		// Table of commands
		const hasOpts = cmds.some(c => c.options.length > 0)

		lines.push('| Command | Description |')
		lines.push('|---|---|')

		for (const cmd of cmds) {
			const argsStr = cmd.args.length > 0 ? ' ' + cmd.args.join(' ') : ''
			const optsStr = cmd.options.length > 0 ? ` (${cmd.options.map(o => '`' + o.split('  ')[0] + '`').join(', ')})` : ''
			lines.push(`| \`${cmd.full}${argsStr}\` | ${cmd.description}${optsStr} |`)
		}

		lines.push('')
	}

	return lines.join('\n')
}

// ── Inject into files ──────────────────────────────────────────────────────
export function inject(filePath: string, generated: string): boolean {
	if (!existsSync(filePath)) {
		console.log(`  ⚠️  Skipped (not found): ${filePath}`)
		return false
	}

	const content = readFileSync(filePath, 'utf-8')
	const startIdx = content.indexOf(START_MARKER)
	const endIdx = content.indexOf(END_MARKER)

	if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
		console.log(`  ⚠️  Markers not found in: ${filePath}`)
		return false
	}

	const before = content.slice(0, startIdx + START_MARKER.length)
	const after = content.slice(endIdx)

	const newContent = `${before}\n${generated}\n${after}`

	if (newContent === content) {
		console.log(`  ✓  Already up to date: ${filePath}`)
		return false
	}

	writeFileSync(filePath, newContent, 'utf-8')
	console.log(`  ✅ Updated: ${filePath}`)
	return true
}

// ── Main ───────────────────────────────────────────────────────────────────
if (import.meta.main) {
	const { program } = await import('../src/index.ts')

	console.log('🔄 Syncing CLI docs from Commander definitions...\n')

	const commands = collectCommands(program)
	const markdown = renderMarkdown(commands)

	let updated = 0
	for (const rel of TARGET_FILES) {
		const abs = join(ROOT, rel)
		if (inject(abs, markdown)) updated++
	}

	console.log(`\n✨ Done. ${updated} file(s) updated, ${TARGET_FILES.length - updated} unchanged/skipped.`)
}
