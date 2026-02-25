'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Clock, Terminal, Cpu, Database, ChevronRight, ChevronDown, Search } from 'lucide-react'

interface HistoryToolCall {
	toolName: string
	args: unknown
	toolCallId: string
}

interface HistoryRecord {
	role: string
	content: unknown
	toolCallId?: string
	toolCalls?: HistoryToolCall[]
}

function extractText(content: unknown): string {
	if (typeof content === 'string') return content
	if (Array.isArray(content)) {
		return content.map((part: unknown) => {
			if (typeof part === 'string') return part
			if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') return (part as { text: string }).text
			return ''
		}).filter(Boolean).join(' ')
	}
	if (content && typeof content === 'object' && 'text' in content && typeof (content as { text: unknown }).text === 'string') return (content as { text: string }).text
	return String(content ?? '')
}

interface LogEntry {
	id: number | string
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
	fullHistory: HistoryRecord[]
}

function HistoryContent() {
	const [logs, setLogs] = useState<LogEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)
	const [filter, setFilter] = useState('')
	const searchParams = useSearchParams()
	const logIdParam = searchParams.get('log')

	useEffect(() => {
		fetchLogs()
	}, [])

	useEffect(() => {
		if (logIdParam && logs.length > 0) {
			const target = logs.find(l => String(l.id) === logIdParam)
			if (target) {
				openModal(target)
			}
		}
	}, [logIdParam, logs])

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

	const filteredLogs = logs.filter(l => {
		const promptText = typeof l.prompt === 'string' ? l.prompt : extractText(l.prompt as unknown)
		const responseText = typeof l.response === 'string' ? l.response : extractText(l.response as unknown)
		const f = filter.toLowerCase()
		return promptText?.toLowerCase().includes(f) ||
			responseText?.toLowerCase().includes(f) ||
			l.sessionId?.toLowerCase().includes(f) ||
			l.model?.toLowerCase().includes(f)
	})

	const openModal = (log: LogEntry) => {
		setSelectedLog(log)
		const modal = document.getElementById('history_modal') as HTMLDialogElement
		if (modal) modal.showModal()
	}

	const systemPrompt = extractText(selectedLog?.fullHistory?.find(m => m.role === 'system')?.content || '')
	const chatConversation = selectedLog?.fullHistory?.filter(m => m.role !== 'system') || []
	const toolCalls = selectedLog?.fullHistory?.flatMap(m =>
		m.toolCalls ? m.toolCalls.map(tc => ({
			name: tc.toolName,
			input: tc.args,
			output: selectedLog.fullHistory.find(r => r.role === 'tool' && r.toolCallId === tc.toolCallId)?.content
		})) : []
	) || []

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
											className={`grid grid-cols-[180px_120px_1fr_100px_80px] px-6 py-4 text-[11px] font-mono hover:bg-base-300/20 cursor-pointer transition-colors items-center`}
											onClick={() => openModal(log)}
										>
											<div className="text-base-content/60">{new Date(log.timestamp).toLocaleString()}</div>
											<div>
												<span className="px-1.5 py-0.5 rounded bg-base-300 text-[9px] uppercase font-bold text-base-content/70">
													{log.model.split('/').pop()}
												</span>
											</div>
											<div className="truncate pr-4 text-success/80">
												{extractText(log.prompt as unknown) || <span className="opacity-30 italic">No prompt</span>}
											</div>
											<div className="text-right text-base-content/40 tabular-nums">
												{log.tokens.total || 0}
											</div>
											<div className="text-right text-base-content/40 tabular-nums pr-2">
												{log.durationMs}ms
											</div>
										</div>
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

			{/* DaisyUI Modal */}
			<dialog id="history_modal" className="modal">
				<div className="modal-box w-11/12 max-w-5xl bg-base-200 border border-base-300 p-0 overflow-hidden flex flex-col max-h-[90vh]">
					{/* Modal Header */}
					<div className="px-6 py-4 border-b border-base-300 bg-base-300/50 flex items-center justify-between shrink-0">
						<div>
							<h3 className="font-bold text-lg text-success font-mono">Interaction Details</h3>
							<p className="text-[10px] text-base-content/50 font-mono uppercase tracking-widest mt-0.5">
								{selectedLog && new Date(selectedLog.timestamp).toLocaleString()} • {selectedLog?.model}
							</p>
						</div>
						<form method="dialog">
							<button className="btn btn-sm btn-ghost btn-square">✕</button>
						</form>
					</div>

					{/* Modal Content */}
					<div className="p-6 overflow-y-auto space-y-8">
						{/* Info Stats */}
						<div className="flex flex-wrap gap-8 text-[10px] uppercase font-bold tracking-tighter text-base-content/40 border-b border-base-300 pb-4">
							<div className="flex flex-col gap-1">
								<span className="opacity-50">Session ID</span>
								<span className="text-success text-xs font-mono">{selectedLog?.sessionId}</span>
							</div>
							<div className="flex flex-col gap-1">
								<span className="opacity-50">Provider</span>
								<span className="text-success text-xs font-mono">{selectedLog?.provider}</span>
							</div>
							<div className="flex flex-col gap-1">
								<span className="opacity-50">Tokens (In/Out)</span>
								<span className="text-success text-xs font-mono">{selectedLog?.tokens.prompt} / {selectedLog?.tokens.completion}</span>
							</div>
							<div className="flex flex-col gap-1">
								<span className="opacity-50">Duration</span>
								<span className="text-success text-xs font-mono">{selectedLog?.durationMs}ms</span>
							</div>
						</div>

						{/* System Prompt Section */}
						<div className="space-y-3">
							<div className="text-xs uppercase font-bold text-primary/60 flex items-center gap-2">
								<div className="w-1.5 h-1.5 rounded-full bg-primary/60" /> System Prompt
							</div>
							<div className="bg-base-300/40 p-4 rounded-lg border border-base-300 text-[11px] font-mono whitespace-pre-wrap text-base-content/70 max-h-[200px] overflow-y-auto">
								{systemPrompt || <span className="opacity-30 italic font-sans">No system prompt provided.</span>}
							</div>
						</div>

						{/* Chat Conversation Section */}
						<div className="space-y-3">
							<div className="text-xs uppercase font-bold text-success/60 flex items-center gap-2">
								<div className="w-1.5 h-1.5 rounded-full bg-success/60" /> Chat Conversation ({chatConversation.length} messages)
							</div>
							<div className="space-y-4">
								{chatConversation.length === 0 ? (
									<div className="text-[11px] italic opacity-30 text-center py-4 bg-base-300/20 rounded-lg">No chat messages found for this turn.</div>
								) : (
									chatConversation.map((msg: HistoryRecord, i: number) => (
										<div key={i} className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-start' : 'items-end'}`}>
											<div className={`text-[9px] uppercase font-bold opacity-30 px-1 ${msg.role === 'user' ? 'text-left' : 'text-right'}`}>
												{msg.role}
											</div>
											<div className={`p-3 rounded-lg text-xs font-mono max-w-[85%] border ${msg.role === 'user' ? 'bg-base-300/50 border-base-300 text-base-content/80' : 'bg-success/5 border-success/20 text-success'}`}>
												{extractText(msg.content)}
											</div>
										</div>
									))
								)}
							</div>
						</div>

						{/* Tool Calls Section */}
						<div className="space-y-3 pb-4">
							<div className="text-xs uppercase font-bold text-warning/60 flex items-center gap-2">
								<div className="w-1.5 h-1.5 rounded-full bg-warning/60" /> Tools Called ({toolCalls.length})
							</div>
							{toolCalls.length === 0 ? (
								<div className="text-[11px] italic opacity-30 text-center py-4 bg-base-300/20 rounded-lg border border-base-300/50">No tools were called in this turn.</div>
							) : (
								<div className="grid grid-cols-1 gap-4">
									{toolCalls.map((tc, i) => (
										<div key={i} className="flex flex-col rounded-lg border border-base-300 overflow-hidden">
											<div className="bg-base-300/50 px-4 py-2 border-b border-base-300 flex items-center justify-between">
												<span className="text-[10px] font-bold text-warning font-mono uppercase tracking-tighter">Tool: {tc.name}</span>
											</div>
											<div className="grid grid-cols-2 divide-x divide-base-300 bg-base-300/10">
												<div className="p-4 space-y-2">
													<div className="text-[9px] uppercase font-bold opacity-30">Input Args</div>
													<pre className="text-[10px] font-mono text-base-content/60 overflow-x-auto whitespace-pre-wrap break-all">
														{JSON.stringify(tc.input, null, 2)}
													</pre>
												</div>
												<div className="p-4 space-y-2">
													<div className="text-[9px] uppercase font-bold opacity-30">Output Result</div>
													<pre className="text-[10px] font-mono text-success/70 overflow-x-auto whitespace-pre-wrap break-all">
														{typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2)}
													</pre>
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Modal Footer */}
					<div className="modal-action p-4 border-t border-base-300 bg-base-300/30 shrink-0 m-0">
						<form method="dialog">
							<button className="btn btn-sm btn-outline border-base-300 text-[10px] font-mono uppercase tracking-widest px-6">Close Trace Log</button>
						</form>
					</div>
				</div>
				<form method="dialog" className="modal-backdrop bg-base-900/40 backdrop-blur-[2px]">
					<button>close</button>
				</form>
			</dialog>
		</div>
	)
}
export default function HistoryPage() {
	return (
		<Suspense fallback={<div className="h-full flex items-center justify-center"><span className="loading loading-spinner text-success loading-lg" /></div>}>
			<HistoryContent />
		</Suspense>
	)
}
