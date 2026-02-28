import pc from 'picocolors'
import { buildSystemPrompt, isOnboarded } from '../utils/memory.ts'
import { loadSkills } from '../utils/skills.ts'

/**
 * tamias prompt [--raw]
 *
 * Prints the fully assembled system prompt to stdout so you can inspect exactly
 * what the AI sees on its first turn. Useful for debugging persona, memory,
 * skill catalog, and environment section contents.
 */
export async function runPromptCommand(opts: { raw?: boolean } = {}) {
	if (!isOnboarded()) {
		console.error(pc.red('Not yet onboarded. Run `tamias onboarding` first.'))
		process.exit(1)
	}

	// Ensure skills are loaded so the catalog section is populated
	await loadSkills()

	const prompt = buildSystemPrompt(
		undefined, // no session summary
		undefined, // no channel
		undefined, // no agent dir
		{
			cwd: process.cwd(),
		},
	)

	if (opts.raw) {
		console.log(prompt)
		return
	}

	// Pretty-print with section headers highlighted
	const lines = prompt.split('\n')
	const output = lines.map(line => {
		// H1 headings (## SECTION NAME) — bold + magenta
		if (/^# /.test(line)) return pc.bold(pc.magenta(line))
		// H2 headings — bold + cyan
		if (/^## /.test(line)) return pc.bold(pc.cyan(line))
		// H3 headings — cyan
		if (/^### /.test(line)) return pc.cyan(line)
		// Horizontal rules
		if (/^---+$/.test(line.trim())) return pc.dim(line)
		// Key-value lines like "- **Key:** value"
		if (/^- \*\*/.test(line)) return line.replace(/\*\*([^*]+)\*\*/g, (_, g) => pc.bold(g))
		// Code blocks
		if (line.startsWith('```')) return pc.dim(line)
		return line
	}).join('\n')

	console.log('')
	console.log(pc.bold(pc.bgMagenta(pc.black(' 🐿️  Tamias — System Prompt Preview '))))
	console.log('')
	console.log(output)
	console.log('')
	console.log(pc.dim(`Total characters: ${prompt.length} | Estimated tokens: ~${Math.ceil(prompt.length / 4)}`))
	console.log('')
}
