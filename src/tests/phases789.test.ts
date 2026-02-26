/**
 * Tests for Phase 7 (CLI improvements), Phase 8 (Token tracking), Phase 9 (Documentation)
 */
import { expect, test, describe } from 'bun:test'

// ── Phase 7: Config show/path commands ─────────────────────────────────────
describe('Config commands', () => {
	test('runConfigShowCommand exports exist', async () => {
		const { runConfigShowCommand, runConfigPathCommand } = await import('../commands/config.ts')
		expect(typeof runConfigShowCommand).toBe('function')
		expect(typeof runConfigPathCommand).toBe('function')
	})

	test('runSetupCommand export exists', async () => {
		const { runSetupCommand } = await import('../commands/setup.ts')
		expect(typeof runSetupCommand).toBe('function')
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

// ── Phase 9: Documentation generator ────────────────────────────────────────
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
		expect(files).toContain('cli-reference.md')
		expect(files).toContain('configuration.md')
		expect(files).toContain('api-reference.md')
		expect(files).toContain('skills.md')
		expect(files).toContain('migrations.md')
	})

	test('generated docs contain expected content', async () => {
		const { generateDocs } = await import('../utils/docs.ts')
		const { mkdtempSync, readFileSync } = await import('fs')
		const { join } = await import('path')
		const { tmpdir } = await import('os')

		const tmpDir = mkdtempSync(join(tmpdir(), 'tamias-docs-content-'))
		generateDocs(tmpDir)

		const arch = readFileSync(join(tmpDir, 'architecture.md'), 'utf-8')
		expect(arch).toContain('Tamias Architecture')
		expect(arch).toContain('AIService')
		expect(arch).toContain('BridgeManager')

		const cli = readFileSync(join(tmpDir, 'cli-reference.md'), 'utf-8')
		expect(cli).toContain('tamias chat')
		expect(cli).toContain('tamias setup')
		expect(cli).toContain('tamias doctor')

		const config = readFileSync(join(tmpDir, 'configuration.md'), 'utf-8')
		expect(config).toContain('WhatsApp Config')
		expect(config).toContain('mode')

		const api = readFileSync(join(tmpDir, 'api-reference.md'), 'utf-8')
		expect(api).toContain('/usage')
		expect(api).toContain('tenantDistribution')
	})

	test('runDocsGenerateCommand export exists', async () => {
		const { runDocsGenerateCommand } = await import('../commands/docs.ts')
		expect(typeof runDocsGenerateCommand).toBe('function')
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
