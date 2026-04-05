/**
 * Tool namespace migration map.
 *
 * Maps old namespace names to their new replacements after the tool
 * reorganisation (20 namespaces → 13).
 *
 * `null` means the old namespace was split across multiple new namespaces
 * and needs special handling (e.g. "tamias" → config, daemon, channels, …).
 */

/** Simple 1:1 renames — old name → new name */
export const TOOL_NAMESPACE_RENAMES: Record<string, string> = {
	terminal: 'files',
	workspace: 'files',
	subagent: 'agents',
	session: 'agents',
	swarm: 'agents',
	browser: 'web',
	websearch: 'web',
	firecrawl: 'web',
	image: 'media',
	pdf: 'media',
	coding_cli: 'files',
	gemini: 'files',
}

/**
 * The old "tamias" namespace was split into these successors.
 * If "tamias" was explicitly disabled, all successors should be disabled.
 */
export const TAMIAS_SUCCESSORS = ['config', 'daemon', 'channels'] as const
