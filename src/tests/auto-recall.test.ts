import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test'

/**
 * Tests for the auto-recall feature in aiService.ts.
 *
 * The auto-recall block runs on every user message (except sub-agents),
 * builds a composite query from the current message + session context,
 * and prepends relevant vector memories into projectContext.
 */

// ─── Mock vector store ──────────────────────────────────────────────────────

let mockSearchResults: { entry: { text: string; source: string; tags: string[]; createdAt: string; id: string }; score: number }[] = []
let mockCount = 0
let lastSearchQuery = ''
let lastSearchTopK = 0
let lastSearchMinScore = 0
let vectorStoreEnabled = true

const mockVectorStore = {
	get count() { return mockCount },
	search: async (query: string, topK: number, minScore: number) => {
		lastSearchQuery = query
		lastSearchTopK = topK
		lastSearchMinScore = minScore
		return mockSearchResults
	},
}

mock.module('../utils/vectors', () => ({
	getVectorStore: async () => mockVectorStore,
	resetVectorStore: () => {},
}))

mock.module('../utils/config', () => ({
	getVectorStoreConfig: () => ({ enabled: vectorStoreEnabled }),
	TAMIAS_DIR: '/tmp/tamias-test',
	loadConfig: () => ({}),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

interface AutoRecallContext {
	session: {
		isSubagent?: boolean
		channelName?: string
		name?: string
		agentSlug?: string
		projectSlug?: string
		messages: { role: string; content: string }[]
	}
	job: { content: string }
	projectContext?: string
}

/**
 * Simulate the auto-recall block from aiService.ts.
 * This is extracted from the actual code to test in isolation.
 */
async function runAutoRecall(ctx: AutoRecallContext): Promise<string | undefined> {
	let projectContext = ctx.projectContext
	const { session, job } = ctx

	if (!session.isSubagent) {
		try {
			const { getVectorStore } = await import('../utils/vectors')
			const { getVectorStoreConfig } = await import('../utils/config')
			const vsCfg = getVectorStoreConfig()
			if (vsCfg.enabled) {
				const vs = await getVectorStore()
				if (vs.count > 0) {
					const queryParts: string[] = []
					const msgText = typeof job.content === 'string' ? job.content.trim() : ''
					if (msgText) queryParts.push(msgText)
					if (session.channelName) queryParts.push(session.channelName)
					if (session.name && !session.name.startsWith('sess_')) queryParts.push(session.name)
					if (session.agentSlug) queryParts.push(`agent: ${session.agentSlug}`)
					if (session.projectSlug) queryParts.push(`project: ${session.projectSlug}`)

					const query = queryParts.join(' | ')
					if (query.length > 0) {
						const hits = await vs.search(query, 5, 0.3)
						if (hits.length > 0) {
							const recalledBlock = [
								'## Recalled Memories (auto-retrieved)',
								...hits.map(h =>
									`- [${h.entry.source}] ${h.entry.text} ` +
									`(score: ${(h.score * 100).toFixed(0)}%, ` +
									`tags: ${h.entry.tags.length > 0 ? h.entry.tags.join(', ') : 'none'}, ` +
									`date: ${h.entry.createdAt.split('T')[0]})`
								)
							].join('\n')
							projectContext = projectContext
								? recalledBlock + '\n\n---\n\n' + projectContext
								: recalledBlock
						}
					}
				}
			}
		} catch { /* non-fatal */ }
	}

	return projectContext
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Auto-recall — fires on every message', () => {
	beforeEach(() => {
		mockSearchResults = []
		mockCount = 0
		lastSearchQuery = ''
		lastSearchTopK = 0
		lastSearchMinScore = 0
		vectorStoreEnabled = true
	})

	test('runs auto-recall and injects results into projectContext', async () => {
		mockCount = 10
		mockSearchResults = [
			{
				entry: { id: 'mem_1', text: 'User prefers dark mode', source: 'conversation', tags: ['preference'], createdAt: '2026-04-01T10:00:00Z' },
				score: 0.85,
			},
		]

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'hello' }] },
			job: { content: 'How do I enable dark mode?' },
		})

		expect(result).toContain('## Recalled Memories (auto-retrieved)')
		expect(result).toContain('User prefers dark mode')
		expect(result).toContain('score: 85%')
		expect(result).toContain('tags: preference')
		expect(result).toContain('date: 2026-04-01')
		expect(result).toContain('[conversation]')
	})

	test('uses job.content (current message) for query, not first message', async () => {
		mockCount = 10
		mockSearchResults = []

		await runAutoRecall({
			session: {
				messages: [
					{ role: 'user', content: 'first question about cooking' },
					{ role: 'assistant', content: 'here is a recipe' },
					{ role: 'user', content: 'now tell me about Discord' },
				],
			},
			job: { content: 'now tell me about Discord' },
		})

		expect(lastSearchQuery).toContain('now tell me about Discord')
		expect(lastSearchQuery).not.toContain('cooking')
	})

	test('fires on second and subsequent messages (not just first)', async () => {
		mockCount = 10
		mockSearchResults = []

		await runAutoRecall({
			session: {
				messages: [
					{ role: 'user', content: 'first msg' },
					{ role: 'assistant', content: 'reply' },
					{ role: 'user', content: 'second msg' },
					{ role: 'assistant', content: 'reply 2' },
					{ role: 'user', content: 'third msg' },
				],
			},
			job: { content: 'third msg' },
		})

		// It should have called search (lastSearchQuery would be set)
		expect(lastSearchQuery).toContain('third msg')
	})

	test('includes channelName, session name, agentSlug, projectSlug in composite query', async () => {
		mockCount = 5
		mockSearchResults = []

		await runAutoRecall({
			session: {
				messages: [{ role: 'user', content: 'check status' }],
				channelName: 'discord:main',
				name: 'Project Review',
				agentSlug: 'devops',
				projectSlug: 'tamias',
			},
			job: { content: 'check status' },
		})

		expect(lastSearchQuery).toContain('check status')
		expect(lastSearchQuery).toContain('discord:main')
		expect(lastSearchQuery).toContain('Project Review')
		expect(lastSearchQuery).toContain('agent: devops')
		expect(lastSearchQuery).toContain('project: tamias')
	})

	test('excludes auto-generated session names (starting with sess_)', async () => {
		mockCount = 5
		mockSearchResults = []

		await runAutoRecall({
			session: {
				messages: [{ role: 'user', content: 'hello' }],
				name: 'sess_abc123',
			},
			job: { content: 'hello' },
		})

		expect(lastSearchQuery).not.toContain('sess_abc123')
	})

	test('uses topK=5 and minScore=0.3', async () => {
		mockCount = 5
		mockSearchResults = []

		await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'test' }] },
			job: { content: 'test' },
		})

		expect(lastSearchTopK).toBe(5)
		expect(lastSearchMinScore).toBe(0.3)
	})

	test('prepends to existing projectContext with separator', async () => {
		mockCount = 10
		mockSearchResults = [
			{
				entry: { id: 'mem_2', text: 'Previous decision', source: 'conversation', tags: [], createdAt: '2026-03-01T10:00:00Z' },
				score: 0.7,
			},
		]

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'test' }] },
			job: { content: 'test' },
			projectContext: 'Existing project info here',
		})

		expect(result).toContain('## Recalled Memories')
		expect(result).toContain('---')
		expect(result).toContain('Existing project info here')
		// Recalled memories should come before existing context
		const recalledIdx = result!.indexOf('Recalled Memories')
		const existingIdx = result!.indexOf('Existing project info')
		expect(recalledIdx).toBeLessThan(existingIdx)
	})
})

