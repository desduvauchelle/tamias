import { z } from 'zod'
import { registerOperation, getOperation } from '../registry'
import {
	addAgent,
	updateAgent,
	removeAgent,
	loadAgents,
	findAgent,
	getAgentDir,
	type AgentDefinition,
} from '../../utils/agentsStore'

// ── Registration function (idempotent — safe to call after clearRegistry) ─────

export function registerAgentsDomain(): void {
	// Skip if already registered (idempotent guard)
	if (getOperation('agents.create')) return

	registerOperation({
		id: 'agents.create',
		domain: 'agents',
		verb: 'create',
		summary: 'Create a persistent named agent persona',
		description:
			'Registers a new agent identity with its own instructions, model preferences, channel bindings, and tool scoping. ' +
			'The agent is immediately available for handoffs and channel routing after creation. A persona folder is scaffolded automatically.',
		cliCommand: 'tamias agents add',
		inputSchema: z.object({
			name: z.string().min(1).describe('Display name for the agent'),
			slug: z.string().optional().describe('URL-safe slug (auto-derived from name if omitted)'),
			model: z.string().optional().describe('Model override in "nickname/modelId" format'),
			instructions: z.string().min(1).describe('System instructions defining the agent behaviour'),
			channels: z.array(z.string()).optional().describe('Channel IDs this agent is bound to'),
			extraSkills: z.array(z.string()).optional().describe('Extra skill folder names'),
			modelFallbacks: z.array(z.string()).optional().describe('Model fallback chain'),
			allowedTools: z.array(z.string()).optional().describe('Internal tool allowlist'),
			allowedMcpServers: z.array(z.string()).optional().describe('MCP server allowlist'),
		}),
		args: {
			name: { description: 'Display name for the agent', example: 'Urban', required: true },
			slug: { description: 'URL-safe slug (auto-derived from name if omitted)', example: 'urban', required: false },
			model: { description: 'Model override in "nickname/modelId" format', example: 'openai/gpt-4o', required: false },
			instructions: { description: 'System instructions defining the agent behaviour', example: 'You are a UX strategist...', required: true },
			channels: { description: 'Channel IDs this agent is bound to', example: '["1234567890"]', required: false },
			extraSkills: { description: 'Extra skill folder names loaded on top of global skills', example: '["lookup-larry"]', required: false },
			modelFallbacks: { description: 'Ordered model fallback chain if primary fails', example: '["openai/gpt-4o","google/gemini-2.5-flash"]', required: false },
			allowedTools: { description: 'Internal tool allowlist (empty = all allowed)', example: '["terminal","workspace"]', required: false },
			allowedMcpServers: { description: 'MCP server allowlist (empty = all allowed)', example: '["gdrive"]', required: false },
		},
		surfaces: ['cli', 'ai', 'dashboard', 'docs'],
		examples: [
			{ label: 'Create a UX strategist agent', input: { name: 'Urban', instructions: 'You are a UX strategist focused on user flows and heuristics.' } },
		],
		handler: async (input) => {
			const agent = addAgent({
				name: input.name,
				slug: input.slug ?? '',
				model: input.model,
				instructions: input.instructions,
				channels: input.channels,
				extraSkills: input.extraSkills,
				modelFallbacks: input.modelFallbacks,
				allowedTools: input.allowedTools,
				allowedMcpServers: input.allowedMcpServers,
			})
			return { success: true as const, agent, message: `Agent created: ${agent.name} (${agent.slug})` }
		},
	})

	registerOperation({
		id: 'agents.update',
		domain: 'agents',
		verb: 'update',
		summary: 'Update an existing persistent agent',
		description:
			'Modifies one or more fields of an existing agent definition. Only provided fields are overwritten; omitted fields remain unchanged.',
		cliCommand: 'tamias agents edit <id>',
		inputSchema: z.object({
			id: z.string().min(1).describe('Agent ID to update'),
			name: z.string().min(1).optional().describe('New display name'),
			slug: z.string().min(1).optional().describe('New slug'),
			model: z.string().optional().describe('New model override'),
			instructions: z.string().min(1).optional().describe('New instructions'),
			enabled: z.boolean().optional().describe('Enable or disable this agent'),
			channels: z.array(z.string()).optional().describe('Replacement channel bindings'),
			extraSkills: z.array(z.string()).optional().describe('Replacement extra skills'),
			modelFallbacks: z.array(z.string()).optional().describe('Replacement model fallback chain'),
			allowedTools: z.array(z.string()).optional().describe('Replacement internal tool allowlist'),
			allowedMcpServers: z.array(z.string()).optional().describe('Replacement MCP server allowlist'),
		}),
		args: {
			id: { description: 'Agent ID to update', example: 'agent_a1b2', required: true },
			name: { description: 'New display name', example: 'Urban v2', required: false },
			slug: { description: 'New slug', example: 'urban-v2', required: false },
			model: { description: 'New model override', example: 'anthropic/claude-sonnet-4-20250514', required: false },
			instructions: { description: 'New instructions', example: 'Focus on accessibility audits.', required: false },
			enabled: { description: 'Enable or disable this agent', example: 'false', required: false },
			channels: { description: 'Replacement channel bindings', example: '["9876543210"]', required: false },
			extraSkills: { description: 'Replacement extra skills', example: '["audit"]', required: false },
			modelFallbacks: { description: 'Replacement model fallback chain', example: '[]', required: false },
			allowedTools: { description: 'Replacement internal tool allowlist', example: '["terminal"]', required: false },
			allowedMcpServers: { description: 'Replacement MCP server allowlist', example: '[]', required: false },
		},
		surfaces: ['cli', 'ai', 'dashboard', 'docs'],
		handler: async (input) => {
			const { id, ...updates } = input
			const agent = updateAgent(id, updates)
			return { success: true as const, agent, message: `Agent updated: ${agent.name} (${agent.id})` }
		},
	})

	registerOperation({
		id: 'agents.remove',
		domain: 'agents',
		verb: 'remove',
		summary: 'Remove a persistent agent by ID',
		description: 'Permanently deletes an agent definition from the registry. The persona folder is not removed.',
		cliCommand: 'tamias agents rm <id>',
		inputSchema: z.object({
			id: z.string().min(1).describe('Agent ID to remove'),
		}),
		args: {
			id: { description: 'Agent ID to remove', example: 'agent_a1b2', required: true },
		},
		surfaces: ['cli', 'ai', 'dashboard', 'docs'],
		handler: async (input) => {
			removeAgent(input.id)
			return { success: true as const, removedId: input.id, message: 'Agent removed' }
		},
	})

	registerOperation({
		id: 'agents.list',
		domain: 'agents',
		verb: 'list',
		summary: 'List registered persistent agents',
		description: 'Returns all agent definitions with full metadata, optionally filtered to enabled-only.',
		cliCommand: 'tamias agents list',
		inputSchema: z.object({
			enabledOnly: z.boolean().optional().describe('Only return enabled agents'),
		}),
		args: {
			enabledOnly: { description: 'Only return enabled agents', example: 'true', required: false },
		},
		surfaces: ['cli', 'ai', 'dashboard', 'docs'],
		handler: async (input) => {
			const agents = loadAgents()
			const filtered = input.enabledOnly ? agents.filter((a) => a.enabled) : agents
			return { success: true as const, count: filtered.length, agents: filtered }
		},
	})

	registerOperation({
		id: 'agents.show',
		domain: 'agents',
		verb: 'show',
		summary: 'Find an agent by id, slug, or name',
		description: 'Looks up a single agent by any identifier (id, slug, or display name) and returns its full definition.',
		cliCommand: 'tamias agents show <query>',
		inputSchema: z.object({
			query: z.string().min(1).describe('Agent id, slug, or name'),
		}),
		args: {
			query: { description: 'Agent id, slug, or name', example: 'urban', required: true },
		},
		surfaces: ['cli', 'ai', 'dashboard', 'docs'],
		handler: async (input) => {
			const agent = findAgent(input.query)
			if (!agent) return { success: false as const, error: `Agent "${input.query}" not found` }
			return { success: true as const, agent, personaDir: getAgentDir(agent.slug) }
		},
	})
}

// Auto-register on import
registerAgentsDomain()
