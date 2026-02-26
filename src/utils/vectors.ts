/**
 * Lightweight vector store for semantic memory / RAG.
 *
 * Uses @xenova/transformers (already a dependency) for local embeddings
 * and a simple JSON-based storage with cosine similarity search.
 *
 * Storage layout per tenant:
 *   ~/.tamias/vectors/index.json   — metadata array
 *   ~/.tamias/vectors/embeddings.bin — packed Float32Array
 *
 * Size is capped at MAX_VECTORS (default 5000) per store.
 * When the cap is reached, the oldest entries are evicted.
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { TAMIAS_DIR } from './config.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VectorEntry {
	id: string
	text: string
	source: string      // e.g. 'conversation', 'file', 'note'
	tags: string[]
	createdAt: string   // ISO date
	/** Byte offset into embeddings.bin (computed at load) */
	_offset?: number
}

export interface VectorSearchResult {
	entry: VectorEntry
	score: number
}

export interface VectorStats {
	count: number
	sizeBytes: number
	oldestEntry: string | null
	newestEntry: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMBEDDING_DIM = 384          // all-MiniLM-L6-v2 dimension
const MAX_VECTORS = 5000           // per-store cap to prevent bloat
const BYTES_PER_VECTOR = EMBEDDING_DIM * 4 // Float32
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'

// ─── Embedding pipeline (lazy singleton) ──────────────────────────────────────

let embedPipeline: any = null

async function getEmbedder() {
	if (embedPipeline) return embedPipeline
	const { pipeline, env } = await import('@xenova/transformers')
	env.cacheDir = join(TAMIAS_DIR, '.model-cache')
	env.allowLocalModels = true
	env.allowRemoteModels = true
	console.log(`[vectors] Loading embedding model ${MODEL_NAME}...`)
	embedPipeline = await pipeline('feature-extraction', MODEL_NAME)
	console.log(`[vectors] Embedding model ready.`)
	return embedPipeline
}

/** Generate a normalised embedding vector for the given text */
export async function embed(text: string): Promise<Float32Array> {
	const pipe = await getEmbedder()
	const output = await pipe(text, { pooling: 'mean', normalize: true })
	return new Float32Array(output.data)
}

// ─── Cosine similarity ───────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0, normA = 0, normB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8)
}

// ─── VectorStore class ───────────────────────────────────────────────────────

export class VectorStore {
	private dir: string
	private indexPath: string
	private embeddingsPath: string
	private entries: VectorEntry[] = []
	private embeddings: Float32Array = new Float32Array(0)
	private dirty = false

	constructor(baseDir?: string) {
		this.dir = baseDir ? join(baseDir, 'vectors') : join(TAMIAS_DIR, 'vectors')
		this.indexPath = join(this.dir, 'index.json')
		this.embeddingsPath = join(this.dir, 'embeddings.bin')
	}

