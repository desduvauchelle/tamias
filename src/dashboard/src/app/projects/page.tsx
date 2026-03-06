"use client"

import { useState, useEffect } from "react"
import { useToast } from "../_components/ToastProvider"
import { KanbanSquare, FolderOpen, Settings, Plus, LayoutDashboard, ExternalLink, Link as LinkIcon, Edit, Check } from "lucide-react"

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

export default function ProjectsPage() {
	const [projects, setProjects] = useState<Project[]>([])
	const [activeProject, setActiveProject] = useState<Project | null>(null)
	const [loading, setLoading] = useState(true)
	const [activeTab, setActiveTab] = useState<'kanban' | 'files' | 'settings'>('kanban')
	const [isEditing, setIsEditing] = useState(false)
	const [projectFiles, setProjectFiles] = useState<any[]>([])
	const [currentPath, setCurrentPath] = useState<string>('')
	const [channels, setChannels] = useState<DiscordChannel[]>([])

	// Task Modal State
	const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null)
	const [modalDetails, setModalDetails] = useState("")
	const [modalAssignee, setModalAssignee] = useState("")
	const [modalStatus, setModalStatus] = useState("")
	const [newComment, setNewComment] = useState("")

	const { toast, success, error } = useToast()

	useEffect(() => {
		if (activeTab === 'files' && activeProject) {
			loadDirectory(currentPath || activeProject.path)
		}
	}, [activeTab, activeProject, currentPath])

	const loadDirectory = async (dirPath: string) => {
		try {
			const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`)
			if (res.ok) {
				const data = await res.json()
				setProjectFiles(data.items || [])
			}
		} catch (e) {
			console.error("Failed to load files", e)
		}
	}

	// Form State for new/editing
	const [formName, setFormName] = useState("")
	const [formDesc, setFormDesc] = useState("")
	const [formPath, setFormPath] = useState("")
	const [formChannel, setFormChannel] = useState("")
	const [formContext, setFormContext] = useState("readme.md")

	// Kanban State
	const [newTaskTitle, setNewTaskTitle] = useState("")
	const [newTaskCol, setNewTaskCol] = useState("")

	const KANBAN_COLUMNS = ['todo', 'in-progress', 'done']

	useEffect(() => {
		fetchProjects()
		fetchChannels()
	}, [])

	const fetchProjects = async () => {
		try {
			const res = await fetch("/api/projects")
			if (res.ok) {
				const data = await res.json()
				setProjects(data)
			}
		} catch (e) {
			console.error("Failed to list projects", e)
		} finally {
			setLoading(false)
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
				success("Project saved!")
				setIsEditing(false)
				fetchProjects()
				setActiveProject(updated)
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
				setActiveProject(null)
				fetchProjects()
			} else {
				error("Failed to delete project")
			}
		} catch (err) {
			error("An error occurred")
		}
	}

	const openEditor = (proj?: Project) => {
		if (proj) {
			setFormName(proj.name)
			setFormDesc(proj.description || "")
			setFormPath(proj.path)
			setFormChannel(proj.discordChannelId || "")
			setFormContext(proj.contextFile || "readme.md")
		} else {
			setFormName("")
			setFormDesc("")
			setFormPath("")
			setFormChannel("")
			setFormContext("readme.md")
			setActiveProject(null)
		}
		setIsEditing(true)
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
		<div className="flex h-full gap-6">
			{/* Left Sidebar */}
			<div className="w-1/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
				<div className="p-4 border-b border-base-200/50 flex items-center justify-between">
					<h2 className="font-semibold text-lg flex items-center gap-2">
						<LayoutDashboard className="w-5 h-5 text-primary" />
						Projects
					</h2>
					<button
						onClick={() => openEditor()}
						className="btn btn-sm btn-ghost btn-circle"
						title="New Project"
					>
						<Plus className="w-5 h-5" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-2 space-y-1">
					{loading ? (
						<div className="p-4 text-center text-base-content/50">Loading projects...</div>
					) : projects.length === 0 ? (
						<div className="p-4 text-center text-base-content/50">No projects found.</div>
					) : (
						projects.map(proj => (
							<button
								key={proj.id}
								onClick={() => { setActiveProject(proj); setIsEditing(false); setActiveTab('kanban') }}
								className={`w-full text-left p-3 rounded-xl transition-all ${activeProject?.id === proj.id && !isEditing ? 'bg-primary/10 text-primary' : 'hover:bg-base-200'
									}`}
							>
								<div className="font-medium truncate">{proj.name}</div>
								<div className="text-xs opacity-60 truncate mt-1">📁 {proj.path}</div>
								{proj.discordChannelId && (
									<div className="text-[10px] mt-1 text-info flex items-center gap-1">
										<LinkIcon className="w-3 h-3" /> Linked to Discord
									</div>
								)}
							</button>
						))
					)}
				</div>
			</div>

			{/* Main Content Area */}
			<div className="w-2/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
				{isEditing ? (
					<div className="flex flex-col h-full p-6">
						<h3 className="text-lg font-semibold mb-4 text-primary flex items-center gap-2">
							<Settings className="w-5 h-5" />
							{activeProject ? 'Project Settings' : 'Create New Project'}
						</h3>
						<div className="space-y-4 flex-1 overflow-y-auto pr-2">
							<div className="form-control">
								<label className="label"><span className="label-text">Project Name *</span></label>
								<input value={formName} onChange={e => setFormName(e.target.value)} type="text" className="input input-bordered w-full" placeholder="e.g. My Awesome Startup" />
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text">Absolute Path *</span></label>
								<input value={formPath} onChange={e => setFormPath(e.target.value)} type="text" className="input input-bordered w-full font-mono text-sm" placeholder="/Users/me/Projects/start" />
								<label className="label"><span className="label-text-alt text-base-content/50">The absolute directory path to your project.</span></label>
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text">Description</span></label>
								<textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} className="textarea textarea-bordered h-24" placeholder="Brief context about this project" />
							</div>

							<div className="divider">Integrations</div>

							<div className="form-control">
								<label className="label"><span className="label-text flex items-center gap-2">Link Discord Channel</span></label>
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
								<div className="form-control bg-base-200/50 p-4 rounded-xl border border-base-300">
									<label className="label pt-0"><span className="label-text font-semibold">Context File Path (Relative)</span></label>
									<input value={formContext} onChange={e => setFormContext(e.target.value)} type="text" className="input input-bordered w-full input-sm font-mono" placeholder="readme.md" />
									<label className="label pb-0"><span className="label-text-alt text-base-content/50">File within the project folder that Tamias will read to get context when you chat in the linked Discord channel. Usually <code className="bg-base-300 px-1 rounded">readme.md</code> or <code className="bg-base-300 px-1 rounded">cursorrules</code>.</span></label>
								</div>
							)}
						</div>
						<div className="flex justify-end gap-2 pt-6 mt-4 border-t border-base-200/50">
							<button onClick={() => { setIsEditing(false); if (!activeProject) setFormName('') }} className="btn btn-ghost">Cancel</button>
							<button onClick={handleSave} className="btn btn-primary gap-2">
								<Check className="w-4 h-4" /> Save Project
							</button>
						</div>
					</div>
				) : activeProject ? (
					<div className="flex flex-col h-full">
						{/* Header & Tabs */}
						<div className="p-0 border-b border-base-200/50">
							<div className="p-6 pb-4">
								<div className="flex items-center justify-between mb-2">
									<h2 className="text-2xl font-bold flex items-center gap-3">
										{activeProject.name}
									</h2>
									<button onClick={() => openEditor(activeProject)} className="btn btn-sm btn-ghost gap-2">
										<Settings className="w-4 h-4" /> Settings
									</button>
								</div>
								<div className="flex items-center gap-4 text-sm text-base-content/60">
									<span className="flex items-center gap-1 font-mono text-xs bg-base-200 px-2 py-1 rounded">
										<FolderOpen className="w-3.5 h-3.5" /> {activeProject.path}
									</span>
									{activeProject.discordChannelId && (
										<span className="flex items-center gap-1 text-info">
											<LinkIcon className="w-3.5 h-3.5" /> Discord Context Connected
										</span>
									)}
								</div>
							</div>

							<div className="tabs tabs-bordered px-6 border-b-0 -mb-[1px]">
								<button
									className={`tab tab-lg gap-2 ${activeTab === 'kanban' ? 'tab-active font-bold text-primary border-primary' : ''}`}
									onClick={() => setActiveTab('kanban')}
								>
									<KanbanSquare className="w-4 h-4" /> Kanban Board
								</button>
							</div>
						</div>

						{/* Tab Content */}
						<div className="flex-1 overflow-hidden bg-base-200/20">
							{activeTab === 'kanban' && (
								<div className="h-full flex gap-4 p-6 overflow-x-auto items-start">
									{KANBAN_COLUMNS.map(col => {
										const colTasks = (activeProject.kanban || []).filter(t => t.status === col)
										return (
											<div key={col} className="w-72 shrink-0 flex flex-col max-h-full bg-base-200/50 rounded-xl border border-base-300">
												<div className="p-3 border-b border-base-300/50 flex justify-between items-center bg-base-300/30 rounded-t-xl">
													<h3 className="font-bold text-sm uppercase tracking-wider text-base-content/70">{col.replace('-', ' ')}</h3>
													<span className="text-xs font-mono bg-base-300 px-2 py-0.5 rounded-full">{colTasks.length}</span>
												</div>
												<div className="p-3 flex-1 overflow-y-auto space-y-3">
													{colTasks.map(task => (
														<div
															key={task.id}
															onClick={() => openTaskModal(task)}
															className="bg-base-100 p-3 rounded-lg border border-base-300 shadow-sm group cursor-pointer hover:border-primary/50 transition-colors relative"
														>
															<div className="text-sm font-medium pr-6">{task.title}</div>

															{/* Badges */}
															<div className="flex flex-wrap gap-2 mt-2">
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

							{activeTab === 'files' && (
								<div className="h-full flex flex-col p-6">
									<div className="flex items-center gap-2 mb-4 bg-base-100 p-2 rounded-lg border border-base-300">
										<button
											className="btn btn-sm btn-ghost"
											onClick={() => {
												const parts = currentPath.split('/')
												parts.pop()
												setCurrentPath(parts.join('/') || '/')
											}}
											disabled={currentPath === activeProject.path || currentPath === '/'}
										>
											← Up
										</button>
										<span className="font-mono text-sm opacity-70 truncate">{currentPath}</span>
									</div>
									<div className="bg-base-100 border border-base-300 rounded-xl overflow-hidden flex-1 overflow-y-auto">
										{projectFiles.map(file => (
											<button
												key={file.path}
												onClick={() => {
													if (file.isDirectory) setCurrentPath(file.path)
													// If it's a file, we could open a modal or just leave it for now
												}}
												className="w-full flex items-center justify-between p-3 border-b border-base-200 hover:bg-base-200/50 transition-colors last:border-b-0 text-left"
											>
												<div className="flex items-center gap-3">
													{file.isDirectory ? <FolderOpen className="w-4 h-4 text-warning" /> : <LinkIcon className="w-4 h-4 opacity-30" />}
													<span className="text-sm font-medium">{file.name}</span>
												</div>
												{!file.isDirectory && file.size !== null && (
													<span className="text-xs font-mono opacity-40">{(file.size / 1024).toFixed(1)} KB</span>
												)}
											</button>
										))}
										{projectFiles.length === 0 && (
											<div className="p-8 text-center opacity-50 text-sm">Empty directory</div>
										)}
									</div>
								</div>
							)}
						</div>
					</div>
				) : (
					<div className="flex-1 flex flex-col items-center justify-center p-8">
						<div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mb-6 transform rotate-3">
							<LayoutDashboard className="w-10 h-10 text-primary" />
						</div>
						<h3 className="text-2xl font-bold text-base-content mb-2">Projects Hub</h3>
						<p className="text-base-content/60 text-center max-w-md mb-8">
							Connect your local directories, track tasks on a Kanban board, and bind context directly into a Discord channel for Tamias to act as a focused team member.
						</p>
						<button onClick={() => openEditor()} className="btn btn-primary gap-2">
							<Plus className="w-5 h-5" /> Create Project
						</button>
					</div>
				)}
			</div>

			{/* Task Detail Modal */}
			{selectedTask && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
					<div className="bg-base-100 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-base-300">
						{/* Header */}
						<div className="px-6 py-4 border-b border-base-200 flex justify-between items-center bg-base-200/50">
							<h3 className="font-bold text-lg">{selectedTask.title}</h3>
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
