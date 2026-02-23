'use client'

import { useState, useEffect } from 'react'
import { Clock, Terminal, Cpu, Database, ChevronRight, ChevronDown, Search } from 'lucide-react'

interface LogEntry {
	timestamp: string
	sessionId: string
	model: string
	provider: string
	action: string
	durationMs: number
	tokens: {
		prompt: number
		completion: number
		total: number
	}
	prompt: string
	response: string
}

export default function HistoryPage() {
	const [logs, setLogs] = useState<LogEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [expandedId, setExpandedId] = useState<number | null>(null)
	const [filter, setFilter] = useState('')

	useEffect(() => {
		fetchLogs()
	}, [])

	const fetchLogs = async () => {
		try {
			const res = await fetch('/api/history')
			const data = await res.json()
			if (data.logs) setLogs(data.logs)
		} catch (e) {
			console.error('Failed to fetch logs:', e)
		} finally {
			setLoading(false)
		}
	}

	const filteredLogs = logs.filter(l =>
		l.prompt?.toLowerCase().includes(filter.toLowerCase()) ||
		l.response?.toLowerCase().includes(filter.toLowerCase()) ||
		l.sessionId?.toLowerCase().includes(filter.toLowerCase()) ||
		l.model?.toLowerCase().includes(filter.toLowerCase())
	)

	return (
		<div className="h-full flex flex-col p-6 gap-6 overflow-hidden">
			<div className="flex items-center justify-between shrink-0">
				<div>
					<h1 className="text-2xl font-bold text-success font-mono">Episodic History</h1>
					<p className="text-xs text-base-content/50 font-mono mt-1 uppercase tracking-tighter">Audit trail of AI interactions and tool usage</p>
				</div>
				<div className="flex items-center gap-3">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30" />
						<input
							type="text"
							placeholder="Filter by prompt, model, session..."
							className="input input-bordered input-sm pl-9 w-64 font-mono text-xs focus:input-success transition-all"
							value={filter}
							onChange={e => setFilter(e.target.value)}
						/>
					</div>
					<button className="btn btn-ghost btn-sm btn-square" onClick={fetchLogs} title="Refresh History">
						<svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
					</button>
				</div>
			</div>

			<div className="flex-1 overflow-hidden">
				<div className="card h-full bg-base-200 border border-base-300 flex flex-col overflow-hidden">
					<div className="card-body p-0 flex flex-col min-h-0">
						{/* Table Header */}
						<div className="grid grid-cols-[180px_120px_1fr_100px_80px] px-6 py-3 border-b border-base-300 bg-base-300/30 text-[10px] uppercase font-bold tracking-widest text-base-content/50 font-mono items-center shrink-0">
							<div className="flex items-center gap-2"><Clock className="w-3 h-3" /> Timestamp</div>
							<div className="flex items-center gap-2"><Cpu className="w-3 h-3" /> Model</div>
							<div className="flex items-center gap-2"><Terminal className="w-3 h-3" /> Input Prompt Snippet</div>
							<div className="flex items-center gap-2 justify-end text-right"><Database className="w-3 h-3" /> Tokens</div>
							<div className="text-right pr-2">Dur.</div>
						</div>

						{/* Table Content */}
						<div className="flex-1 overflow-y-auto">
							{loading ? (
								<div className="h-64 flex items-center justify-center">
									<span className="loading loading-spinner text-success loading-lg" />
								</div>
							) : filteredLogs.length === 0 ? (
								<div className="h-64 flex flex-col items-center justify-center text-center opacity-30">
									<p className="font-mono text-sm uppercase">No history matching criteria</p>
								</div>
							) : (
								filteredLogs.map((log, idx) => (
									<div key={idx} className="border-b border-base-300/50 last:border-0">
										<div
											className={`grid grid-cols-[180px_120px_1fr_100px_80px] px-6 py-4 text-[11px] font-mono hover:bg-base-300/20 cursor-pointer transition-colors items-center ${expandedId === idx ? 'bg-base-300/40' : ''}`}
											onClick={() => setExpandedId(expandedId === idx ? null : idx)}
										>
											<div className="text-base-content/60">{new Date(log.timestamp).toLocaleString()}</div>
											<div>
												<span className="px-1.5 py-0.5 rounded bg-base-300 text-[9px] uppercase font-bold text-base-content/70">
													{log.model.split('/').pop()}
												</span>
											</div>
											<div className="truncate pr-4 text-success/80">
												{log.prompt || <span className="opacity-30 italic">No prompt</span>}
											</div>
											<div className="text-right text-base-content/40 tabular-nums">
												{log.tokens.total || 0}
											</div>
											<div className="text-right text-base-content/40 tabular-nums pr-2">
												{log.durationMs}ms
											</div>
										</div>

										{expandedId === idx && (
											<div className="bg-base-300/20 px-6 py-6 border-y border-base-300/50 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
												<div className="flex gap-12 text-[10px] uppercase font-bold tracking-tighter text-base-content/40 border-b border-base-300 pb-2">
													<div className="flex items-center gap-2">Session: <span className="text-success">{log.sessionId}</span></div>
													<div className="flex items-center gap-2">Provider: <span className="text-success">{log.provider}</span></div>
													<div className="flex items-center gap-2">Tokens: <span className="text-success">{log.tokens.prompt} in / {log.tokens.completion} out</span></div>
												</div>
												<div className="grid grid-cols-2 gap-6">
													<div className="space-y-2">
														<div className="text-[10px] uppercase font-bold text-primary/60 flex items-center gap-2">
															<ChevronRight className="w-3 h-3" /> Input Content
														</div>
														<div className="bg-base-300/50 p-4 rounded border border-base-300 text-xs font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto text-base-content/80">
															{log.prompt}
														</div>
													</div>
													<div className="space-y-2">
														<div className="text-[10px] uppercase font-bold text-success/60 flex items-center gap-2">
															<ChevronDown className="w-3 h-3" /> Output Response
														</div>
														<div className="bg-base-300/50 p-4 rounded border border-base-300 text-xs font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto text-success/80">
															{log.response}
														</div>
													</div>
												</div>
											</div>
										)}
									</div>
								))
							)}
						</div>

						{/* Table Footer */}
						<div className="px-6 py-3 border-t border-base-300 bg-base-300/30 flex justify-between items-center shrink-0">
							<div className="text-[10px] uppercase font-mono text-base-content/40">
								Displaying last {filteredLogs.length} activity records
							</div>
							<div className="badge badge-outline border-base-300 text-[10px] font-mono text-base-content/30 lowercase italic">
								History stored in data.sqlite context
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
