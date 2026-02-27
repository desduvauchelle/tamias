import { describe, expect, test } from 'bun:test'

/**
 * Legacy agents-tools test — confirms the thin shim in src/tools/agents.ts
 * still delegates correctly to the core registry.
 *
 * The real tests are now in core-registry.test.ts, core-domains.test.ts,
 * and core-adapters.test.ts.
 */
describe('Agents Tools (shim delegation)', () => {
	test('createAgentsTools returns registry-backed tools', async () => {
		const { createAgentsTools } = await import('../tools/agents.ts')
		const tools = createAgentsTools()
		const verbs = Object.keys(tools).sort()
		expect(verbs).toEqual(['create', 'list', 'remove', 'show', 'update'])
	})

	test('shim tools work end-to-end', async () => {
		const { createAgentsTools } = await import('../tools/agents.ts')
		const tools = createAgentsTools()
		const result = await (tools.list.execute as any)({})
		expect(result.success).toBe(true)
	})
})
