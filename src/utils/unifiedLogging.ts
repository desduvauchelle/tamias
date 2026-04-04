import { EventEmitter } from 'events'
import { db } from './db'

export type UnifiedLogSource = 'daemon' | 'channel' | 'message' | 'ai' | 'tool' | 'error'
export type UnifiedLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface UnifiedLogEventInput {
	timestamp?: string
	source: UnifiedLogSource
	type: string
	level?: UnifiedLogLevel
	sessionId?: string
	channelId?: string
	channelUserId?: string
	agentId?: string
	tenantId?: string
	message: string
	metadata?: unknown
	aiLogId?: number
}

interface UnifiedLogRow {
	id: number
	timestamp: string
	source: string
	type: string
	level: string
	sessionId: string | null
	channelId: string | null
	channelUserId: string | null
	agentId: string | null
	tenantId: string | null
	message: string
	metadataJson: string | null
	aiLogId: number | null
}

export interface UnifiedLogRecord {
	id: number
	timestamp: string
	source: UnifiedLogSource
	type: string
	level: UnifiedLogLevel
	sessionId?: string
	channelId?: string
	channelUserId?: string
	agentId?: string
	tenantId?: string
	message: string
	metadata?: unknown
	aiLogId?: number
}

export interface ListUnifiedLogFilters {
	limit?: number
	offset?: number
	source?: UnifiedLogSource
	type?: string
	level?: UnifiedLogLevel
	sessionId?: string
	channelId?: string
	channelUserId?: string
	agentId?: string
	tenantId?: string
	q?: string
	from?: string
	to?: string
}

const unifiedLogEmitter = new EventEmitter()

function parseMetadata(value: string | null): unknown {
	if (!value) return undefined
	try {
		return JSON.parse(value)
	} catch (error) {
		console.error('[unifiedLogging] Failed to parse metadataJson:', error)
		return { parseError: true, raw: value }
	}
}

function rowToRecord(row: UnifiedLogRow): UnifiedLogRecord {
	return {
		id: row.id,
		timestamp: row.timestamp,
		source: row.source as UnifiedLogSource,
		type: row.type,
		level: row.level as UnifiedLogLevel,
		sessionId: row.sessionId ?? undefined,
		channelId: row.channelId ?? undefined,
		channelUserId: row.channelUserId ?? undefined,
		agentId: row.agentId ?? undefined,
		tenantId: row.tenantId ?? undefined,
		message: row.message,
		metadata: parseMetadata(row.metadataJson),
		aiLogId: row.aiLogId ?? undefined,
	}
}

export function emitLogEvent(input: UnifiedLogEventInput): UnifiedLogRecord | undefined {
	const timestamp = input.timestamp ?? new Date().toISOString()
	const level = input.level ?? 'info'
	const metadataJson = input.metadata === undefined ? null : JSON.stringify(input.metadata)

	try {
		const result = db.prepare(`
			INSERT INTO unified_logs
				(timestamp, source, type, level, sessionId, channelId, channelUserId, agentId, tenantId, message, metadataJson, aiLogId)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			timestamp,
			input.source,
			input.type,
			level,
			input.sessionId ?? null,
			input.channelId ?? null,
			input.channelUserId ?? null,
			input.agentId ?? null,
			input.tenantId ?? null,
			input.message,
			metadataJson,
			input.aiLogId ?? null,
		)

		const row = db.query<UnifiedLogRow, [number]>(`
			SELECT id, timestamp, source, type, level, sessionId, channelId, channelUserId, agentId, tenantId, message, metadataJson, aiLogId
			FROM unified_logs
			WHERE id = ?
		`).get(Number(result.lastInsertRowid))
		if (!row) return undefined

		const record = rowToRecord(row)
		unifiedLogEmitter.emit('log', record)
		return record
	} catch (error) {
		console.error('[unifiedLogging] Failed to emit log event:', error)
		return undefined
	}
}

export function listUnifiedLogs(filters: ListUnifiedLogFilters = {}): UnifiedLogRecord[] {
	const whereParts: string[] = []
	const args: Array<string | number> = []

	if (filters.source) {
		whereParts.push('source = ?')
		args.push(filters.source)
	}
	if (filters.type) {
		whereParts.push('type = ?')
		args.push(filters.type)
	}
	if (filters.level) {
		whereParts.push('level = ?')
		args.push(filters.level)
	}
	if (filters.sessionId) {
		whereParts.push('sessionId = ?')
		args.push(filters.sessionId)
	}
	if (filters.channelId) {
		whereParts.push('channelId = ?')
		args.push(filters.channelId)
	}
	if (filters.channelUserId) {
		whereParts.push('channelUserId = ?')
		args.push(filters.channelUserId)
	}
	if (filters.agentId) {
		whereParts.push('agentId = ?')
		args.push(filters.agentId)
	}
	if (filters.tenantId) {
		whereParts.push('tenantId = ?')
		args.push(filters.tenantId)
	}
	if (filters.from) {
		whereParts.push('timestamp >= ?')
		args.push(filters.from)
	}
	if (filters.to) {
		whereParts.push('timestamp <= ?')
		args.push(filters.to)
	}
	if (filters.q) {
		whereParts.push('(message LIKE ? OR metadataJson LIKE ?)')
		const q = `%${filters.q}%`
		args.push(q, q)
	}

	const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
	const limit = Number.isFinite(filters.limit) ? Math.max(1, Number(filters.limit)) : 200
	const offset = Number.isFinite(filters.offset) ? Math.max(0, Number(filters.offset)) : 0

	const rows = db.query<UnifiedLogRow, [ ...Array<string | number>, number, number ]>(`
		SELECT id, timestamp, source, type, level, sessionId, channelId, channelUserId, agentId, tenantId, message, metadataJson, aiLogId
		FROM unified_logs
		${whereClause}
		ORDER BY id DESC
		LIMIT ?
		OFFSET ?
	`).all(...args, limit, offset)

	return rows.map(rowToRecord)
}

export function onUnifiedLogEvent(listener: (record: UnifiedLogRecord) => void): () => void {
	unifiedLogEmitter.on('log', listener)
	return () => unifiedLogEmitter.off('log', listener)
}
