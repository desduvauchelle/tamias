"use client"

import { Calendar } from "lucide-react"
import type { KanbanTask } from "./types"
import { KANBAN_COLUMNS } from "./types"

interface KanbanCardProps {
	task: KanbanTask
	column: string
	isAiActive: boolean
	isDragging: boolean
	onDragStart: () => void
	onDragEnd: () => void
	onClick: () => void
	onMoveTask: (taskId: string, newStatus: string) => void
	onRemoveTask: (taskId: string) => void
}

export default function KanbanCard({
	task,
	column,
	isAiActive,
	isDragging,
	onDragStart,
	onDragEnd,
	onClick,
	onMoveTask,
	onRemoveTask,
}: KanbanCardProps) {
	return (
		<div
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onClick={onClick}
			className={`bg-base-100 p-3 rounded-lg border shadow-sm group cursor-pointer transition-all relative ${
				isDragging ? 'opacity-50' : ''
			} ${
				isAiActive
					? 'border-primary ring-2 ring-primary/40 animate-[kanban-pulse_2s_ease-in-out_infinite]'
					: 'border-base-300 hover:border-primary/50'
			}`}
		>
			{/* AI working indicator */}
			{isAiActive && (
				<div className="absolute top-2 right-2 flex items-center gap-1.5 bg-primary/10 px-2 py-0.5 rounded-full z-10">
					<span className="relative flex h-2 w-2">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
						<span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
					</span>
					<span className="text-[9px] font-bold text-primary uppercase tracking-wider">AI</span>
				</div>
			)}

			<div className={`text-sm font-medium ${isAiActive ? 'pr-16' : 'pr-6'}`}>{task.title}</div>

			{/* Badges */}
			<div className="flex flex-wrap gap-2 mt-2">
				{task.priority && task.priority !== 'medium' && (
					<span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
						task.priority === 'urgent' ? 'bg-error/20 text-error' :
						task.priority === 'high' ? 'bg-warning/20 text-warning' :
						'bg-base-300 text-base-content/50'
					}`}>
						{task.priority}
					</span>
				)}
				{task.dueDate && (
					<span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 ${
						task.dueDate < Date.now() ? 'bg-error/20 text-error' : 'bg-info/10 text-info'
					}`}>
						<Calendar className="w-3 h-3" />
						{new Date(task.dueDate).toLocaleDateString()}
					</span>
				)}
				{task.labels && task.labels.map(label => (
					<span key={label} className="text-[10px] px-2 py-0.5 bg-accent/10 text-accent rounded-full">
						{label}
					</span>
				))}
				{task.reaction && (
					<span className="text-[14px]">
						{task.reaction}
					</span>
				)}
				{task.assignee && (
					<span className="text-[10px] px-2 py-0.5 bg-secondary/10 text-secondary rounded-full font-medium">
						{task.assignee}
					</span>
				)}
				{task.comments && task.comments.length > 0 && (
					<span className="text-[10px] px-1.5 py-0.5 bg-base-200 text-base-content/70 rounded flex items-center gap-1">
						💬 {task.comments.length}
					</span>
				)}
			</div>

			<div className="flex justify-between items-end mt-3 relative z-10">
				<div className="flex gap-1">
					{KANBAN_COLUMNS.map(targetCol => targetCol !== column && (
						<button
							key={targetCol}
							onClick={(e) => { e.stopPropagation(); onMoveTask(task.id, targetCol) }}
							className="text-[10px] px-1.5 py-0.5 bg-base-200 hover:bg-primary/20 hover:text-primary rounded text-base-content/50 transition-colors"
						>
							{targetCol === 'done' ? '→ Done' : targetCol === 'todo' ? '← To Do' : '→ Doing'}
						</button>
					))}
				</div>
				<button onClick={(e) => { e.stopPropagation(); onRemoveTask(task.id) }} className="text-error/50 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
		</div>
	)
}
