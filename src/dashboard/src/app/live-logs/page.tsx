'use client'

import { useEffect, useMemo, useState } from 'react'

type LogSource = 'daemon' | 'channel' | 'message' | 'ai' | 'tool' | 'error'
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface UnifiedLogEntry {
	id: number
	timestamp: string
	source: LogSource
	type: string
	level: LogLevel
	sessionId?: string
	channelId?: string
	channelUserId?: string
	agentId?: string
	tenantId?: string
	message: string
	metadata?: unknown
	aiLogId?: number
}

export function formatLiveLogTimestamp(timestamp: string): string {
	const parsed = new Date(timestamp)
	if (Number.isNaN(parsed.getTime())) return timestamp
	return parsed.toLocaleString()
}

function compactSourceLabel(source: LogSource): string {
	switch (source) {
		case 'daemon': return 'Daemon'
		case 'channel': return 'Channel'
		case 'message': return 'Message'
		case 'ai': return 'AI'
		case 'tool': return 'Tool'
		case 'error': return 'Error'
	}
}

const sourceOptions: Array<{ value: '' | LogSource; label: string }> = [
	{ value: '', label: 'All' },
	{ value: 'daemon', label: 'Daemon' },
	{ value: 'channel', label: 'Channels' },
	{ value: 'message', label: 'Messages' },
	{ value: 'ai', label: 'AI' },
	{ value: 'tool', label: 'Tools' },
	{ value: 'error', label: 'Errors' },
]

const levelOptions: Array<{ value: '' | LogLevel; label: string }> = [
	{ value: '', label: 'Any level' },
	{ value: 'debug', label: 'debug' },
	{ value: 'info', label: 'info' },
	{ value: 'warn', label: 'warn' },
	{ value: 'error', label: 'error' },
]

