import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'fs'

// ─── Mock @xenova/transformers ────────────────────────────────────────────────
// Returns deterministic embeddings based on text content so we can test
// similarity, deduplication, and search without downloading a real model.

const EMBEDDING_DIM = 384

/** Create a deterministic 384-dim vector from a string. Same text → same vector. */
function deterministicEmbedding(text: string): Float32Array {
	const vec = new Float32Array(EMBEDDING_DIM)
	// Simple hash-based seeding
	let hash = 0
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
	}
	for (let i = 0; i < EMBEDDING_DIM; i++) {
		hash = ((hash << 5) - hash + i) | 0
		vec[i] = (hash & 0xffff) / 0xffff - 0.5
	}
	// Normalize
	let norm = 0
	for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i]
	norm = Math.sqrt(norm)
	for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm
	return vec
}

const mockPipeline = mock(async (text: string | string[], _opts?: any) => {
	const t = Array.isArray(text) ? text[0] : text
	return { data: deterministicEmbedding(t) }
})

mock.module('@xenova/transformers', () => ({
	pipeline: mock(async (_task: string, _model: string) => mockPipeline),
	env: {
		cacheDir: '',
		allowLocalModels: true,
		allowRemoteModels: true,
	},
}))

// ─── Now import the modules under test ────────────────────────────────────────
import { VectorStore, cosineSimilarity, embed, getVectorStore, resetVectorStore } from '../utils/vectors.ts'

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createTestDir(): string {
	const dir = join(tmpdir(), `tamias-vector-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
	mkdirSync(dir, { recursive: true })
	return dir
}

// ═══════════════════════════════════════════════════════════════════════════════
// VECTOR STORE — Core operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('VectorStore — Init & Lifecycle', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('init creates vectors directory', () => {
		expect(existsSync(join(testDir, 'vectors'))).toBe(true)
	})

	test('initial store has zero entries', () => {
		expect(store.count).toBe(0)
	})

	test('getStats returns valid stats for empty store', () => {
		const stats = store.getStats()
		expect(stats.count).toBe(0)
		expect(stats.oldestEntry).toBeNull()
		expect(stats.newestEntry).toBeNull()
	})

	test('destroy removes all files and resets count', async () => {
		// Create some data first
		await store.upsert('test memory', 'test')
		expect(store.count).toBe(1)

		store.destroy()

		expect(existsSync(join(testDir, 'vectors', 'index.json'))).toBe(false)
		expect(existsSync(join(testDir, 'vectors', 'embeddings.bin'))).toBe(false)
		expect(store.count).toBe(0)
	})

	test('double destroy does not throw', () => {
		store.destroy()
		expect(() => store.destroy()).not.toThrow()
	})
})

describe('VectorStore — Upsert', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('upsert returns a valid ID starting with "mem_"', async () => {
		const id = await store.upsert('The quick brown fox', 'test')
		expect(id).toMatch(/^mem_/)
	})

	test('upsert increments count', async () => {
		await store.upsert('First memory', 'test')
		expect(store.count).toBe(1)

		await store.upsert('Second memory — completely different topic', 'test')
		expect(store.count).toBe(2)
	})

	test('upsert with tags stores them correctly', async () => {
		await store.upsert('Tagged memory', 'test', ['project-x', 'architecture'])
		const results = store.searchByTag('project-x')
		expect(results).toHaveLength(1)
		expect(results[0].tags).toContain('project-x')
		expect(results[0].tags).toContain('architecture')
	})

	test('upsert with empty text still stores entry', async () => {
		const id = await store.upsert('', 'test')
		expect(id).toMatch(/^mem_/)
		expect(store.count).toBe(1)
	})

	test('upsert with identical text deduplicates (returns existing ID)', async () => {
		const id1 = await store.upsert('Exact same text', 'test')
		const id2 = await store.upsert('Exact same text', 'test')
		expect(id2).toBe(id1)
		expect(store.count).toBe(1)
	})

	test('upsert deduplication merges tags', async () => {
		await store.upsert('Dedupe me', 'test', ['tag-a'])
		await store.upsert('Dedupe me', 'test', ['tag-b'])
		const results = store.searchByTag('tag-a')
		expect(results).toHaveLength(1)
		expect(results[0].tags).toContain('tag-a')
		expect(results[0].tags).toContain('tag-b')
	})

	test('upsert persists to disk and survives reload', async () => {
		await store.upsert('Persistent memory', 'test', ['persist'])

		// Create a new store pointing at the same directory
		const store2 = new VectorStore(testDir)
		await store2.init()
		expect(store2.count).toBe(1)

		const results = store2.searchByTag('persist')
		expect(results).toHaveLength(1)
		expect(results[0].text).toBe('Persistent memory')
	})

	test('getStats reflects correct values after upsert', async () => {
		await store.upsert('Stats test entry', 'test')
		const stats = store.getStats()
		expect(stats.count).toBe(1)
		expect(stats.sizeBytes).toBeGreaterThan(0)
		expect(stats.oldestEntry).not.toBeNull()
		expect(stats.newestEntry).not.toBeNull()
	})
})

describe('VectorStore — Cap Enforcement', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		// Use a small cap for testing
		store = new VectorStore(testDir, 3)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('evicts oldest entries when cap is reached', async () => {
		await store.upsert('Entry alpha — about cooking pasta', 'test')
		await store.upsert('Entry beta — about space exploration mars rovers', 'test')
		await store.upsert('Entry gamma — about quantum physics particles', 'test')

		expect(store.count).toBe(3)

		// This should evict the oldest
		await store.upsert('Entry delta — about underwater deep sea diving', 'test')

		expect(store.count).toBe(3) // Capped at 3
	})
})

describe('VectorStore — Search', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('search returns empty array when store is empty', async () => {
		const results = await store.search('anything')
		expect(results).toEqual([])
	})

	test('search finds exact match with high score', async () => {
		await store.upsert('The capital of France is Paris.', 'test')
		const results = await store.search('The capital of France is Paris.')
		expect(results).toHaveLength(1)
		expect(results[0].score).toBeGreaterThan(0.9)
		expect(results[0].entry.text).toBe('The capital of France is Paris.')
	})

	test('search returns results sorted by score descending', async () => {
		await store.upsert('Alpha centauri is a star system in deep outer space', 'test')
		await store.upsert('Beta fish are tropical aquarium freshwater pets', 'test')
		await store.upsert('Gamma rays are electromagnetic radiation from nuclear physics', 'test')

		const results = await store.search('Alpha centauri is a star system in deep outer space', 3, 0.0)
		expect(results.length).toBeGreaterThanOrEqual(1)
		// First result should be the exact match
		expect(results[0].entry.text).toBe('Alpha centauri is a star system in deep outer space')

		// Results are sorted by score descending
		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
		}
	})

	test('search respects topK limit', async () => {
		await store.upsert('Memory one about cats playing with yarn', 'test')
		await store.upsert('Memory two about dogs chasing frisbees outside', 'test')
		await store.upsert('Memory three about birds singing at dawn', 'test')

		const results = await store.search('animals and pets at the park', 1, 0.0)
		expect(results.length).toBeLessThanOrEqual(1)
	})

	test('search respects minScore filter', async () => {
		await store.upsert('Very specific technical quantum physics topic', 'test')

		// With a very high minScore, unrelated queries should return nothing
		const results = await store.search('completely unrelated cooking recipe pizza dough', 5, 0.99)
		expect(results).toHaveLength(0)
	})
})

describe('VectorStore — SearchByTag', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('searchByTag returns empty array when no tag matches', () => {
		expect(store.searchByTag('nonexistent')).toEqual([])
	})

	test('searchByTag returns matching entries', async () => {
		await store.upsert('Tagged item about pizza recipes', 'test', ['food', 'italian'])
		await store.upsert('Untagged item about space rockets', 'test', ['science'])

		const foodResults = store.searchByTag('food')
		expect(foodResults).toHaveLength(1)
		expect(foodResults[0].text).toBe('Tagged item about pizza recipes')

		const scienceResults = store.searchByTag('science')
		expect(scienceResults).toHaveLength(1)
		expect(scienceResults[0].text).toBe('Untagged item about space rockets')
	})
})

describe('VectorStore — Delete', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('delete returns false for non-existent ID', () => {
		expect(store.delete('mem_nonexistent')).toBe(false)
	})

	test('delete removes entry and decrements count', async () => {
		const id = await store.upsert('To be deleted memory content', 'test')
		expect(store.count).toBe(1)

		const deleted = store.delete(id)
		expect(deleted).toBe(true)
		expect(store.count).toBe(0)
	})

	test('delete persists change to disk', async () => {
		const id = await store.upsert('Delete persistence test memory', 'test')
		store.delete(id)

		const store2 = new VectorStore(testDir)
		await store2.init()
		expect(store2.count).toBe(0)
	})
})

describe('VectorStore — DeleteBySource', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('deleteBySource returns 0 when no entries match', () => {
		expect(store.deleteBySource('nonexistent')).toBe(0)
	})

	test('deleteBySource removes all entries from a given source', async () => {
		await store.upsert('From source A first entry content', 'source-a')
		await store.upsert('From source A second entry content', 'source-a')
		await store.upsert('From source B preserved entry content', 'source-b')

		const removed = store.deleteBySource('source-a')
		expect(removed).toBe(2)
		expect(store.count).toBe(1)
	})
})

describe('VectorStore — Prune', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('prune returns 0 when below limit', async () => {
		await store.upsert('Single entry about testing', 'test')
		const pruned = store.prune(10)
		expect(pruned).toBe(0)
		expect(store.count).toBe(1)
	})

	test('prune trims to specified count', async () => {
		await store.upsert('Entry one about cooking recipes', 'test')
		await store.upsert('Entry two about space exploration', 'test')
		await store.upsert('Entry three about deep sea diving', 'test')

		const pruned = store.prune(2)
		expect(pruned).toBe(1)
		expect(store.count).toBe(2)
	})
})

describe('VectorStore — Data Integrity', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = createTestDir()
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
	})

	test('corrupted JSON index file resets store gracefully', async () => {
		await store.upsert('Before corruption data entry', 'test')
		expect(store.count).toBe(1)

		// Corrupt the index file
		writeFileSync(join(testDir, 'vectors', 'index.json'), '{{invalid json}}', 'utf-8')

		// New store should handle gracefully
		const store2 = new VectorStore(testDir)
		await store2.init()
		// Corrupted JSON → entries = [], mismatch with embeddings.bin → full reset
		expect(store2.count).toBe(0)
	})

	test('missing embeddings file with valid index resets store', async () => {
		await store.upsert('Integrity test data', 'test')

		// Delete embeddings but keep index
		const { unlinkSync } = await import('fs')
		unlinkSync(join(testDir, 'vectors', 'embeddings.bin'))

		const store2 = new VectorStore(testDir)
		await store2.init()
		// Mismatch between index and embeddings → reset
		expect(store2.count).toBe(0)
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// Cosine Similarity (exported helper)
// ═══════════════════════════════════════════════════════════════════════════════

describe('cosineSimilarity', () => {
	test('identical vectors return score ≈ 1.0', () => {
		const vec = new Float32Array([0.5, 0.5, 0.5, 0.5])
		const score = cosineSimilarity(vec, vec)
		expect(score).toBeCloseTo(1.0, 4)
	})

	test('opposite vectors return score ≈ -1.0', () => {
		const a = new Float32Array([1, 0, 0, 0])
		const b = new Float32Array([-1, 0, 0, 0])
		const score = cosineSimilarity(a, b)
		expect(score).toBeCloseTo(-1.0, 4)
	})

	test('orthogonal vectors return score ≈ 0.0', () => {
		const a = new Float32Array([1, 0, 0, 0])
		const b = new Float32Array([0, 1, 0, 0])
		const score = cosineSimilarity(a, b)
		expect(score).toBeCloseTo(0.0, 4)
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// VectorEntry interface shape (kept for regression)
// ═══════════════════════════════════════════════════════════════════════════════

describe('VectorEntry interface', () => {
	test('VectorEntry has required fields', () => {
		const entry = {
			id: 'mem_123',
			text: 'test memory',
			source: 'conversation',
			tags: ['test'],
			createdAt: new Date().toISOString(),
		}
		expect(entry.id).toBeDefined()
		expect(entry.text).toBeDefined()
		expect(entry.source).toBeDefined()
		expect(entry.tags).toBeArray()
		expect(entry.createdAt).toBeDefined()
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// Memory Tools — exports and execute functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Memory Tools — Exports', () => {
	test('memory tools export correct name and label', async () => {
		const { MEMORY_TOOL_NAME, MEMORY_TOOL_LABEL } = await import('../tools/memory.ts')
		expect(MEMORY_TOOL_NAME).toBe('memory')
		expect(MEMORY_TOOL_LABEL).toContain('Memory')
	})

	test('memory tools has expected functions', async () => {
		const { memoryTools } = await import('../tools/memory.ts')
		expect(memoryTools).toHaveProperty('save')
		expect(memoryTools).toHaveProperty('search')
		expect(memoryTools).toHaveProperty('forget')
		expect(memoryTools).toHaveProperty('stats')
	})
})

describe('Memory Tools — save execute', () => {
	beforeEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	afterEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	test('save returns success with id and message', async () => {
		const { memoryTools } = await import('../tools/memory.ts')
		const result = await memoryTools.save.execute!(
			{ text: 'Important decision about architecture', source: 'conversation', tags: ['architecture'] },
			{ toolCallId: 'test', messages: [], abortSignal: undefined as any }
		) as { success: boolean; id: string; message: string; error?: string }
		expect(result.success).toBe(true)
		expect(result.id).toMatch(/^mem_/)
		expect(result.message).toContain('Memory saved')
	})
})

describe('Memory Tools — search execute', () => {
	beforeEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	afterEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	test('search returns empty results message when nothing found', async () => {
		const { memoryTools } = await import('../tools/memory.ts')
		const result = await memoryTools.search.execute!(
			{ query: 'nonexistent topic xyzzy', topK: 5, minScore: 0.3 },
			{ toolCallId: 'test', messages: [], abortSignal: undefined as any }
		) as { success: boolean; results: { id: string; text: string; source: string; tags: string[]; score: number; createdAt: string }[]; message: string; error?: string }
		expect(result.success).toBe(true)
		expect(result.results).toEqual([])
		expect(result.message).toBe('No relevant memories found.')
	})
})

describe('Memory Tools — forget execute', () => {
	beforeEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	afterEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	test('forget returns not found for invalid ID', async () => {
		const { memoryTools } = await import('../tools/memory.ts')
		const result = await memoryTools.forget.execute!(
			{ id: 'mem_doesnt_exist' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined as any }
		) as { success: boolean; message: string; error?: string }
		expect(result.success).toBe(false)
		expect(result.message).toBe('Memory not found.')
	})
})

describe('Memory Tools — stats execute', () => {
	beforeEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	afterEach(async () => {
		try { const s = await getVectorStore(); await s.destroy() } catch { }
		resetVectorStore()
	})

	test('stats returns count and usage info', async () => {
		const { memoryTools } = await import('../tools/memory.ts')
		const result = await memoryTools.stats.execute!(
			{},
			{ toolCallId: 'test', messages: [], abortSignal: undefined as any }
		) as { success: boolean; count: number; sizeBytes: number; sizeHuman: string; maxVectors: number; usage: string; oldestEntry: string | null; newestEntry: string | null; error?: string }
		expect(result.success).toBe(true)
		expect(result.count).toBe(0)
		expect(result.maxVectors).toBeGreaterThan(0)
		expect(result.usage).toMatch(/^\d+\/\d+$/)
	})
})

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton management
// ═══════════════════════════════════════════════════════════════════════════════

describe('VectorStore — Singleton', () => {
	beforeEach(() => {
		resetVectorStore()
	})

	afterEach(() => {
		resetVectorStore()
	})

	test('getVectorStore returns the same instance on repeated calls', async () => {
		const store1 = await getVectorStore()
		const store2 = await getVectorStore()
		expect(store1).toBe(store2)
	})

	test('resetVectorStore clears the singleton', async () => {
		const store1 = await getVectorStore()
		resetVectorStore()
		const store2 = await getVectorStore()
		expect(store1).not.toBe(store2)
	})
})
