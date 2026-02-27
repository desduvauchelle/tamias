/**
 * Agents AI Tool Module — thin shim.
 *
 * Delegates to the core operation registry via the AI tools adapter.
 * toolRegistry.ts no longer imports this file — registry domains are auto-wired.
 * This file exists only for backward compatibility and direct usage.
 */
import { buildToolsForDomain } from '../core/adapters/ai-tools.ts'

export const AGENTS_TOOL_NAME = 'agents'
export const AGENTS_TOOL_LABEL = '🧬 Agents (create, edit, remove persistent personas)'

export function createAgentsTools() {
	return buildToolsForDomain('agents')
}
