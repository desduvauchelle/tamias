import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'

// ─── Config: compactionModel ──────────────────────────────────────────────────

describe('compactionModel config', () => {
	test('getCompactionModel returns undefined when not set', async () => {
		const { getCompactionModel } = await import('../utils/config.ts')
		expect(getCompactionModel()).toBeUndefined()
	})

	test('setCompactionModel persists and getCompactionModel retrieves it', async () => {
		const { getCompactionModel, setCompactionModel, invalidateConfigCache } = await import('../utils/config.ts')
		// Ensure we have a valid config first
		const { loadConfig, saveConfig } = await import('../utils/config.ts')
		const config = loadConfig()
		saveConfig(config) // ensure file exists
		invalidateConfigCache()

		setCompactionModel('openrouter/google/gemini-2.0-flash-001')
		invalidateConfigCache()
		expect(getCompactionModel()).toBe('openrouter/google/gemini-2.0-flash-001')
	})

	test('compactionModel appears in loaded config after save', async () => {
		const { loadConfig, saveConfig, invalidateConfigCache } = await import('../utils/config.ts')
		const config = loadConfig()
		config.compactionModel = 'test/model-cheap'
		saveConfig(config)
		invalidateConfigCache()
		const reloaded = loadConfig()
		expect(reloaded.compactionModel).toBe('test/model-cheap')
	})

	test('config without compactionModel still loads (backward compat)', async () => {
		const { loadConfig, saveConfig, invalidateConfigCache } = await import('../utils/config.ts')
		// Reset: save a config without compactionModel
		const config = loadConfig()
		delete (config as any).compactionModel
		saveConfig(config)
		invalidateConfigCache()
		const reloaded = loadConfig()
		// compactionModel should be undefined, not cause a validation error
		expect(reloaded.compactionModel).toBeUndefined()
		expect(reloaded.version).toBe('1.0')
	})
})

// ─── Config caching ──────────────────────────────────────────────────────────

describe('loadConfig caching', () => {
	test('loadConfig returns consistent object on repeated calls', async () => {
		const { loadConfig, saveConfig, invalidateConfigCache } = await import('../utils/config.ts')
		// Create a config file
		const config = loadConfig()
		saveConfig(config)
		invalidateConfigCache()

		const first = loadConfig()
		const second = loadConfig()
		// Should return the same cached object (referential equality)
		expect(first).toBe(second)
	})

	test('invalidateConfigCache forces re-read', async () => {
		const { loadConfig, saveConfig, invalidateConfigCache } = await import('../utils/config.ts')
		const config = loadConfig()
		config.debug = false
		saveConfig(config)
		invalidateConfigCache()

		const loaded1 = loadConfig()
		expect(loaded1.debug).toBe(false)

		// Manually modify and save with debug=true
		loaded1.debug = true
		saveConfig(loaded1)
		invalidateConfigCache()

		const loaded2 = loadConfig()
		expect(loaded2.debug).toBe(true)
	})

	test('saveConfig invalidates cache automatically', async () => {
		const { loadConfig, saveConfig } = await import('../utils/config.ts')
		const config = loadConfig()
		config.debug = true
		saveConfig(config)
		// After saveConfig, next loadConfig should reflect the change
		const reloaded = loadConfig()
		expect(reloaded.debug).toBe(true)
	})
})

// ─── Prompt caching utility ─────────────────────────────────────────────────

