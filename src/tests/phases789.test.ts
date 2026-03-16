/**
 * Tests for Phase 7 (Config), Phase 8 (Token tracking), Phase 9 (Documentation)
 * Updated: config/setup/docs CLI commands removed — testing underlying utils only
 */
import { expect, test, describe } from 'bun:test'

// ── Phase 7: Config utilities ──────────────────────────────────────────────
describe('Config utilities', () => {
	test('loadConfig and saveConfig work', async () => {
		const { loadConfig, saveConfig, invalidateConfigCache } = await import('../utils/config.ts')
		const config = loadConfig()
		expect(config).toBeDefined()
		expect(typeof config).toBe('object')
		// Save and reload
		saveConfig(config)
		invalidateConfigCache()
		const reloaded = loadConfig()
		expect(reloaded).toBeDefined()
	})
})

// ── Phase 8: Enhanced usage endpoint data ───────────────────────────────────
describe('Usage API data', () => {
	test('getEstimatedCost returns a number', async () => {
		const { getEstimatedCost } = await import('../utils/pricing.ts')
		const cost = getEstimatedCost('gpt-4o', 1000, 500)
		expect(typeof cost).toBe('number')
		expect(cost).toBeGreaterThanOrEqual(0)
	})
})

// ── Phase 9: Documentation utilities ────────────────────────────────────────
describe('Documentation generator', () => {
	test('generateDocs produces files', async () => {
		const { generateDocs } = await import('../utils/docs.ts')
		const { mkdtempSync } = await import('fs')
		const { join } = await import('path')
		const { tmpdir } = await import('os')

		const tmpDir = mkdtempSync(join(tmpdir(), 'tamias-docs-test-'))
		const files = generateDocs(tmpDir)

		expect(files.length).toBeGreaterThan(0)
		expect(files).toContain('architecture.md')
	})
})

// ── WhatsApp bridge ─────────────────────────────────────────────────────────
describe('WhatsApp bridge', () => {
	test('WhatsAppBridge class exports exist', async () => {
		const { WhatsAppBridge } = await import('../bridge/channels/whatsapp.ts')
		expect(typeof WhatsAppBridge).toBe('function')
	})

	test('WhatsAppBridge has required IBridge methods', async () => {
		const { WhatsAppBridge } = await import('../bridge/channels/whatsapp.ts')
		const bridge = new WhatsAppBridge('test')
		expect(typeof bridge.initialize).toBe('function')
		expect(typeof bridge.handleDaemonEvent).toBe('function')
		expect(typeof bridge.destroy).toBe('function')
		expect(typeof bridge.getWebhookPath).toBe('function')
		expect(typeof bridge.getVerifyToken).toBe('function')
		expect(bridge.name).toBe('whatsapp:test')
	})
})

// ── Bridge manager WhatsApp lookup ──────────────────────────────────────────
describe('BridgeManager findWhatsAppByWebhookPath', () => {
	test('method exists on BridgeManager', async () => {
		const { BridgeManager } = await import('../bridge/index.ts')
		const manager = new BridgeManager()
		expect(typeof manager.findWhatsAppByWebhookPath).toBe('function')
	})

	test('returns undefined when no bridges registered', async () => {
		const { BridgeManager } = await import('../bridge/index.ts')
		const manager = new BridgeManager()
		const result = manager.findWhatsAppByWebhookPath('/webhook/whatsapp/test')
		expect(result).toBeUndefined()
	})
})

// ── Tool config (from Phase 6) ──────────────────────────────────────────────
describe('Tool config integration', () => {
	test('generateToolGuide returns markdown', async () => {
		const { generateToolGuide } = await import('../utils/toolConfig.ts')
		const guide = generateToolGuide([
			{ name: 'test-tool', description: 'A test tool', functions: ['doStuff'] },
		])
		expect(typeof guide).toBe('string')
		expect(guide).toContain('Tool Reference Guide')
		expect(guide).toContain('test-tool')
	})
})
