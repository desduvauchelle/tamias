"use client"

import { useState } from "react"
import { Calendar, Flag, Square } from "lucide-react"
import type { KanbanTask, KanbanComment } from "./types"
import { KANBAN_COLUMNS } from "./types"

interface TaskDetailModalProps {
	task: KanbanTask
	/** Live task data from React Query cache (may have newer comments than the snapshot) */
	liveTask?: KanbanTask
	isAiActive: boolean
	onClose: () => void
	onSave: (updated: KanbanTask) => void
	onDelete: () => void
	onAddComment: (text: string) => void
	onDeleteComment: (commentId: string) => void
	onStopAI?: () => void
}

export default function TaskDetailModal({
	task,
	liveTask,
	isAiActive,
	onClose,
	onSave,
	onDelete,
	onAddComment,
	onDeleteComment,
	onStopAI,
}: TaskDetailModalProps) {
	const [modalTitle, setModalTitle] = useState(task.title || "")
	const [modalDetails, setModalDetails] = useState(task.details || "")
	const [modalAssignee, setModalAssignee] = useState(task.assignee || "")
	const [modalStatus, setModalStatus] = useState(task.status)
	const [modalPriority, setModalPriority] = useState<string>(task.priority || "")
	const [modalDueDate, setModalDueDate] = useState<string>(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : "")
	const [modalLabels, setModalLabels] = useState<string>(task.labels?.join(', ') || "")
	const [newComment, setNewComment] = useState("")

	// Use live data from cache for real-time updates, falling back to snapshot
	const displayedComments = (liveTask?.comments ?? task.comments) || []
	const displayedReaction = liveTask?.reaction ?? task.reaction
	const displayedActivity = (liveTask?.activity ?? task.activity) || []

	const handleSave = () => {
		onSave({
			...task,
			title: modalTitle,
			details: modalDetails,
			assignee: modalAssignee,
			status: modalStatus,
			priority: modalPriority ? modalPriority as KanbanTask['priority'] : undefined,
			dueDate: modalDueDate ? new Date(modalDueDate).getTime() : undefined,
			labels: modalLabels ? modalLabels.split(',').map(l => l.trim()).filter(Boolean) : undefined,
		})
	}

	const handleAddComment = (e: React.FormEvent) => {
		e.preventDefault()
		if (!newComment.trim()) return
		onAddComment(newComment)
		setNewComment("")
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
			<div className="bg-base-100 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-base-300">
				{/* Header */}
				<div className="px-6 py-4 border-b border-base-200 flex justify-between items-center bg-base-200/50">
					<h3 className="font-bold text-lg flex items-center gap-2">
						Task Details
						{displayedReaction && <span>{displayedReaction}</span>}
						{isAiActive && (
							<span className="inline-flex items-center gap-1.5 bg-primary/10 px-2 py-0.5 rounded-full ml-2">
								<span className="relative flex h-2 w-2">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
									<span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
								</span>
								<span className="text-[9px] font-bold text-primary uppercase tracking-wider">AI working</span>
								{onStopAI && (
									<button
										onClick={onStopAI}
										className="ml-1 text-error hover:opacity-80"
										title="Stop AI"
									>
										<Square className="w-3 h-3 fill-current" />
									</button>
								)}
							</span>
						)}
					</h3>
					<div className="flex items-center gap-2">
						<button onClick={onDelete} className="btn btn-sm btn-ghost text-error hover:bg-error/10" title="Delete task">
							<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
							Delete
						</button>
						<button onClick={onClose} className="btn btn-sm btn-ghost btn-circle">✕</button>
					</div>
				</div>

				{/* Body */}
				<div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
					{/* Left Col: Details, Comments & AI Activity */}
					<div className="flex-1 flex flex-col gap-6">
						<div className="form-control">
							<label className="label pt-0"><span className="label-text font-semibold">Title</span></label>
							<textarea
								className="textarea textarea-bordered w-full font-bold text-base resize-none"
								rows={2}
								value={modalTitle}
								onChange={e => setModalTitle(e.target.value)}
							/>
						</div>

						<div className="form-control">
							<label className="label pt-0"><span className="label-text font-semibold">Details</span></label>
							<textarea
								className="textarea textarea-bordered h-32 w-full resize-y font-mono text-sm leading-relaxed"
								placeholder="Add markdown details, task description, acceptance criteria..."
								value={modalDetails}
								onChange={e => setModalDetails(e.target.value)}
							></textarea>
						</div>

						<div className="flex justify-end">
							<button onClick={handleSave} className="btn btn-sm btn-primary gap-1">
								<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
								Save & Notify AI
							</button>
						</div>

						<div className="divider my-0">Comments</div>

						<div className="flex flex-col gap-3">
							{displayedComments.map((c: KanbanComment) => (
								<div key={c.id} className={`group p-3 rounded-xl border ${
									c.author === 'AI'
										? 'bg-primary/5 border-primary/20'
										: 'bg-base-200/50 border-base-300'
								}`}>
									<div className="flex items-center justify-between mb-1">
										<span className="font-bold text-sm text-primary flex items-center gap-2">
											{c.author === 'AI' ? '🤖 AI' : c.author}
											{c.reaction && <span className="text-base font-normal">{c.reaction}</span>}
										</span>
										<div className="flex items-center gap-2">
											<span className="text-xs opacity-50">{new Date(c.createdAt).toLocaleString()}</span>
											<button
												onClick={() => onDeleteComment(c.id)}
												className="opacity-0 group-hover:opacity-100 transition-opacity text-error hover:text-error text-xs btn btn-xs btn-ghost btn-circle"
												title="Delete comment"
											>✕</button>
										</div>
									</div>
									<div className="text-sm whitespace-pre-wrap">{c.text}</div>
								</div>
							))}
							{displayedComments.length === 0 && (
								<div className="text-center opacity-50 text-sm py-4">No comments yet.</div>
							)}

							<form onSubmit={handleAddComment} className="mt-2 flex gap-2">
								<input
									type="text"
									className="input input-bordered input-sm flex-1"
									placeholder="Write a comment..."
									value={newComment}
									onChange={e => setNewComment(e.target.value)}
								/>
								<button type="submit" className="btn btn-sm btn-primary">Send</button>
							</form>
						</div>

						{/* AI Activity Log */}
						{displayedActivity.length > 0 && (
							<>
								<div className="divider my-0">AI Activity</div>
								<div className="flex flex-col gap-1.5">
									{displayedActivity.map(entry => (
										<div key={entry.id} className="flex items-start gap-2 text-xs font-mono bg-base-200/50 px-3 py-2 rounded-lg border border-base-300">
											<span className="opacity-40 tabular-nums shrink-0">
												{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
											</span>
											{entry.type === 'tool' && (
												<span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning font-bold text-[10px]">
													🔧 {entry.text}
												</span>
											)}
											{entry.type === 'text' && (
												<span className="opacity-70 text-[10px] whitespace-pre-wrap">{entry.text}</span>
											)}
											{entry.type === 'status' && (
												<span className="opacity-60 text-[10px]">{entry.text}</span>
											)}
										</div>
									))}
								</div>
							</>
						)}
					</div>

					{/* Right Col: Metadata */}
					<div className="w-full md:w-64 flex flex-col gap-4 shrink-0">
						<div className="form-control">
							<label className="label pt-0"><span className="label-text font-semibold">Status</span></label>
							<select
								className="select select-bordered select-sm w-full"
								value={modalStatus}
								onChange={e => setModalStatus(e.target.value)}
							>
								{KANBAN_COLUMNS.map(col => (
									<option key={col} value={col}>{col.replace('-', ' ')}</option>
								))}
							</select>
						</div>

						<div className="form-control">
							<label className="label pt-0"><span className="label-text font-semibold">Assignee</span></label>
							<input
								type="text"
								className="input input-bordered input-sm w-full"
								placeholder="e.g. AI or User"
								value={modalAssignee}
								onChange={e => setModalAssignee(e.target.value)}
							/>
							<div className="flex gap-2 mt-2">
								<button onClick={() => setModalAssignee('AI')} className="badge badge-outline hover:bg-primary hover:text-primary-content cursor-pointer transition-colors">AI</button>
								<button onClick={() => setModalAssignee('User')} className="badge badge-outline hover:bg-primary hover:text-primary-content cursor-pointer transition-colors">User</button>
							</div>
						</div>

						<div className="form-control">
							<label className="label pt-0"><span className="label-text font-semibold flex items-center gap-1"><Flag className="w-3 h-3" /> Priority</span></label>
							<select
								className="select select-bordered select-sm w-full"
								value={modalPriority}
								onChange={e => setModalPriority(e.target.value)}
							>
								<option value="">None</option>
								<option value="low">Low</option>
								<option value="medium">Medium</option>
								<option value="high">High</option>
								<option value="urgent">Urgent</option>
							</select>
						</div>

						<div className="form-control">
							<label className="label pt-0"><span className="label-text font-semibold flex items-center gap-1"><Calendar className="w-3 h-3" /> Due Date</span></label>
							<input
								type="date"
								className="input input-bordered input-sm w-full"
								value={modalDueDate}
								onChange={e => setModalDueDate(e.target.value)}
							/>
						</div>

						<div className="form-control">
							<label className="label pt-0"><span className="label-text font-semibold">Labels</span></label>
							<input
								type="text"
								className="input input-bordered input-sm w-full"
								placeholder="bug, feature, docs (comma-separated)"
								value={modalLabels}
								onChange={e => setModalLabels(e.target.value)}
							/>
						</div>

						<div className="text-xs opacity-50 mt-auto pt-4 border-t border-base-200">
							Created: {new Date(task.createdAt).toLocaleString()}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
