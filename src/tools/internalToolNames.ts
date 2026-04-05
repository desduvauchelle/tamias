import { getDomains } from '../core/registry.ts'

// Side-effect: ensure all domain operations are registered
import '../core/domains/index.ts'

/**
 * Internal tool namespaces after the reorganisation (20 → 13).
 *
 * Legacy names (terminal, tamias, workspace, subagent, session, swarm, browser,
 * websearch, firecrawl, image, pdf, coding_cli, gemini) have been merged into
 * the new groups below.  Config migration in utils/config.ts translates old
 * internalTools keys automatically.
 *
 * Domains migrated to the core operation registry are auto-discovered via
 * getDomains() and do NOT need to be listed here.
 */
export const INTERNAL_TOOL_NAMES = [
	'config',     // models, connections, tools, MCP servers, secrets, debug
	'daemon',     // status, lifecycle, usage, introspection
	'channels',   // Discord, Telegram, WhatsApp management
	'files',      // file CRUD, shell, search, workspace, coding CLI, gemini
	'skills',     // skill load/save/list/delete
	'memory',     // semantic memory (save, search, forget, stats)
	'web',        // browser automation, web search, scraping
	'media',      // image generation, PDF, carousel, file sending
	'projects',   // project management, kanban, notes
	'github',     // git operations
	'cron',       // scheduled jobs
	'email',      // email list/read/send
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
