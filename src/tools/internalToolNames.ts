import { getDomains } from '../core/registry.ts'

// Side-effect: ensure all domain operations are registered
import '../core/domains/index.ts'

/**
 * Legacy (non-registry) internal tool namespaces.
 * Domains migrated to the core operation registry are auto-discovered via getDomains()
 * and do NOT need to be listed here.
 */
export const INTERNAL_TOOL_NAMES = [
	'terminal',
	'tamias',
	'email',
	'workspace',
	'gemini',
	'cron',
	'subagent',
	'session',
	'github',
	'image',
	'browser',
	'pdf',
	'memory',
	'swarm',
] as const

export type InternalToolName = (typeof INTERNAL_TOOL_NAMES)[number]

/**
 * Combined list: legacy manual tools + registry-backed domains.
 * Use this everywhere you need the full set of internal tool namespaces.
 * Adding a new core domain file automatically makes it appear here.
 */
export function getAllInternalToolNames(): string[] {
	const registryDomains = getDomains()
	return [...new Set<string>([...INTERNAL_TOOL_NAMES, ...registryDomains])]
}
