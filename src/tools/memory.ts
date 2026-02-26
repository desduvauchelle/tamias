import { tool } from 'ai'
import { z } from 'zod'
import { getVectorStore } from '../utils/vectors.ts'

export const MEMORY_TOOL_NAME = 'memory'
export const MEMORY_TOOL_LABEL = '🧠 Semantic Memory (long-term RAG)'

export const memoryTools = {

	save: tool({
		description: 'Save an important fact, insight, decision, or piece of knowledge to long-term semantic memory. This makes it searchable by meaning in future conversations. Use this for things worth remembering that might not fit in the persona files.',
		inputSchema: z.object({
			text: z.string().describe('The text to memorize. Should be a clear, self-contained statement.'),
			source: z.string().default('conversation').describe('Where this memory comes from (e.g., "conversation", "file", "research", "user-preference")'),
			tags: z.array(z.string()).default([]).describe('Optional tags for categorization (e.g., ["project-x", "architecture"])'),
		}),
		execute: async ({ text, source, tags }: { text: string; source: string; tags: string[] }) => {
			try {
				const store = await getVectorStore()
				const id = await store.upsert(text, source, tags)
				const stats = store.getStats()
				return {
					success: true,
					id,
					message: `Memory saved (${stats.count} total, ${(stats.sizeBytes / 1024).toFixed(1)}KB used).`
				}
			} catch (err: unknown) {
				return { success: false, error: (err as Error).message }
			}
		}
	}),

	search: tool({
		description: 'Search long-term semantic memory for relevant past knowledge. Returns memories similar in meaning to your query, not just keyword matches.',
		inputSchema: z.object({
			query: z.string().describe('Natural language query to search for related memories'),
			topK: z.number().default(5).describe('Maximum number of results to return (1-20)'),
			minScore: z.number().default(0.3).describe('Minimum similarity score (0-1). Higher = more relevant only.'),
		}),
		execute: async ({ query, topK, minScore }: { query: string; topK: number; minScore: number }) => {
			try {
				const store = await getVectorStore()
				const results = await store.search(query, Math.min(topK, 20), minScore)
				if (results.length === 0) {
					return { success: true, results: [], message: 'No relevant memories found.' }
				}
				return {
					success: true,
					results: results.map(r => ({
						id: r.entry.id,
						text: r.entry.text,
						source: r.entry.source,
						tags: r.entry.tags,
						score: Math.round(r.score * 100) / 100,
						createdAt: r.entry.createdAt,
					})),
					message: `Found ${results.length} relevant memories.`,
				}
			} catch (err: unknown) {
				return { success: false, error: (err as Error).message }
			}
		}
	}),

	forget: tool({
		description: 'Remove a specific memory from long-term storage by its ID.',
		inputSchema: z.object({
			id: z.string().describe('The ID of the memory to delete'),
		}),
		execute: async ({ id }: { id: string }) => {
			try {
				const store = await getVectorStore()
				const deleted = store.delete(id)
				return { success: deleted, message: deleted ? 'Memory deleted.' : 'Memory not found.' }
			} catch (err: unknown) {
				return { success: false, error: (err as Error).message }
			}
		}
	}),

	stats: tool({
		description: 'Get statistics about the long-term semantic memory store.',
		inputSchema: z.object({}),
		execute: async () => {
			try {
				const store = await getVectorStore()
				const stats = store.getStats()
				return {
					success: true,
					...stats,
					sizeHuman: stats.sizeBytes < 1024 * 1024
						? `${(stats.sizeBytes / 1024).toFixed(1)}KB`
						: `${(stats.sizeBytes / (1024 * 1024)).toFixed(1)}MB`,
					maxVectors: 5000,
					usage: `${stats.count}/5000`,
				}
			} catch (err: unknown) {
				return { success: false, error: (err as Error).message }
			}
		}
	}),
}