export default function LiveLogsPage() {
	const [logs, setLogs] = useState<UnifiedLogEntry[]>([])
	const [expandedId, setExpandedId] = useState<number | null>(null)
	const [loading, setLoading] = useState(true)
	const [query, setQuery] = useState('')
	const [source, setSource] = useState<'' | LogSource>('')
	const [level, setLevel] = useState<'' | LogLevel>('')
	const [sessionId, setSessionId] = useState('')
	const [channelId, setChannelId] = useState('')
	const [isLive, setIsLive] = useState(true)
	const [pageSize, setPageSize] = useState<50 | 100>(50)
	const [page, setPage] = useState(0)

	const buildParams = () => {
		const params = new URLSearchParams()
		params.set('limit', String(pageSize))
		params.set('offset', String(page * pageSize))
		if (source) params.set('source', source)
		if (level) params.set('level', level)
		if (query.trim()) params.set('q', query.trim())
		if (sessionId.trim()) params.set('sessionId', sessionId.trim())
		if (channelId.trim()) params.set('channelId', channelId.trim())
		return params
	}

	const fetchLogs = async () => {
		try {
			const params = buildParams()
			const res = await fetch(`/api/logs?${params.toString()}`, { cache: 'no-store' })
			const data = await res.json()
			if (Array.isArray(data.logs)) {
				setLogs(data.logs as UnifiedLogEntry[])
			}
		} catch (error) {
			console.error('Failed to fetch unified logs:', error)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		void fetchLogs()
		if (!isLive) return
		if (page !== 0) return
		const params = buildParams()
		const eventSource = new EventSource(`/api/logs/stream?${params.toString()}`)
		eventSource.addEventListener('log', (event) => {
			try {
				const data = JSON.parse((event as MessageEvent).data) as UnifiedLogEntry
				setLogs((current) => [data, ...current].slice(0, pageSize))
			} catch (error) {
				console.error('Failed to parse log event:', error)
			}
		})
		eventSource.onerror = () => {
			eventSource.close()
		}
		return () => eventSource.close()
	}, [source, level, query, sessionId, channelId, isLive, pageSize, page])

	const filtered = useMemo(() => logs, [logs])

	useEffect(() => {
		setPage(0)
	}, [source, level, query, sessionId, channelId, pageSize])

	return (
		<div data-testid="live-logs-page" className="h-full flex flex-col p-6 gap-4 overflow-hidden">
			<div className="flex items-start justify-between shrink-0 gap-3 flex-wrap">
				<div>
					<h1 className="text-2xl font-bold text-success font-mono">Logs</h1>
					<p className="text-xs text-base-content/50 font-mono mt-1 uppercase tracking-tighter">Historical + realtime daemon, channel, message, AI and tool timeline</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						data-testid="logs-live-toggle-btn"
						className={`btn btn-sm ${isLive ? 'btn-success' : 'btn-outline'}`}
						onClick={() => setIsLive((current) => !current)}
					>
						{isLive ? 'Pause live' : 'Resume live'}
					</button>
					<button data-testid="live-logs-refresh-btn" className="btn btn-ghost btn-sm" onClick={fetchLogs}>
						Refresh
					</button>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-5 gap-2 shrink-0">
				<select className="select select-bordered select-sm font-mono text-xs" value={source} onChange={(e) => setSource(e.target.value as '' | LogSource)}>
					{sourceOptions.map((opt) => <option key={opt.label} value={opt.value}>{opt.label}</option>)}
				</select>
				<select className="select select-bordered select-sm font-mono text-xs" value={level} onChange={(e) => setLevel(e.target.value as '' | LogLevel)}>
					{levelOptions.map((opt) => <option key={opt.label} value={opt.value}>{opt.label}</option>)}
				</select>
				<input
					className="input input-bordered input-sm font-mono text-xs"
					placeholder="Search message/metadata"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<input
					className="input input-bordered input-sm font-mono text-xs"
					placeholder="Session ID"
					value={sessionId}
					onChange={(e) => setSessionId(e.target.value)}
				/>
				<input
					className="input input-bordered input-sm font-mono text-xs"
					placeholder="Channel ID"
					value={channelId}
					onChange={(e) => setChannelId(e.target.value)}
				/>
			</div>

			<div className="flex items-center justify-between gap-2 shrink-0">
				<div className="flex items-center gap-2">
					<span className="text-[10px] uppercase font-mono opacity-60">Page size</span>
					<select
						className="select select-bordered select-xs font-mono"
						value={pageSize}
						onChange={(e) => setPageSize(Number(e.target.value) as 50 | 100)}
					>
						<option value={50}>50</option>
						<option value={100}>100</option>
					</select>
				</div>
				<div className="flex items-center gap-2">
					<button className="btn btn-xs btn-outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
						Previous
					</button>
					<span className="text-[10px] font-mono opacity-70">Page {page + 1}</span>
					<button
						className="btn btn-xs btn-outline"
						onClick={() => setPage((p) => p + 1)}
						disabled={logs.length < pageSize}
					>
						Next
					</button>
				</div>
			</div>

			<div className="card flex-1 bg-base-200 border border-base-300 overflow-hidden min-h-0">
				<div className="card-body p-0 min-h-0">
					<div className="px-4 py-2 border-b border-base-300 text-[10px] uppercase tracking-wider font-mono text-base-content/50">
						{loading ? 'Loading...' : `Showing ${filtered.length} events • ${isLive && page === 0 ? 'live updating' : 'live paused'}`}
					</div>
					<div className="flex-1 overflow-y-auto p-2 space-y-2">
						{filtered.length === 0 ? (
							<div className="text-xs opacity-50 font-mono p-3">Waiting for logs...</div>
						) : (
							filtered.map((log) => {
								const isExpanded = expandedId === log.id
								return (
									<div key={log.id} className="border border-base-300 rounded-md overflow-hidden">
										<button
											className="w-full text-left px-3 py-2 bg-base-300/20 hover:bg-base-300/30 transition-colors"
											onClick={() => setExpandedId(isExpanded ? null : log.id)}
										>
											<div className="flex items-center gap-2 text-xs font-mono">
												<span className="badge badge-outline badge-xs">{compactSourceLabel(log.source)}</span>
												<span className="badge badge-outline badge-xs">{log.level}</span>
												<span className="opacity-60">{formatLiveLogTimestamp(log.timestamp)}</span>
												<span className="font-semibold">{log.message}</span>
											</div>
											<div className="text-[10px] mt-1 opacity-60 font-mono">
												type={log.type} {log.channelId ? `• channel=${log.channelId}` : ''} {log.sessionId ? `• session=${log.sessionId}` : ''}
											</div>
										</button>
										{isExpanded && (
											<div className="p-3 bg-base-100 border-t border-base-300">
												<pre className="text-[11px] font-mono whitespace-pre-wrap break-all">{JSON.stringify(log, null, 2)}</pre>
											</div>
										)}
									</div>
								)
							})
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
