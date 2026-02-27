import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

interface DaemonLogEntry {
	id: string
	timestamp: string
	initiator?: string
	sessionId?: string
	model: string
	provider?: string
	action?: string
	durationMs?: number
	tokensPrompt?: number
	tokensCompletion?: number
	tokens?: { prompt?: number; completion?: number }
	inputSnippet?: string
	prompt?: string
	outputSnippet?: string
	response?: string
	estimatedCostUsd?: number
	fullHistory?: unknown[]
}

interface DashboardLogEntry {
	id: string
	timestamp: string
	sessionId?: string
	model: string
	provider: string
	action: string
	durationMs: number
	tokens: {
		prompt: number
		completion: number
		total: number
	}
	prompt?: string
	response?: string
	estimatedCostUsd: number
	fullHistory: unknown[]
}

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

function normalizeText(value: unknown): string {
	if (typeof value === 'string') return value
	if (value == null) return ''
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const query = searchParams.get('q')?.trim().toLowerCase() ?? ''
		const limitParam = searchParams.get('limit')
		const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined
		const limit = parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined

		// Get daemon port
		const str = await readFile(DAEMON_FILE, 'utf-8')
		const info = JSON.parse(str)
		if (!info.port) throw new Error('Daemon not running')

		const res = await fetch(`http://127.0.0.1:${info.port}/history`, { cache: 'no-store' })
		if (!res.ok) throw new Error(`Daemon returned ${res.status}`)

		const data = await res.json()
		// Forward daemon logs directly, mapping field names to dashboard format
		const daemonLogs = (data.logs || []) as DaemonLogEntry[]
		const mappedLogs: DashboardLogEntry[] = daemonLogs.map((l: DaemonLogEntry) => ({
			id: l.id,
			timestamp: l.timestamp,
			sessionId: l.initiator ?? l.sessionId,
			model: l.model,
			provider: l.provider ?? 'unknown',
			action: l.action ?? 'message',
			durationMs: l.durationMs ?? 0,
			tokens: {
				prompt: l.tokensPrompt ?? l.tokens?.prompt ?? 0,
				completion: l.tokensCompletion ?? l.tokens?.completion ?? 0,
				total: (l.tokensPrompt ?? l.tokens?.prompt ?? 0) + (l.tokensCompletion ?? l.tokens?.completion ?? 0)
			},
			prompt: l.inputSnippet ?? l.prompt,
			response: l.outputSnippet ?? l.response,
			estimatedCostUsd: l.estimatedCostUsd ?? 0,
			fullHistory: l.fullHistory ?? []
		}))

		const filteredLogs = query
			? mappedLogs.filter((log: DashboardLogEntry) => {
				const haystack = [
					log.sessionId,
					log.model,
					normalizeText(log.prompt),
					normalizeText(log.response),
				].join(' ').toLowerCase()
				return haystack.includes(query)
			})
			: mappedLogs

		const logs = typeof limit === 'number' ? filteredLogs.slice(0, limit) : filteredLogs

		return NextResponse.json({ logs })
	} catch (error) {
		console.error('Failed to fetch logs:', error)
		return NextResponse.json({ logs: [], error: String(error) })
	}
}