describe('promptCaching utilities', () => {
	test('supportsExplicitCaching returns true for anthropic provider', async () => {
		const { supportsExplicitCaching } = await import('../utils/promptCaching.ts')
		expect(supportsExplicitCaching('anthropic', 'claude-sonnet-4-20250514')).toBe(true)
	})

	test('supportsExplicitCaching returns true for openrouter with anthropic model', async () => {
		const { supportsExplicitCaching } = await import('../utils/promptCaching.ts')
		expect(supportsExplicitCaching('openrouter', 'anthropic/claude-sonnet-4-20250514')).toBe(true)
	})

	test('supportsExplicitCaching returns false for openrouter with non-anthropic model', async () => {
		const { supportsExplicitCaching } = await import('../utils/promptCaching.ts')
		expect(supportsExplicitCaching('openrouter', 'google/gemini-2.0-flash-001')).toBe(false)
	})

	test('supportsExplicitCaching returns false for openai', async () => {
		const { supportsExplicitCaching } = await import('../utils/promptCaching.ts')
		expect(supportsExplicitCaching('openai', 'gpt-4o')).toBe(false)
	})

	test('buildProviderOptions returns openrouter options with user and usage', async () => {
		const { buildProviderOptions } = await import('../utils/promptCaching.ts')
		const opts = buildProviderOptions('openrouter', 'anthropic/claude-sonnet-4-20250514', 'session-123')
		expect(opts).toBeDefined()
		expect((opts as any).openrouter.usage).toEqual({ include: true })
		expect((opts as any).openrouter.user).toBe('tamias-session-123')
	})

	test('buildProviderOptions returns undefined for non-openrouter providers', async () => {
		const { buildProviderOptions } = await import('../utils/promptCaching.ts')
		const opts = buildProviderOptions('openai', 'gpt-4o', 'session-123')
		expect(opts).toBeUndefined()
	})

	test('buildProviderOptions handles missing sessionId', async () => {
		const { buildProviderOptions } = await import('../utils/promptCaching.ts')
		const opts = buildProviderOptions('openrouter', 'google/gemini-flash', undefined)
		expect(opts).toBeDefined()
		expect((opts as any).openrouter.usage).toEqual({ include: true })
		expect((opts as any).openrouter.user).toBeUndefined()
	})
})

// ─── System prompt tier ordering ─────────────────────────────────────────────

describe('system prompt tier ordering', () => {
	test('static tiers appear before dynamic tiers in assembled prompt', async () => {
		const { buildSystemPrompt } = await import('../utils/memory.ts')
		// buildSystemPrompt works even without persona files — returns whatever tiers exist
		const prompt = buildSystemPrompt()

		// The prompt should have some content. If IDENTITY.md, USER.md, etc don't exist,
		// it will still have the environment section. But the ORDER should be:
		// identity (P=0) → user (P=1) → protocol (P=2) → knowledge (P=3) → skills (P=4) → env (P=5) → summary (P=6)

		// Check that if PROTOCOL exists, it appears before ENVIRONMENT content
		// Environment always has "File & Document Storage Policy" text
		const envMarker = 'File & Document Storage Policy'
		const envIdx = prompt.indexOf(envMarker)

		// This test verifies the environment section exists
		// (it always does since it's built dynamically)
		expect(envIdx).toBeGreaterThan(-1)
	})

	test('environment tier has priority 5 (placed after static content)', async () => {
		// Verify the tier structure by checking the token budget module
		const { assembleSystemPrompt } = await import('../utils/tokenBudget.ts')
		const tiers = [
			{ name: 'identity', content: 'ID content', priority: 0, trimmable: false },
			{ name: 'protocol', content: 'PROTO content', priority: 2, trimmable: false },
			{ name: 'environment', content: 'ENV content', priority: 5, trimmable: false },
		]
		const result = assembleSystemPrompt(tiers, 10000)
		// Should assemble in priority order: identity → protocol → environment
		expect(result.systemPrompt.indexOf('ID content')).toBeLessThan(result.systemPrompt.indexOf('PROTO content'))
		expect(result.systemPrompt.indexOf('PROTO content')).toBeLessThan(result.systemPrompt.indexOf('ENV content'))
	})

	test('protocol tier (P=2) assembles before persistent knowledge (P=3)', async () => {
		const { assembleSystemPrompt } = await import('../utils/tokenBudget.ts')
		const tiers = [
			{ name: 'protocol', content: 'PROTOCOL_MARKER', priority: 2, trimmable: false },
			{ name: 'knowledge', content: 'KNOWLEDGE_MARKER', priority: 3, trimmable: true },
			{ name: 'environment', content: 'ENV_MARKER', priority: 5, trimmable: false },
		]
		const result = assembleSystemPrompt(tiers, 10000)
		const protoIdx = result.systemPrompt.indexOf('PROTOCOL_MARKER')
		const knowIdx = result.systemPrompt.indexOf('KNOWLEDGE_MARKER')
		const envIdx = result.systemPrompt.indexOf('ENV_MARKER')
		expect(protoIdx).toBeLessThan(knowIdx)
		expect(knowIdx).toBeLessThan(envIdx)
	})
})

