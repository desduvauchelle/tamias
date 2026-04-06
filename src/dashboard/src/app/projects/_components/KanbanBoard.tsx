"use client"

import { useState, useCallback } from "react"
import { Plus } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "../../_components/ToastProvider"
import type { KanbanTask, KanbanComment, KanbanActivity, Project } from "./types"
import { KANBAN_COLUMNS } from "./types"
import KanbanCard from "./KanbanCard"
import AiActivityPanel from "./AiActivityPanel"
import TaskDetailModal from "./TaskDetailModal"
import { useKanbanAI, logEntriesToActivity } from "./useKanbanAI"
import type { AiLogEntry } from "./useKanbanAI"

interface KanbanBoardProps {
	project: Project
	onProjectUpdate: (project: Project) => void
}

const COLUMN_LABELS: Record<string, string> = {
	backlog: 'Backlog',
	queue: 'Queue',
	'in-progress': 'In Progress',
	done: 'Done',
	failed: 'Failed',
}

export default function KanbanBoard({ project, onProjectUpdate }: KanbanBoardProps) {
	const queryClient = useQueryClient()
	const { success, error } = useToast()

	const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
	const [dragOverCol, setDragOverCol] = useState<string | null>(null)
	const [newTaskTitle, setNewTaskTitle] = useState("")
	const [newTaskCol, setNewTaskCol] = useState("")
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

	const updateKanban = useCallback(async (newKanban: KanbanTask[]) => {
		try {
			const res = await fetch(`/api/projects/${project.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ kanban: newKanban })
			})
			if (res.ok) {
				const updated = await res.json()
				onProjectUpdate(updated)
				queryClient.invalidateQueries({ queryKey: ['projects'] })
				return true
			} else {
				error("Failed to update kanban")
				return false
			}
		} catch {
			error("Error saving kanban")
			return false
		}
	}, [project.id, onProjectUpdate, queryClient, error])

	// Called when AI finishes — saves tool-call entries as activity on affected cards
	const handleActivityComplete = useCallback(async (feed: Map<string, AiLogEntry[]>, _textOutput: string) => {
		const kanban = project.kanban || []
		if (feed.size === 0) return

		const updatedKanban = kanban.map(task => {
			const entries = feed.get(task.id)
			if (!entries || entries.length === 0) return task
			const newActivity: KanbanActivity[] = logEntriesToActivity(entries)
			return {
				...task,
				activity: [...(task.activity || []), ...newActivity],
			}
		})

		const changed = updatedKanban.some((t, i) => t.activity !== kanban[i]?.activity)
		if (changed) {
			await updateKanban(updatedKanban)
		}
	}, [project.kanban, updateKanban])

	const {
		aiStatus,
		aiLog,
		aiTextPreview,
		aiActiveTaskIds,
		aiTaskFeed,
		startWatchingAI,
		stopAI,
		dismiss: dismissAI,
	} = useKanbanAI(handleActivityComplete)

	const notifyAI = useCallback(async (oldKanban: KanbanTask[], newKanban: KanbanTask[]) => {
		try {
			startWatchingAI(project.id)
			await fetch('/api/project-event', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'kanban_changed',
					projectId: project.id,
					oldKanban,
					newKanban
				})
			})
		} catch (e) {
			console.error('Failed to notify AI of kanban event', e)
		}
	}, [project.id, startWatchingAI])

	const addTask = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!newTaskTitle.trim()) return

		const newTask: KanbanTask = {
			id: Math.random().toString(36).substring(2, 9),
			title: newTaskTitle,
			status: newTaskCol,
			createdAt: Date.now()
		}

		const oldKanban = project.kanban || []
		const updatedKanban = [...oldKanban, newTask]
		const ok = await updateKanban(updatedKanban)
		if (ok) {
			setNewTaskTitle('')
			setNewTaskCol('')
			await notifyAI(oldKanban, updatedKanban)
		}
	}

	const moveTask = async (taskId: string, newStatus: string) => {
		const oldKanban = project.kanban || []
		const updatedKanban = oldKanban.map(t =>
			t.id === taskId ? { ...t, status: newStatus } : t
		)
		await updateKanban(updatedKanban)
	}

	const removeTask = async (taskId: string) => {
		if (!confirm('Delete task?')) return
		const updatedKanban = (project.kanban || []).filter(t => t.id !== taskId)
		await updateKanban(updatedKanban)
	}

	const selectedTask = selectedTaskId
		? (project.kanban || []).find(t => t.id === selectedTaskId) || null
		: null

	const saveTaskDetails = async (updatedTask: KanbanTask) => {
		const oldKanban = project.kanban || []
		const updatedKanban = oldKanban.map(t =>
			t.id === updatedTask.id ? updatedTask : t
		)
		const ok = await updateKanban(updatedKanban)
		if (ok) {
			success('Task updated')
			await notifyAI(oldKanban, updatedKanban)
		}
	}

	const deleteTaskFromModal = async () => {
		if (!selectedTask || !confirm('Delete this task?')) return
		const oldKanban = project.kanban || []
		const updatedKanban = oldKanban.filter(t => t.id !== selectedTask.id)
		const ok = await updateKanban(updatedKanban)
		if (ok) {
			setSelectedTaskId(null)
			await notifyAI(oldKanban, updatedKanban)
		}
	}

	const addComment = async (text: string) => {
		if (!selectedTask) return
		const comment: KanbanComment = {
			id: Math.random().toString(36).substring(2, 9),
			author: 'User',
			text,
			createdAt: Date.now()
		}
		const updatedTask = {
			...selectedTask,
			comments: [...(selectedTask.comments || []), comment]
		}
		const oldKanban = project.kanban || []
		const updatedKanban = oldKanban.map(t =>
			t.id === selectedTask.id ? updatedTask : t
		)
		const ok = await updateKanban(updatedKanban)
		if (ok) {
			await notifyAI(oldKanban, updatedKanban)
		}
	}

	const deleteComment = async (commentId: string) => {
		if (!selectedTask) return
		const updatedTask = {
			...selectedTask,
			comments: (selectedTask.comments || []).filter(c => c.id !== commentId)
		}
		const updatedKanban = (project.kanban || []).map(t =>
			t.id === selectedTask.id ? updatedTask : t
		)
		await updateKanban(updatedKanban)
	}

	return (
		<div className="absolute inset-0 flex flex-col">
			{/* AI Activity Panel */}
			<AiActivityPanel
				aiStatus={aiStatus}
				aiLog={aiLog}
				aiTextPreview={aiTextPreview}
				aiTaskFeed={aiTaskFeed}
				tasks={project.kanban || []}
				onDismiss={dismissAI}
				onStop={stopAI}
			/>

			{/* Kanban columns */}
			<div className="flex-1 flex gap-4 p-6 pt-3 overflow-x-auto items-start min-h-0">
				{KANBAN_COLUMNS.map(col => {
					const isBacklog = col === 'backlog'
					let colTasks = (project.kanban || []).filter(t => {
						if (isBacklog) {
							return t.status === 'backlog' || !KANBAN_COLUMNS.includes(t.status as typeof KANBAN_COLUMNS[number])
						}
						return t.status === col
					})
					const totalInCol = colTasks.length

					if (col === 'done' || col === 'failed') {
						colTasks = [...colTasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
					}

					const isDragOver = dragOverCol === col

					return (
						<div
							key={col}
							onDragOver={(e) => { e.preventDefault(); setDragOverCol(col) }}
							onDragLeave={() => setDragOverCol(null)}
							onDrop={(e) => {
								e.preventDefault()
								if (draggedTaskId) {
									moveTask(draggedTaskId, col)
									setDraggedTaskId(null)
								}
								setDragOverCol(null)
							}}
							className={`w-72 shrink-0 flex flex-col max-h-full rounded-xl border transition-colors ${isDragOver
									? 'bg-primary/10 border-primary/50'
									: 'bg-base-200/50 border-base-300'
								}`}
						>
							<div className="p-3 border-b border-base-300/50 flex justify-between items-center bg-base-300/30 rounded-t-xl">
								<div className="flex flex-col">
									<h3 className="font-bold text-sm uppercase tracking-wider text-base-content/70">
										{COLUMN_LABELS[col] ?? col}
									</h3>
									{(col === 'done' || col === 'failed') && totalInCol > 10 && (
										<span className="text-[10px] opacity-50 font-medium">Showing last 10</span>
									)}
								</div>
								<span className="text-xs font-mono bg-base-300 px-2 py-0.5 rounded-full">{totalInCol}</span>
							</div>
							<div className="p-3 flex-1 overflow-y-auto space-y-3">
								{colTasks.map(task => (
									<KanbanCard
										key={task.id}
										task={task}
										isAiActive={aiActiveTaskIds.has(task.id)}
										isDragging={draggedTaskId === task.id}
										onDragStart={() => setDraggedTaskId(task.id)}
										onDragEnd={() => setDraggedTaskId(null)}
										onClick={() => setSelectedTaskId(task.id)}
										onStopAI={stopAI}
										onRemoveTask={removeTask}
									/>
								))}

								{newTaskCol === col ? (
									<form onSubmit={addTask} className="bg-base-100 p-2 rounded-lg border border-primary/50 flex flex-col gap-2">
										<input
											autoFocus
											value={newTaskTitle}
											onChange={e => setNewTaskTitle(e.target.value)}
											placeholder="Task title..."
											className="input input-sm input-ghost w-full px-2"
										/>
										<div className="flex gap-2 justify-end">
											<button type="button" onClick={() => setNewTaskCol('')} className="btn btn-ghost btn-xs">Cancel</button>
											<button type="submit" className="btn btn-primary btn-xs">Add</button>
										</div>
									</form>
								) : (
									<button
										onClick={() => { setNewTaskCol(col); setNewTaskTitle('') }}
										className="w-full py-2 text-sm text-base-content/50 hover:text-base-content hover:bg-base-300/50 rounded-lg flex items-center justify-center gap-1 transition-colors"
									>
										<Plus className="w-4 h-4" /> Add Task
									</button>
								)}
							</div>
						</div>
					)
				})}
			</div>

			{/* Task Detail Modal */}
			{selectedTask && (
				<TaskDetailModal
					task={selectedTask}
					liveTask={(project.kanban || []).find(t => t.id === selectedTaskId) || undefined}
					isAiActive={aiActiveTaskIds.has(selectedTask.id)}
					onClose={() => setSelectedTaskId(null)}
					onSave={saveTaskDetails}
					onDelete={deleteTaskFromModal}
					onAddComment={addComment}
					onDeleteComment={deleteComment}
					onStopAI={stopAI}
				/>
			)}
		</div>
	)
}
