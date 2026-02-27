/**
 * Docs Adapter
 *
 * Generates markdown documentation from registry operations that have the 'docs' surface.
 * Produces per-domain reference pages and a combined operations catalog.
 */
import { getOperations, getDomains } from '../registry'
import type { OperationDef } from '../registry'

// Ensure domain registrations are loaded
import '../domains/index'

/**
 * Generate a markdown reference for a single domain.
 */
export function generateDomainDocs(domain: string): string {
	const ops = getOperations({ domain, surface: 'docs' })
	if (ops.length === 0) return ''

	const lines: string[] = []
	lines.push(`## ${capitalize(domain)} Operations\n`)

	for (const op of ops) {
		lines.push(`### \`${op.id}\`\n`)
		lines.push(`**${op.summary}**\n`)
		lines.push(op.description + '\n')

		if (op.cliCommand) {
			lines.push(`**CLI equivalent:** \`${op.cliCommand}\`\n`)
		}

		lines.push('**Surfaces:** ' + op.surfaces.map((s) => `\`${s}\``).join(', ') + '\n')

		// Arguments table
		const argEntries = Object.entries(op.args)
		if (argEntries.length > 0) {
			lines.push('| Argument | Required | Description | Example |')
			lines.push('|---|---|---|---|')
			for (const [name, doc] of argEntries) {
				lines.push(
					`| \`${name}\` | ${doc.required ? '✅' : '–'} | ${doc.description} | ${doc.example ? `\`${doc.example}\`` : '–'} |`,
				)
			}
			lines.push('')
		}

		// Examples
		if (op.examples?.length) {
			lines.push('**Examples:**\n')
			for (const ex of op.examples) {
				lines.push(`*${ex.label}*`)
				lines.push('```json')
				lines.push(JSON.stringify(ex.input, null, 2))
				lines.push('```\n')
			}
		}

		if (op.notes) {
			lines.push(`> **Note:** ${op.notes}\n`)
		}

		lines.push('---\n')
	}

	return lines.join('\n')
}

/**
 * Generate a full operations catalog covering all domains.
 */
export function generateFullCatalog(): string {
	const domains = getDomains()
	const lines: string[] = []

	lines.push('# Operations Reference\n')
	lines.push('Auto-generated from the operation registry. Do not edit manually.\n')
	lines.push(`> Generated: ${new Date().toISOString().split('T')[0]}\n`)

	for (const domain of domains.sort()) {
		const section = generateDomainDocs(domain)
		if (section) lines.push(section)
	}

	return lines.join('\n')
}

/**
 * Generate a machine-readable JSON catalog for AI context injection.
 * Contains operation metadata, argument schemas, and descriptions
 * so the AI knows exactly what operations are available and how to call them.
 */
export function generateAICatalog(): object[] {
	const ops = getOperations({ surface: 'ai' })
	return ops.map((op) => ({
		id: op.id,
		domain: op.domain,
		verb: op.verb,
		summary: op.summary,
		description: op.description,
		cliCommand: op.cliCommand,
		args: Object.fromEntries(
			Object.entries(op.args).map(([name, doc]) => [
				name,
				{ description: doc.description, required: doc.required, example: doc.example },
			]),
		),
	}))
}

/**
 * Generate injectable markdown section for README or system prompt.
 * Compact format showing available operations grouped by domain.
 */
export function generateOperationsSummary(): string {
	const domains = getDomains()
	const lines: string[] = []

	lines.push('### Available Operations\n')

	for (const domain of domains.sort()) {
		const ops = getOperations({ domain, surface: 'docs' })
		if (ops.length === 0) continue

		lines.push(`#### ${capitalize(domain)}\n`)
		lines.push('| Operation | CLI | Description |')
		lines.push('|---|---|---|')
		for (const op of ops) {
			lines.push(`| \`${op.id}\` | \`${op.cliCommand ?? '–'}\` | ${op.summary} |`)
		}
		lines.push('')
	}

	return lines.join('\n')
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1)
}