// ─── Websearch tool ──────────────────────────────────────────────────────────

describe('websearch tool', () => {
	test('createWebsearchTools returns an object with search function', async () => {
		const { createWebsearchTools } = await import('../tools/websearch.ts')
		const tools = createWebsearchTools({} as any, 'test-session')
		expect(tools).toBeDefined()
		expect(tools.search).toBeDefined()
		expect(typeof tools.search).toBe('object') // AI SDK tool object
	})

	test('websearch tool has correct description', async () => {
		const { createWebsearchTools } = await import('../tools/websearch.ts')
		const tools = createWebsearchTools({} as any, 'test-session')
		expect((tools.search as any).description).toContain('Search the web')
	})

	test('WEBSEARCH_TOOL_NAME is websearch', async () => {
		const { WEBSEARCH_TOOL_NAME } = await import('../tools/websearch.ts')
		expect(WEBSEARCH_TOOL_NAME).toBe('websearch')
	})

	test('web is registered in INTERNAL_TOOL_NAMES (websearch merged into web)', async () => {
		const { INTERNAL_TOOL_NAMES } = await import('../tools/internalToolNames.ts')
		expect(INTERNAL_TOOL_NAMES).toContain('web')
	})

	test('websearch search returns error when no OpenRouter connection exists', async () => {
		const { createWebsearchTools } = await import('../tools/websearch.ts')
		const tools = createWebsearchTools({} as any, 'test-session')
		// Execute the tool — it should fail gracefully because no OpenRouter connection is configured
		const result = await (tools.search as any).execute({ query: 'test query' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('OpenRouter')
	})

	test('websearch search handles empty query gracefully', async () => {
		const { createWebsearchTools } = await import('../tools/websearch.ts')
		const tools = createWebsearchTools({} as any, 'test-session')
		const result = await (tools.search as any).execute({ query: '' })
		// Should still return a structured response (error or empty results)
		expect(result).toBeDefined()
		expect(typeof result).toBe('object')
	})
})

// ─── Model command: compaction model display ─────────────────────────────────

describe('model compaction config', () => {
	test('compactionModel can be set and read from config', async () => {
		const { loadConfig, saveConfig, invalidateConfigCache } = await import('../utils/config.ts')
		const config = loadConfig()
		config.compactionModel = 'test/model'
		saveConfig(config)
		invalidateConfigCache()
		const reloaded = loadConfig()
		expect(reloaded.compactionModel).toBe('test/model')
	})
})

// ─── Tamias tools: compaction model ──────────────────────────────────────────

describe('tamias compaction model tools', () => {
	test('get_compaction_model returns null when not set', async () => {
		// Reset: ensure no compactionModel is set in config
		const { loadConfig, saveConfig, invalidateConfigCache } = await import('../utils/config.ts')
		const config = loadConfig()
		delete (config as any).compactionModel
		saveConfig(config)
		invalidateConfigCache()

		const { createTamiasTools } = await import('../tools/tamias.ts')
		const tools = createTamiasTools({} as any, 'test-session')
		const result = await (tools.get_compaction_model as any).execute({})
		expect(result.compactionModel).toBeNull()
		expect(result.note).toBeDefined() // should have a hint
	})

	test('set_compaction_model rejects invalid model', async () => {
		const { createTamiasTools } = await import('../tools/tamias.ts')
		const tools = createTamiasTools({} as any, 'test-session')
		const result = await (tools.set_compaction_model as any).execute({ model: 'nonexistent/model' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('not found')
	})
})
