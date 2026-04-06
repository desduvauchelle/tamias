"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronDown, ChevronUp, Square } from "lucide-react"
import type { AiLogEntry, AiStatus } from "./useKanbanAI"
import type { KanbanTask } from "./types"

interface AiActivityPanelProps {
	aiStatus: AiStatus
	aiLog: AiLogEntry[]
	aiTextPreview: string
	aiTaskFeed: Map<string, AiLogEntry[]>
	tasks: KanbanTask[]
	onDismiss: () => void
	onStop: () => void
}

export default function AiActivityPanel({
	aiStatus,
	aiLog,
	aiTextPreview,
	aiTaskFeed,
	tasks,
	onDismiss,
	onStop,
}: AiActivityPanelProps) {
	const [isExpanded, setIsExpanded] = useState(false)
	const feedEndRef = useRef<HTMLDivElement>(null)

	// Auto-scroll feed to bottom on new entries
	useEffect(() => {
		if (isExpanded && feedEndRef.current) {
			feedEndRef.current.scrollIntoView({ behavior: 'smooth' })
		}
	}, [aiLog, aiTextPreview, isExpanded])

	if (aiStatus === 'idle') return null

	const statusColor = aiStatus === 'thinking' ? 'primary' : aiStatus === 'done' ? 'success' : 'error'
	const statusBg = aiStatus === 'thinking' ? 'bg-primary/10 border-primary/30 text-primary' :
		aiStatus === 'done' ? 'bg-success/10 border-success/30 text-success' :
		'bg-error/10 border-error/30 text-error'

	const taskTitle = (taskId: string) => {
		const t = tasks.find(tk => tk.id === taskId)
		return t ? t.title : taskId
	}

	return (
		<div className={`shrink-0 mx-4 mt-3 rounded-xl border px-4 py-3 font-mono text-xs transition-all ${statusBg}`}>
			{/* Compact header */}
			<div className="flex items-center gap-3">
				{aiStatus === 'thinking' ? (
					<span className="relative flex h-2.5 w-2.5 shrink-0">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
						<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
					</span>
				) : (
					<span className={`h-2.5 w-2.5 rounded-full bg-${statusColor} shrink-0`}></span>
				)}
				<span className="font-bold uppercase tracking-wider text-[10px]">
					{aiStatus === 'thinking' ? 'AI is working...' : aiStatus === 'done' ? 'AI done' : 'AI error'}
				</span>

				{/* Tool call badges (compact view) */}
				{!isExpanded && aiLog.filter(e => e.type === 'tool').length > 0 && (
					<div className="flex flex-wrap gap-1 ml-1">
						{aiLog.filter(e => e.type === 'tool').slice(-5).map((entry, i) => (
							<span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning/20 text-warning">
								🔧 {entry.text}
							</span>
						))}
					</div>
				)}

				<div className="ml-auto flex items-center gap-1">
					{aiStatus === 'thinking' && (
						<button
							className="opacity-60 hover:opacity-100 p-0.5 text-error"
							onClick={onStop}
							title="Stop AI"
						>
							<Square className="w-3.5 h-3.5 fill-current" />
						</button>
					)}
					<button
						className="opacity-40 hover:opacity-80 p-0.5"
						onClick={() => setIsExpanded(!isExpanded)}
						title={isExpanded ? 'Collapse' : 'Expand live feed'}
					>
						{isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
					</button>
					<button
						className="opacity-40 hover:opacity-80"
						onClick={onDismiss}
					>✕</button>
				</div>
			</div>

			{/* Compact preview (when collapsed) */}
			{!isExpanded && aiTextPreview && aiStatus === 'thinking' && (
				<div className="text-[10px] opacity-60 leading-relaxed line-clamp-2 break-all mt-2">
					{aiTextPreview}<span className="animate-pulse">▋</span>
				</div>
			)}

			{/* Expanded live feed */}
			{isExpanded && (
				<div className="mt-3 max-h-72 overflow-y-auto border-t border-current/10 pt-3 space-y-3">
					{/* Per-task sections */}
					{aiTaskFeed.size > 0 && (
						<div className="space-y-2">
							{Array.from(aiTaskFeed.entries()).map(([taskId, entries]) => (
								<div key={taskId} className="bg-base-100/10 rounded-lg p-2">
									<div className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1.5 flex items-center gap-1.5">
										<span className="relative flex h-1.5 w-1.5">
											<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-50"></span>
											<span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current"></span>
										</span>
										{taskTitle(taskId)}
									</div>
									<div className="space-y-1">
										{entries.map((entry, i) => (
											<div key={i} className="flex items-center gap-2 text-[10px]">
												<span className="opacity-40 tabular-nums shrink-0">
													{new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
												</span>
												{entry.type === 'tool' && (
													<span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning font-bold">
														🔧 {entry.text}
													</span>
												)}
												{entry.type === 'status' && (
													<span className="opacity-70">{entry.text}</span>
												)}
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					)}

					{/* General log entries (no taskId) */}
					{aiLog.filter(e => !e.taskId).length > 0 && (
						<div className="space-y-1">
							{aiLog.filter(e => !e.taskId).map((entry, i) => (
								<div key={i} className="flex items-center gap-2 text-[10px]">
									<span className="opacity-40 tabular-nums shrink-0">
										{new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
									</span>
									{entry.type === 'tool' && (
										<span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning font-bold">
											🔧 {entry.text}
										</span>
									)}
									{entry.type === 'status' && (
										<span className="opacity-70">{entry.text}</span>
									)}
								</div>
							))}
						</div>
					)}

					{/* Full text output */}
					{aiTextPreview && (
						<div className="text-[10px] opacity-60 leading-relaxed break-all whitespace-pre-wrap bg-base-100/10 rounded p-2">
							{aiTextPreview}
							{aiStatus === 'thinking' && <span className="animate-pulse">▋</span>}
						</div>
					)}

					<div ref={feedEndRef} />
				</div>
			)}
		</div>
	)
}
