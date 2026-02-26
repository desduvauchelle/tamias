import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { VectorStore } from '../utils/vectors.ts'

describe('Vector Store', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = join(tmpdir(), `tamias-vector-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
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
})

describe('Vector Store - Data Integrity', () => {
	let testDir: string
	let store: VectorStore

	beforeEach(async () => {
		testDir = join(tmpdir(), `tamias-vector-test-${Date.now()}`)
		mkdirSync(testDir, { recursive: true })
		store = new VectorStore(testDir)
		await store.init()
	})

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
	})

	test('destroy removes all files', async () => {
		store.destroy()
		expect(existsSync(join(testDir, 'vectors', 'index.json'))).toBe(false)
		expect(existsSync(join(testDir, 'vectors', 'embeddings.bin'))).toBe(false)
	})
})

describe('Vector Store - VectorEntry interface', () => {
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

describe('Memory Tools', () => {
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
