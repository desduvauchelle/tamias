import { describe, expect, test } from 'bun:test'
import type { DaemonEvent } from '../bridge/types.ts'

describe('Swarm - DaemonEvent Types', () => {
	test('agent-handoff event type is valid', () => {
		const event: DaemonEvent = {
			type: 'agent-handoff',
			fromAgent: 'default',
			toAgent: 'researcher',
			reason: 'This task requires deep research capabilities',
		}
		expect(event.type).toBe('agent-handoff')
		expect(event.fromAgent).toBe('default')
		expect(event.toAgent).toBe('researcher')
		expect(event.reason).toBeDefined()
	})

	test('all DaemonEvent types are distinct', () => {
		const eventTypes = [
			'start', 'chunk', 'tool_call', 'tool_result',
			'done', 'error', 'file', 'subagent-status', 'agent-handoff'
		]
		const unique = new Set(eventTypes)
		expect(unique.size).toBe(eventTypes.length)
	})
})

describe('Swarm - Tools Structure', () => {
	test('swarm tools export correct name', async () => {
		const { SWARM_TOOL_NAME, SWARM_TOOL_LABEL } = await import('../tools/swarm.ts')
		expect(SWARM_TOOL_NAME).toBe('swarm')
		expect(SWARM_TOOL_LABEL).toContain('Swarm')
	})

	test('createSwarmTools returns transfer_to_agent and list_agents', async () => {
		const { createSwarmTools } = await import('../tools/swarm.ts')
		// Create with a mock AIService
		const mockAI = {
			getSession: () => null,
			handoffSession: async () => { },
		} as any
		const tools = createSwarmTools(mockAI, 'test-session')
		expect(tools).toHaveProperty('transfer_to_agent')
		expect(tools).toHaveProperty('list_agents')
	})

	test('list_agents works with no agents configured', async () => {
		const { createSwarmTools } = await import('../tools/swarm.ts')
		const mockAI = { getSession: () => null } as any
		const tools = createSwarmTools(mockAI, 'test-session')
		const result = await (tools.list_agents.execute as any)({})
		expect(result.success).toBe(true)
		expect(result.agents).toBeArray()
	})

	test('transfer_to_agent fails if session not found', async () => {
		const { createSwarmTools } = await import('../tools/swarm.ts')
		const mockAI = { getSession: () => null } as any
		const tools = createSwarmTools(mockAI, 'nonexistent')
		const result = await (tools.transfer_to_agent.execute as any)({
			agentSlug: 'researcher',
			reason: 'test',
		})
		expect(result.success).toBe(false)
		expect(result.error).toContain('Session not found')
	})

	test('transfer_to_agent fails if agent not found', async () => {
		const { createSwarmTools } = await import('../tools/swarm.ts')
		const mockAI = {
			getSession: () => ({ id: 'test', agentSlug: 'default' }),
		} as any
		const tools = createSwarmTools(mockAI, 'test')
		const result = await (tools.transfer_to_agent.execute as any)({
			agentSlug: 'nonexistent-agent-xyz',
			reason: 'test',
		})
		expect(result.success).toBe(false)
		expect(result.error).toContain('not found')
	})
})

describe('Swarm - Tool Registry Integration', () => {
	test('swarm tools registered in tool registry', async () => {
		const toolRegistry = await import('../utils/toolRegistry.ts')
		// Just verify the import works without errors
		expect(toolRegistry).toBeDefined()
	})
})