describe('Auto-recall — skip conditions', () => {
	beforeEach(() => {
		mockSearchResults = []
		mockCount = 10
		lastSearchQuery = ''
		vectorStoreEnabled = true
	})

	test('does NOT fire for sub-agents', async () => {
		mockSearchResults = [
			{
				entry: { id: 'mem_3', text: 'Should not appear', source: 'test', tags: [], createdAt: '2026-01-01T00:00:00Z' },
				score: 0.9,
			},
		]

		const result = await runAutoRecall({
			session: { isSubagent: true, messages: [{ role: 'user', content: 'do task' }] },
			job: { content: 'do task' },
		})

		expect(result).toBeUndefined()
		expect(lastSearchQuery).toBe('')
	})

	test('does NOT fire when vector store is disabled', async () => {
		vectorStoreEnabled = false

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'test' }] },
			job: { content: 'test' },
		})

		expect(result).toBeUndefined()
		expect(lastSearchQuery).toBe('')
	})

	test('does NOT fire when store is empty (count = 0)', async () => {
		mockCount = 0
		mockSearchResults = [
			{ entry: { id: 'x', text: 'phantom', source: 'test', tags: [], createdAt: '2026-01-01T00:00:00Z' }, score: 0.9 },
		]

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'test' }] },
			job: { content: 'test' },
		})

		expect(result).toBeUndefined()
		expect(lastSearchQuery).toBe('')
	})

	test('returns undefined when no search results match', async () => {
		mockCount = 10
		mockSearchResults = []

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'niche query' }] },
			job: { content: 'niche query' },
		})

		expect(result).toBeUndefined()
	})
})

