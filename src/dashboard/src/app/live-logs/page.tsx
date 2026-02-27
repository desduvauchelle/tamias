'use client'

import { useEffect, useState } from 'react'

interface LogHistoryEntry {
	id: string | number
	timestamp: string
	sessionId?: string
	prompt?: string
	response?: string
	model?: string
}

export default function LiveLogsPage() {
	const [logsText, setLogsText] = useState('')
	const [loading, setLoading] = useState(true)

	const fetchLogs = async () => {
		try {
			const res = await fetch('/api/history?limit=120')
			const data = await res.json()
			if (data.logs) {
				const formatted = data.logs
					.slice(0, 120)
					.map((log: LogHistoryEntry) => {
						const time = new Date(log.timestamp).toLocaleTimeString()
						const session = log.sessionId || 'unknown-session'
						const model = log.model ? ` (${log.model})` : ''
						return `[${time}] ${session}${model}: ${log.prompt ?? ''}\n -> ${log.response ?? ''}`
					})
					.join('\n\n')
				setLogsText(formatted)
			}
		} catch (error) {
			console.error('Failed to fetch live logs:', error)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchLogs()
		const interval = setInterval(fetchLogs, 10000)
		return () => clearInterval(interval)
	}, [])

	return (
		<div className="h-full flex flex-col p-6 gap-4">
			<div className="flex items-center justify-between shrink-0">
				<div>
					<h1 className="text-2xl font-bold text-success font-mono">Live Logs</h1>
					<p className="text-xs text-base-content/50 font-mono mt-1 uppercase tracking-tighter">Realtime episodic history feed (10s polling)</p>
				</div>
				<button className="btn btn-ghost btn-sm btn-square" onClick={fetchLogs} title="Refresh Live Logs">
					<svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				</button>
			</div>

			<div className="card flex-1 bg-base-200 border border-base-300 overflow-hidden shadow-xl min-h-0">
				<div className="card-body flex flex-col p-0 min-h-0">
					<div className="px-5 py-3 border-b border-base-300 shrink-0 text-center bg-base-300/30">
						<h2 className="card-title text-sm text-base-content/50 uppercase tracking-wider font-mono inline-block">Episodic History</h2>
					</div>
					<div className="flex-1 overflow-y-auto bg-base-300/50 p-4 text-[10px] text-success font-mono whitespace-pre-wrap leading-relaxed">
						{loading && !logsText ? 'Loading agent activity...' : logsText || 'Waiting for agent activity...'}
					</div>
				</div>
			</div>
		</div>
	)
}