	/** Initialize the store — creates directory and loads existing data */
	async init(): Promise<void> {
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true })
		}
		this.load()
	}

	/** Load index and embeddings from disk */
	private load(): void {
		if (existsSync(this.indexPath)) {
			try {
				this.entries = JSON.parse(readFileSync(this.indexPath, 'utf-8'))
			} catch {
				this.entries = []
			}
		}
		if (existsSync(this.embeddingsPath)) {
			try {
				const buf = readFileSync(this.embeddingsPath)
				this.embeddings = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
			} catch {
				this.embeddings = new Float32Array(0)
			}
		}
		// Sanity check: entries and embeddings must be consistent
		const expected = this.entries.length * EMBEDDING_DIM
		if (this.embeddings.length !== expected) {
			console.warn(`[vectors] Index/embeddings mismatch (${this.entries.length} entries, ${this.embeddings.length} floats). Resetting.`)
			this.entries = []
			this.embeddings = new Float32Array(0)
			this.dirty = true
			this.flush()
		}
	}

	/** Persist changes to disk */
	flush(): void {
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true })
		}
		writeFileSync(this.indexPath, JSON.stringify(this.entries, null, 2), 'utf-8')
		const buf = Buffer.from(this.embeddings.buffer, this.embeddings.byteOffset, this.embeddings.byteLength)
		writeFileSync(this.embeddingsPath, buf)
		this.dirty = false
	}

	/** Add a memory entry. Returns the generated ID. */
	async upsert(text: string, source: string, tags: string[] = []): Promise<string> {
		const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
		const vector = await embed(text)

		// Check for near-duplicate (similarity > 0.95)
		for (let i = 0; i < this.entries.length; i++) {
			const existing = this.getEmbedding(i)
			if (cosineSimilarity(vector, existing) > 0.95) {
				// Update existing entry instead of creating duplicate
				this.entries[i].text = text
				this.entries[i].tags = [...new Set([...this.entries[i].tags, ...tags])]
				this.entries[i].createdAt = new Date().toISOString()
				this.setEmbedding(i, vector)
				this.dirty = true
				this.flush()
				return this.entries[i].id
			}
		}

		// Enforce cap — evict oldest entries if at limit
		while (this.entries.length >= MAX_VECTORS) {
			this.evictOldest()
		}

		// Append new entry
		this.entries.push({
			id,
			text,
			source,
			tags,
			createdAt: new Date().toISOString(),
		})

		// Grow embeddings array
		const newEmbeddings = new Float32Array(this.embeddings.length + EMBEDDING_DIM)
		newEmbeddings.set(this.embeddings)
		newEmbeddings.set(vector, this.embeddings.length)
		this.embeddings = newEmbeddings
		this.dirty = true
		this.flush()
		return id
	}

	/** Search for similar memories. Returns top-k results sorted by similarity. */
	async search(query: string, topK = 5, minScore = 0.3): Promise<VectorSearchResult[]> {
		if (this.entries.length === 0) return []

		const queryVec = await embed(query)
		const scores: VectorSearchResult[] = []

		for (let i = 0; i < this.entries.length; i++) {
			const entryVec = this.getEmbedding(i)
			const score = cosineSimilarity(queryVec, entryVec)
			if (score >= minScore) {
				scores.push({ entry: this.entries[i], score })
			}
		}

		scores.sort((a, b) => b.score - a.score)
		return scores.slice(0, topK)
	}

	/** Search by tag filter */
	searchByTag(tag: string): VectorEntry[] {
		return this.entries.filter(e => e.tags.includes(tag))
	}

	/** Delete a specific entry by ID */
	delete(id: string): boolean {
		const idx = this.entries.findIndex(e => e.id === id)
		if (idx === -1) return false
		this.removeAtIndex(idx)
		this.flush()
		return true
	}

	/** Remove all entries matching a source */
	deleteBySource(source: string): number {
		const toRemove = this.entries
			.map((e, i) => ({ entry: e, idx: i }))
			.filter(({ entry }) => entry.source === source)
			.reverse() // Remove from end to preserve indices

		for (const { idx } of toRemove) {
			this.removeAtIndex(idx)
		}
		if (toRemove.length > 0) this.flush()
		return toRemove.length
	}

	/** Get stats about the vector store */
	getStats(): VectorStats {
		let sizeBytes = 0
		if (existsSync(this.embeddingsPath)) {
			sizeBytes += statSync(this.embeddingsPath).size
		}
		if (existsSync(this.indexPath)) {
			sizeBytes += statSync(this.indexPath).size
		}

		const sorted = [...this.entries].sort((a, b) =>
			new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
		)

		return {
			count: this.entries.length,
			sizeBytes,
			oldestEntry: sorted[0]?.createdAt ?? null,
			newestEntry: sorted[sorted.length - 1]?.createdAt ?? null,
		}
	}

	/** Prune old entries to stay within limit */
	prune(maxEntries = MAX_VECTORS): number {
		if (this.entries.length <= maxEntries) return 0
		const toRemove = this.entries.length - maxEntries
		// Remove oldest entries
		for (let i = 0; i < toRemove; i++) {
			this.removeAtIndex(0)
		}
		this.flush()
		return toRemove
	}

	/** Destroy the entire store (for tenant cleanup) */
	destroy(): void {
		if (existsSync(this.indexPath)) unlinkSync(this.indexPath)
		if (existsSync(this.embeddingsPath)) unlinkSync(this.embeddingsPath)
		this.entries = []
		this.embeddings = new Float32Array(0)
	}

	get count(): number {
		return this.entries.length
	}

	// ─── Internal helpers ─────────────────────────────────────────────────────

	private getEmbedding(index: number): Float32Array {
		const start = index * EMBEDDING_DIM
		return this.embeddings.slice(start, start + EMBEDDING_DIM)
	}

	private setEmbedding(index: number, vector: Float32Array): void {
		const start = index * EMBEDDING_DIM
		this.embeddings.set(vector, start)
	}

	private removeAtIndex(index: number): void {
		this.entries.splice(index, 1)
		// Rebuild embeddings without the removed entry
		const newLen = this.entries.length * EMBEDDING_DIM
		const newEmb = new Float32Array(newLen)
		for (let i = 0; i < this.entries.length; i++) {
			const srcStart = (i < index ? i : i + 1) * EMBEDDING_DIM
			const dstStart = i * EMBEDDING_DIM
			newEmb.set(this.embeddings.slice(srcStart, srcStart + EMBEDDING_DIM), dstStart)
		}
		this.embeddings = newEmb
	}

	private evictOldest(): void {
		if (this.entries.length === 0) return
		// Find oldest entry
		let oldestIdx = 0
		let oldestTime = new Date(this.entries[0].createdAt).getTime()
		for (let i = 1; i < this.entries.length; i++) {
			const t = new Date(this.entries[i].createdAt).getTime()
			if (t < oldestTime) {
				oldestTime = t
				oldestIdx = i
			}
		}
		this.removeAtIndex(oldestIdx)
	}
}

// ─── Singleton store ──────────────────────────────────────────────────────────

let defaultStore: VectorStore | null = null

/** Get (or create) the default vector store for the active tenant */
export async function getVectorStore(baseDir?: string): Promise<VectorStore> {
	if (!defaultStore) {
		defaultStore = new VectorStore(baseDir)
		await defaultStore.init()
	}
	return defaultStore
}

/** Reset the singleton (e.g., when switching tenants) */
export function resetVectorStore(): void {
	defaultStore = null
}