describe('Auto-recall — edge cases', () => {
	beforeEach(() => {
		mockSearchResults = []
		mockCount = 10
		lastSearchQuery = ''
		vectorStoreEnabled = true
	})

	test('works with very short messages', async () => {
		mockSearchResults = [
			{
				entry: { id: 'mem_4', text: 'Status check procedure', source: 'test', tags: [], createdAt: '2026-01-01T00:00:00Z' },
				score: 0.5,
			},
		]

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'hi' }] },
			job: { content: 'hi' },
		})

		expect(result).toContain('Status check procedure')
		expect(lastSearchQuery).toContain('hi')
	})

	test('handles empty message gracefully when channel context exists', async () => {
		mockSearchResults = []

		await runAutoRecall({
			session: {
				messages: [{ role: 'user', content: '' }],
				channelName: 'telegram:main',
			},
			job: { content: '' },
		})

		// Should still search using channel context
		expect(lastSearchQuery).toContain('telegram:main')
	})

	test('handles entries with no tags', async () => {
		mockCount = 5
		mockSearchResults = [
			{
				entry: { id: 'mem_5', text: 'No tags entry', source: 'note', tags: [], createdAt: '2026-02-15T08:00:00Z' },
				score: 0.6,
			},
		]

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'something' }] },
			job: { content: 'something' },
		})

		expect(result).toContain('tags: none')
	})

	test('handles multiple search results', async () => {
		mockCount = 100
		mockSearchResults = [
			{ entry: { id: 'm1', text: 'First memory', source: 'conversation', tags: ['a'], createdAt: '2026-04-01T00:00:00Z' }, score: 0.9 },
			{ entry: { id: 'm2', text: 'Second memory', source: 'file', tags: ['b', 'c'], createdAt: '2026-03-15T00:00:00Z' }, score: 0.7 },
			{ entry: { id: 'm3', text: 'Third memory', source: 'manual', tags: [], createdAt: '2026-02-01T00:00:00Z' }, score: 0.4 },
		]

		const result = await runAutoRecall({
			session: { messages: [{ role: 'user', content: 'tell me about everything' }] },
			job: { content: 'tell me about everything' },
		})

		expect(result).toContain('First memory')
		expect(result).toContain('Second memory')
		expect(result).toContain('Third memory')
		expect(result).toContain('[conversation]')
		expect(result).toContain('[file]')
		expect(result).toContain('[manual]')
		expect(result).toContain('tags: b, c')
	})
})
