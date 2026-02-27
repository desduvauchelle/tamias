/**
 * AI Tool Adapter
 *
 * Generates AI SDK tool objects from registry operations that have the 'ai' surface.
 * Each operation becomes a tool function under its domain namespace.
 */
import { tool } from 'ai'
import { getOperations } from '../registry'
import type { OperationDef } from '../registry'

// Ensure domain registrations are loaded
import '../domains/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = any

/**
 * Build AI SDK tools from all registry operations visible on the 'ai' surface.
 * Returns a record keyed by operation verb (e.g. "create", "update"), grouped by domain.
 *
 * Usage in toolRegistry.ts:
 *   const agentTools = buildToolsForDomain('agents')
 *   // => { create: tool(...), update: tool(...), remove: tool(...), list: tool(...), show: tool(...) }
 */
export function buildToolsForDomain(domain: string): Record<string, AnyTool> {
	const ops = getOperations({ domain, surface: 'ai' })
	const tools: Record<string, AnyTool> = {}

	for (const op of ops) {
		tools[op.verb] = tool({
			description: `${op.summary}${op.cliCommand ? ` Equivalent to \`${op.cliCommand}\`.` : ''}`,
			inputSchema: op.inputSchema,
			execute: async (input: Record<string, unknown>) => {
				try {
					return await op.handler(input)
				} catch (err: unknown) {
					return { success: false, error: (err as Error).message }
				}
			},
		})
	}

	return tools
}

/**
 * Build AI SDK tools for ALL domains that have 'ai' surface operations.
 * Returns a flat record keyed by "domain__verb" (e.g. "agents__create").
 */
export function buildAllDomainTools(): Record<string, AnyTool> {
	const ops = getOperations({ surface: 'ai' })
	const tools: Record<string, AnyTool> = {}

	for (const op of ops) {
		const key = `${op.domain}__${op.verb}`
		tools[key] = tool({
			description: `${op.summary}${op.cliCommand ? ` Equivalent to \`${op.cliCommand}\`.` : ''}`,
			inputSchema: op.inputSchema,
			execute: async (input: Record<string, unknown>) => {
				try {
					return await op.handler(input)
				} catch (err: unknown) {
					return { success: false, error: (err as Error).message }
				}
			},
		})
	}

	return tools
}
