"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter } from 'next/navigation'
import { useToast } from "../_components/ToastProvider"
import { KanbanSquare, FolderOpen, Settings, Plus, LayoutDashboard, ExternalLink, Link as LinkIcon, Edit, Check, FileText } from "lucide-react"
import FileNavigator from '../_components/FileNavigator'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface KanbanComment {
	id: string
	author: string
	text: string
	createdAt: number
}

interface KanbanTask {
	id: string
	title: string
	description?: string
	details?: string
	assignee?: string
	reaction?: string
	status: string
	createdAt: number
	comments?: KanbanComment[]
}

interface Project {
	id: string
	name: string
	description?: string
	path: string
	discordServerId?: string
	discordChannelId?: string
	contextFile?: string
	kanban: KanbanTask[]
}

interface DiscordChannel {
	id: string
	name: string
	guildId: string
	guildName: string
	instanceKey: string
}

import { Suspense } from 'react'

function ProjectsContent() {
	const searchParams = useSearchParams()
	const router = useRouter()
	const projectId = searchParams.get('id')

	const [projects, setProjects] = useState<Project[]>([])
	const [activeProject, setActiveProject] = useState<Project | null>(null)
	const [loading, setLoading] = useState(true)
	const [activeTab, setActiveTab] = useState<'overview' | 'kanban' | 'files' | 'settings'>('overview')
	const [channels, setChannels] = useState<DiscordChannel[]>([])

	// Task Modal State
	const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null)
	const [modalDetails, setModalDetails] = useState("")
	const [modalAssignee, setModalAssignee] = useState("")
	const [modalStatus, setModalStatus] = useState("")
	const [newComment, setNewComment] = useState("")

	const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)

	const { toast, success, error } = useToast()

	// Form State for new/editing project
	const [formName, setFormName] = useState("")
	const [formDesc, setFormDesc] = useState("")
	const [formPath, setFormPath] = useState("")
	const [formChannel, setFormChannel] = useState("")
	const [formContext, setFormContext] = useState("readme.md")

	// Context Markdown State
	const [contextMarkdown, setContextMarkdown] = useState<string>("")
	const [isEditingContext, setIsEditingContext] = useState(false)
	const [editedContext, setEditedContext] = useState("")

	// Kanban State
	const [newTaskTitle, setNewTaskTitle] = useState("")
	const [newTaskCol, setNewTaskCol] = useState("")

	const KANBAN_COLUMNS = ['todo', 'in-progress', 'awaiting-review', 'done']

	useEffect(() => {
		fetchProjects()
		fetchChannels()
	}, [])

	const fetchProjects = async () => {
		try {
			const res = await fetch("/api/projects")
			if (res.ok) {
				const data: Project[] = await res.json()
				setProjects(data)
			}
		} catch (e) {
			console.error("Failed to list projects", e)
		} finally {
			setLoading(false)
		}
	}

	// Update active project when ID param changes or projects load
	useEffect(() => {
		if (projectId && projects.length > 0) {
			const found = projects.find(p => p.id === projectId)
			if (found) {
				setActiveProject(found)

				// Initialize forms with active project data
				setFormName(found.name)
				setFormDesc(found.description || "")
				setFormPath(found.path)
				setFormChannel(found.discordChannelId || "")
				setFormContext(found.contextFile || "readme.md")
			} else {
				setActiveProject(null)
			}
		} else if (!projectId) {
			setActiveProject(null)
		}
	}, [projectId, projects])

	// Fetch Markdown for Overview
	useEffect(() => {
		if (activeTab === 'overview' && activeProject && activeProject.contextFile) {
			fetchContextMarkdown(activeProject)
		}
	}, [activeTab, activeProject])

	const fetchContextMarkdown = async (proj: Project) => {
		try {
			const rawPath = proj.path ? `${proj.path}/${proj.contextFile}` : (proj.contextFile || "")
			const res = await fetch(`/api/files/content?path=${encodeURIComponent(rawPath)}`)
			if (res.ok) {
				const fileData = await res.json()
				setContextMarkdown(fileData.content || `> ${proj.contextFile} is empty`)
			} else {
				setContextMarkdown(`> Could not load ${proj.contextFile}`)
			}
		} catch (e) {
			setContextMarkdown(`> Error loading ${proj.contextFile}`)
		}
	}

	const saveContextMarkdown = async () => {
		if (!activeProject) return
		try {
			const rawPath = activeProject.path ? `${activeProject.path}/${activeProject.contextFile}` : (activeProject.contextFile || "")
			const res = await fetch(`/api/files/content?path=${encodeURIComponent(rawPath)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: editedContext }),
			})
			if (res.ok) {
				success("Saved context file")
				setContextMarkdown(editedContext)
				setIsEditingContext(false)
			} else {
				error("Failed to save")
			}
		} catch (e) {
			error("Failed to save")
		}
	}

	const fetchChannels = async () => {
		try {
			const res = await fetch("/api/discord/channels")
			if (res.ok) {
				const data = await res.json()
				setChannels(data.channels || [])
			}
		} catch (e) {
			console.error("Failed to list channels", e)
		}
	}

	const handleSave = async () => {
		if (!formName || !formPath) {
			error("Name and Path are required")
			return
		}

		const method = activeProject ? "PUT" : "POST"
		const url = activeProject ? `/api/projects/${activeProject.id}` : `/api/projects`

		const selectedChannel = channels.find(c => c.id === formChannel)

		try {
			const res = await fetch(url, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: formName,
					description: formDesc,
					path: formPath,
					discordChannelId: selectedChannel?.id || undefined,
					discordServerId: selectedChannel?.guildId || undefined,
					contextFile: formContext
				})
			})

			if (res.ok) {
				const updated = await res.json()
				success("Project config saved!")
				fetchProjects()

				// If creating new, navigate to it
				if (!activeProject) {
					router.push(`/projects?id=${updated.id}`)
				}
			} else {
				const errorData = await res.json()
				error(errorData.error || "Failed to save project")
			}
		} catch (err: any) {
			error(err.message || "An error occurred")
		}
	}

	const handleDelete = async (id: string) => {
		if (!confirm(`Are you sure you want to delete this project?`)) return

		try {
			const res = await fetch(`/api/projects/${id}`, { method: "DELETE" })
			if (res.ok) {
				success("Project deleted")
				router.push('/projects')
				fetchProjects()
			} else {
				error("Failed to delete project")
			}
		} catch (err) {
			error("An error occurred")
		}
	}

	/* KANBAN UTILS */
	const addTask = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!newTaskTitle.trim() || !activeProject) return

		const newTask: KanbanTask = {
			id: Math.random().toString(36).substring(2, 9),
			title: newTaskTitle,
			status: newTaskCol,
			createdAt: Date.now()
		}

		const updatedKanban = [...(activeProject.kanban || []), newTask]
		await updateKanban(updatedKanban)
		setNewTaskTitle("")
		setNewTaskCol("")
	}

	const moveTask = async (taskId: string, newStatus: string) => {
		if (!activeProject) return
		const updatedKanban = (activeProject.kanban || []).map(t =>
			t.id === taskId ? { ...t, status: newStatus } : t
		)
		await updateKanban(updatedKanban)
	}

	const removeTask = async (taskId: string) => {
		if (!activeProject || !confirm("Delete task?")) return
		const updatedKanban = (activeProject.kanban || []).filter(t => t.id !== taskId)
		await updateKanban(updatedKanban)
	}

	const updateKanban = async (newKanban: KanbanTask[]) => {
		try {
			const res = await fetch(`/api/projects/${activeProject!.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ kanban: newKanban })
			})
			if (res.ok) {
				const updated = await res.json()
				setActiveProject(updated)
				setProjects(projects.map(p => p.id === updated.id ? updated : p))
				return true
			} else {
				error("Failed to update kanban")
				return false
			}
		} catch {
			error("Error saving kanban")
			return false
		}
	}

	const openTaskModal = (task: KanbanTask) => {
		setSelectedTask(task)
		setModalDetails(task.details || "")
		setModalAssignee(task.assignee || "")
		setModalStatus(task.status)
		setNewComment("")
	}

	const closeTaskModal = () => {
		setSelectedTask(null)
	}

	const saveTaskDetails = async () => {
		if (!selectedTask || !activeProject) return
		const updatedTask = {
			...selectedTask,
			details: modalDetails,
			assignee: modalAssignee,
			status: modalStatus
		}
		const updatedKanban = (activeProject.kanban || []).map(t =>
			t.id === selectedTask.id ? updatedTask : t
		)
		const ok = await updateKanban(updatedKanban)
		if (ok) {
			success("Task updated")
			setSelectedTask(updatedTask)
		}
	}

	const addComment = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!selectedTask || !activeProject || !newComment.trim()) return

		const comment: KanbanComment = {
			id: Math.random().toString(36).substring(2, 9),
			author: "User", // Hardcoded for dashboard for now
			text: newComment,
			createdAt: Date.now()
		}

		const updatedTask = {
			...selectedTask,
			comments: [...(selectedTask.comments || []), comment]
		}

		const updatedKanban = (activeProject.kanban || []).map(t =>
			t.id === selectedTask.id ? updatedTask : t
		)
		const ok = await updateKanban(updatedKanban)
		if (ok) {
			setNewComment("")
			setSelectedTask(updatedTask)
		}
	}

	return (
		<div className="flex h-full w-full bg-base-100 items-start justify-center overflow-hidden">
			{!activeProject && !projectId ? (
				<div className="flex-1 flex flex-col items-center justify-center p-8">
					<div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mb-6 transform rotate-3">
						<LayoutDashboard className="w-10 h-10 text-primary" />
					</div>
					<h3 className="text-2xl font-bold text-base-content mb-2">Projects Hub</h3>
					<p className="text-base-content/60 text-center max-w-md mb-8">
						Select a project from the Workspace menu in the sidebar, or create a new one to manage Kanban tasks securely bounded by context.
					</p>
				</div>
			) : !activeProject && projectId ? (
				<div className="flex-1 flex flex-col items-center justify-center p-8">
					<span className="loading loading-spinner text-primary"></span>
				</div>
			) : activeProject && (
				<div className="flex flex-col h-full w-full overflow-hidden bg-base-100">
					{/* Header & Tabs */}
					<div className="p-0 border-b border-base-200/50 bg-base-100/50 backdrop-blur z-10 shrink-0">
						<div className="p-6 pb-4 flex justify-between items-start">
							<div>
								<h2 className="text-3xl font-bold flex items-center gap-3 mb-2 text-primary">
									{activeProject.name}
								</h2>
								<div className="flex flex-wrap items-center gap-4 text-xs font-medium text-base-content/60">
									<span className="flex items-center gap-1 font-mono bg-base-200 px-2 py-1 rounded-md border border-base-300">
										<FolderOpen className="w-4 h-4 text-warning" /> ~/.tamias/{activeProject.path}
									</span>
									{activeProject.discordChannelId && (
										<span className="flex items-center gap-1 text-info bg-info/10 px-2 py-1 rounded-md border border-info/20">
											<LinkIcon className="w-4 h-4" /> Discord Configured
										</span>
									)}
								</div>
							</div>
						</div>

						<div className="tabs tabs-bordered px-6 border-b-0">
							<button
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'overview' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('overview')}
							>
								<FileText className="w-4 h-4" /> Overview
							</button>
							<button
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'kanban' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('kanban')}
							>
								<KanbanSquare className="w-4 h-4" /> Kanban Board
							</button>
							<button
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'files' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('files')}
							>
								<FolderOpen className="w-4 h-4" /> Files
							</button>
							<button
								className={`tab tab-lg gap-2 transition-all ml-auto ${activeTab === 'settings' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('settings')}
							>
								<Settings className="w-4 h-4" /> Config
							</button>
						</div>
					</div>

					{/* Tab Content */}
					<div className="flex-1 overflow-hidden bg-base-200/20 relative">

						{activeTab === 'overview' && (
							<div className="h-full w-full overflow-y-auto p-8 max-w-4xl mx-auto">
								<div className="flex justify-between items-center mb-6 border-b border-base-300 pb-4">
									<h3 className="font-bold font-mono text-base-content/60">{activeProject.contextFile || 'readme.md'}</h3>
									{isEditingContext ? (
										<div className="flex gap-2">
											<button onClick={() => setIsEditingContext(false)} className="btn btn-ghost btn-xs">Cancel</button>
											<button onClick={saveContextMarkdown} className="btn btn-primary btn-xs">Save</button>
										</div>
									) : (
										<button onClick={() => { setEditedContext(contextMarkdown); setIsEditingContext(true) }} className="btn btn-ghost btn-xs gap-2">
											<Edit className="w-3 h-3" /> Edit Context
										</button>
									)}
								</div>

								{isEditingContext ? (
									<textarea
										className="textarea textarea-bordered w-full h-96 font-mono text-sm leading-relaxed"
										value={editedContext}
										onChange={e => setEditedContext(e.target.value)}
									></textarea>
								) : (
									<div
										className="prose prose-sm md:prose-base prose-invert prose-p:leading-relaxed prose-pre:bg-base-300 prose-pre:border prose-pre:border-base-content/10 max-w-none"
										dangerouslySetInnerHTML={{
											__html: DOMPurify.sanitize(marked.parse(contextMarkdown) as string)
										}}
									/>
								)}
							</div>
						)}

						{activeTab === 'kanban' && (
							<div className="absolute inset-0 flex gap-4 p-6 overflow-x-auto items-start">
								{KANBAN_COLUMNS.map(col => {
									let colTasks = (activeProject.kanban || []).filter(t => t.status === col)
									const totalInCol = colTasks.length

									if (col === 'done') {
										// Sort by createdAt desc and take 10
										colTasks = [...colTasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
									}

									return (
										<div
											key={col}
											onDragOver={(e) => e.preventDefault()}
											onDrop={(e) => {
												e.preventDefault()
												if (draggedTaskId) {
													moveTask(draggedTaskId, col)
													setDraggedTaskId(null)
												}
											}}
											className="w-72 shrink-0 flex flex-col max-h-full bg-base-200/50 rounded-xl border border-base-300"
										>
											<div className="p-3 border-b border-base-300/50 flex justify-between items-center bg-base-300/30 rounded-t-xl">
												<div className="flex flex-col">
													<h3 className="font-bold text-sm uppercase tracking-wider text-base-content/70">{col.replace('-', ' ')}</h3>
													{col === 'done' && totalInCol > 10 && (
														<span className="text-[10px] opacity-50 font-medium">Showing last 10 tasks</span>
													)}
												</div>
												<span className="text-xs font-mono bg-base-300 px-2 py-0.5 rounded-full">{totalInCol}</span>
											</div>
											<div className="p-3 flex-1 overflow-y-auto space-y-3">
												{colTasks.map(task => (
													<div
														key={task.id}
														draggable
														onDragStart={() => setDraggedTaskId(task.id)}
														onDragEnd={() => setDraggedTaskId(null)}
														onClick={() => openTaskModal(task)}
														className={`bg-base-100 p-3 rounded-lg border border-base-300 shadow-sm group cursor-pointer hover:border-primary/50 transition-colors relative ${draggedTaskId === task.id ? 'opacity-50' : ''}`}
													>
														<div className="text-sm font-medium pr-6">{task.title}</div>

														{/* Badges */}
														<div className="flex flex-wrap gap-2 mt-2">
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
																{KANBAN_COLUMNS.map(targetCol => targetCol !== col && (
																	<button
																		key={targetCol}
																		onClick={(e) => { e.stopPropagation(); moveTask(task.id, targetCol) }}
																		className="text-[10px] px-1.5 py-0.5 bg-base-200 hover:bg-primary/20 hover:text-primary rounded text-base-content/50 transition-colors"
																	>
																		{targetCol === 'done' ? '→ Done' : targetCol === 'todo' ? '← To Do' : '→ Doing'}
																	</button>
																))}
															</div>
															<button onClick={(e) => { e.stopPropagation(); removeTask(task.id) }} className="text-error/50 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity">
																<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
															</button>
														</div>
													</div>
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
						)}

					</div>
				</div>
			)}

			{activeTab === 'files' && activeProject?.path && (
				<div className="absolute inset-0">
					<FileNavigator basePath={activeProject.path} hideHeader={true} />
				</div>
			)}

			{activeTab === 'settings' && (
				<div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto flex flex-col gap-6">
					<div className="form-control">
						<label className="label pb-1"><span className="label-text font-bold text-base">Project Name</span></label>
						<input value={formName} onChange={e => setFormName(e.target.value)} type="text" className="input input-bordered w-full" placeholder="e.g. My Awesome Startup" />
					</div>

					<div className="form-control bg-base-200/50 p-4 rounded-xl border border-base-300">
						<label className="label pb-1 pt-0"><span className="label-text font-bold text-base">Relative Path (from ~/.tamias)</span></label>
						<input value={formPath} onChange={e => setFormPath(e.target.value)} type="text" className="input input-bordered w-full font-mono text-sm" placeholder="workspace/my-project" />
						<label className="label"><span className="label-text-alt text-base-content/50">The relative directory path to your project inside your workspace.</span></label>
					</div>

					<div className="form-control">
						<label className="label pb-1"><span className="label-text font-bold text-base">Description</span></label>
						<textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} className="textarea textarea-bordered h-24" placeholder="Brief context about this project" />
					</div>

					<div className="divider opacity-50">Integrations</div>

					<div className="form-control">
						<label className="label pb-1"><span className="label-text font-bold text-base flex items-center gap-2">Link Discord Channel</span></label>
						<select value={formChannel} onChange={e => setFormChannel(e.target.value)} className="select select-bordered w-full">
							<option value="">-- No Channel Linked --</option>
							{channels.map(c => (
								<option key={c.id} value={c.id}>
									{c.guildName} / #{c.name}
								</option>
							))}
						</select>
						<label className="label"><span className="label-text-alt text-base-content/50">Select a discord channel where Tamias should automatically use this project's context.</span></label>
					</div>

					{formChannel && (
						<div className="form-control bg-base-200/50 p-4 rounded-xl border border-warning/30">
							<label className="label pt-0 pb-1"><span className="label-text font-bold text-base text-warning">Context File Path (Relative)</span></label>
							<input value={formContext} onChange={e => setFormContext(e.target.value)} type="text" className="input input-bordered w-full font-mono" placeholder="readme.md" />
							<label className="label pb-0"><span className="label-text-alt text-base-content/60">File within the project folder that Tamias will read to get context when you chat in the linked Discord channel (e.g. <code className="bg-base-300 px-1 py-0.5 rounded">readme.md</code>).</span></label>
						</div>
					)}

					<div className="flex justify-between items-center pt-8 mt-4 border-t border-base-300">
						<button onClick={() => handleDelete(activeProject?.id || '')} className="btn btn-outline btn-error btn-sm">Delete Project</button>
						<button onClick={handleSave} className="btn btn-primary gap-2">
							<Check className="w-4 h-4" /> Save Configuration
						</button>
					</div>
				</div>
			)}
			{/* Task Detail Modal */}
			{selectedTask && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
					<div className="bg-base-100 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-base-300">
						{/* Header */}
						<div className="px-6 py-4 border-b border-base-200 flex justify-between items-center bg-base-200/50">
							<h3 className="font-bold text-lg flex items-center gap-2">
								{selectedTask.title}
								{selectedTask.reaction && <span>{selectedTask.reaction}</span>}
							</h3>
							<button onClick={closeTaskModal} className="btn btn-sm btn-ghost btn-circle">✕</button>
						</div>

						{/* Body */}
						<div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
							{/* Left Col: Details & Comments */}
							<div className="flex-1 flex flex-col gap-6">
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
									<button onClick={saveTaskDetails} className="btn btn-sm btn-primary">Save Details</button>
								</div>

								<div className="divider my-0">Comments</div>

								<div className="flex flex-col gap-4">
									{selectedTask.comments?.map(c => (
										<div key={c.id} className="bg-base-200/50 p-3 rounded-xl border border-base-300">
											<div className="flex items-center justify-between mb-1">
												<span className="font-bold text-sm text-primary">{c.author}</span>
												<span className="text-xs opacity-50">{new Date(c.createdAt).toLocaleString()}</span>
											</div>
											<div className="text-sm whitespace-pre-wrap">{c.text}</div>
										</div>
									))}
									{(!selectedTask.comments || selectedTask.comments.length === 0) && (
										<div className="text-center opacity-50 text-sm py-4">No comments yet.</div>
									)}

									<form onSubmit={addComment} className="mt-2 flex gap-2">
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

								<div className="text-xs opacity-50 mt-auto pt-4 border-t border-base-200">
									Created: {new Date(selectedTask.createdAt).toLocaleString()}
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default function ProjectsPage() {
	return (
		<Suspense fallback={<div className="p-8 flex justify-center"><span className="loading loading-spinner text-primary loading-lg"></span></div>}>
			<ProjectsContent />
		</Suspense>
	)
}
