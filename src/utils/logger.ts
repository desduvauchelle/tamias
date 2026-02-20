import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

export const LOGS_ROOT = join(homedir(), '.tamias', 'logs', 'ai-requests')

export interface AiLogPayload {
	timestamp: string
	sessionId: string
	model: string
	provider: string
	action: 'chat' | 'compact'
	durationMs: number
	tokens?: {
		prompt?: number
		completion?: number
		total?: number
	}
	messages: unknown[]
	response: string
}

function ensureLogsDir(): void {
	if (!existsSync(LOGS_ROOT)) {
		mkdirSync(LOGS_ROOT, { recursive: true })
	}
}

/** Get the log file path based on the current month (YYYY-MM) */
function getMonthLogFile(isoDate: string): string {
	const month = isoDate.slice(0, 7) // e.g., "2024-02"
	return join(LOGS_ROOT, `${month}.jsonl`)
}

/**
 * Appends a log entry to the JSONL file asynchronously.
 * Fire-and-forget to avoid blocking the main daemon process.
 */
export function logAiRequest(payload: AiLogPayload): void {
	try {
		ensureLogsDir()
		const filePath = getMonthLogFile(payload.timestamp)
		const line = JSON.stringify(payload) + '\n'

		// Use synchronous write since it's just a single append locally,
		// but we wrap the whole call in a try/catch so it doesn't crash the server.
		writeFileSync(filePath, line, { flag: 'a', encoding: 'utf-8' })
	} catch (err) {
		console.error('⚠️  Failed to write AI request log:', err)
	}
}
