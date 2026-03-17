"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useSearchParams, useRouter } from 'next/navigation'
import { useToast } from "../_components/ToastProvider"
import { KanbanSquare, FolderOpen, Settings, Plus, LayoutDashboard, Edit, Check, FileText, MessageSquare, Puzzle, Trash2, Bot, Clock, ToggleLeft, ToggleRight, Zap, ChevronUp, ChevronDown, X } from "lucide-react"
import FileNavigator from '../_components/FileNavigator'
import ChatTerminal from '../_components/ChatTerminal'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Suspense } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Project } from "./_components/types"
import KanbanBoard from "./_components/KanbanBoard"

interface DiscordChannel {
	id: string
	name: string
	guildId: string
	guildName: string
	instanceKey: string
}

function ProjectsContent() {
	const searchParams = useSearchParams()
	const router = useRouter()
	const queryClient = useQueryClient()
	const projectId = searchParams.get('id')

	const { data: projects = [], isLoading: loading } = useQuery<Project[]>({
		queryKey: ['projects'],
		queryFn: async () => {
			const res = await fetch("/api/projects")
			if (!res.ok) throw new Error("Failed to fetch")
			return res.json()
		},
		refetchInterval: 3000 // Silently poll for updates so kanban reactions appear live
	})

	const { data: channels = [] } = useQuery<DiscordChannel[]>({
		queryKey: ['channels'],
		queryFn: async () => {
			const res = await fetch("/api/discord/channels")
			if (!res.ok) throw new Error("Failed to fetch")
			const data = await res.json()
			return data.channels || []
		}
	})

	const [activeProject, setActiveProject] = useState<Project | null>(null)
	const validTabs = ['overview', 'chat', 'kanban', 'agents', 'crons', 'skills', 'files', 'settings'] as const
	type TabType = typeof validTabs[number]
	const [activeTab, setActiveTab] = useState<TabType>(
		((validTabs as readonly string[]).includes(searchParams.get('tab') || '') ? searchParams.get('tab') : 'overview') as TabType
	)

	// Sync activeTab to URL and vice-versa
	useEffect(() => {
		const tabQuery = searchParams.get('tab')
		if (tabQuery && (validTabs as readonly string[]).includes(tabQuery) && tabQuery !== activeTab) {
			setActiveTab(tabQuery as TabType)
		}
	}, [searchParams])

	useEffect(() => {
		if (projectId) {
			const currentTab = searchParams.get('tab')
			if (currentTab !== activeTab) {
				router.replace(`?id=${projectId}&tab=${activeTab}`, { scroll: false })
			}
		}
	}, [activeTab, projectId, router, searchParams])

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

	// Connection Preferences State
	const [formPreferredConnections, setFormPreferredConnections] = useState<string[]>([])
	const [formPreferredModel, setFormPreferredModel] = useState("")
	const [formPreferredModelFallbacks, setFormPreferredModelFallbacks] = useState<string[]>([])

	interface ConnectionInfo { nickname: string; provider: string; models?: string[] }
	const [availableConnections, setAvailableConnections] = useState<ConnectionInfo[]>([])
	const [connectionModels, setConnectionModels] = useState<Record<string, { id: string; name: string }[]>>({})

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
				setFormPreferredConnections(found.preferredConnections || [])
				setFormPreferredModel(found.preferredModel || "")
				setFormPreferredModelFallbacks(found.preferredModelFallbacks || [])
			} else {
				setActiveProject(null)
			}
		} else if (!projectId) {
			setActiveProject(null)
		}
	}, [projectId, projects])

	// Load available connections for settings tab
	useEffect(() => {
		if (activeTab === 'settings') {
			fetch('/api/models')
				.then(r => r.ok ? r.json() : null)
				.then(data => {
					if (!data) return
					const conns: ConnectionInfo[] = Object.values(data.connections || {}).map((c: any) => ({
						nickname: c.nickname,
						provider: c.provider || 'unknown',
					}))
					setAvailableConnections(conns)
					// Fetch models for each connection
					for (const conn of conns) {
						fetch('/api/models/available', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ provider: conn.provider, nickname: conn.nickname }),
						})
							.then(r => r.ok ? r.json() : null)
							.then(d => {
								if (d?.models) {
									setConnectionModels(prev => ({ ...prev, [conn.nickname]: d.models }))
								}
							})
							.catch(() => { /* ignore */ })
					}
				})
				.catch(() => { /* ignore */ })
		}
	}, [activeTab])

	// All models from selected connections
	const allAvailableModels = useMemo(() => {
		const models: { id: string; name: string; connection: string }[] = []
		for (const nickname of formPreferredConnections) {
			for (const m of (connectionModels[nickname] || [])) {
				models.push({ id: `${nickname}/${m.id}`, name: `${nickname} / ${m.name}`, connection: nickname })
			}
		}
		return models
	}, [formPreferredConnections, connectionModels])

	// Load context markdown when switching to overview
	useEffect(() => {
		if (activeTab === 'overview' && activeProject && activeProject.contextFile) {
			fetchContextMarkdown(activeProject)
		}
	}, [activeTab, activeProject])

	// Pre-create chat session when switching to chat tab
	useEffect(() => {
		if (activeTab === 'chat' && activeProject) {
			fetch('/api/project-event', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'ping', projectId: activeProject.id })
			}).catch(console.error)
		}
	}, [activeTab, activeProject])

	const fetchContextMarkdown = async (proj: Project) => {
		try {
			const projectApiPath = `workspace/${proj.id}`
			const rawPath = proj.contextFile ? `${projectApiPath}/${proj.contextFile}` : ''
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
			const projectApiPath = `workspace/${activeProject.id}`
			const rawPath = activeProject.contextFile ? `${projectApiPath}/${activeProject.contextFile}` : ''
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

	const handleSave = async () => {
		if (!formName || !formPath) {
			error("Name and Path are required")
			return
		}

		const method = activeProject ? 'PUT' : 'POST'
		const url = activeProject ? `/api/projects/${activeProject.id}` : `/api/projects`

		const selectedChannel = channels.find(c => c.id === formChannel)

		const normalizedPath = formPath.trim().replace(/^workspace\/+/i, '').replace(/^\/+/, '').replace(/\/+$/, '')

		try {
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: formName,
					description: formDesc,
					path: normalizedPath,
					discordChannelId: selectedChannel?.id || undefined,
					discordServerId: selectedChannel?.guildId || undefined,
					contextFile: formContext,
					preferredConnections: formPreferredConnections.length > 0 ? formPreferredConnections : undefined,
					preferredModel: formPreferredModel || undefined,
					preferredModelFallbacks: formPreferredModelFallbacks.length > 0 ? formPreferredModelFallbacks : undefined,
				})
			})

			if (res.ok) {
				const updated = await res.json()
				success("Project config saved!")
				queryClient.invalidateQueries({ queryKey: ['projects'] })

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
				queryClient.invalidateQueries({ queryKey: ['projects'] })
			} else {
				error("Failed to delete project")
			}
		} catch (err) {
			error("An error occurred")
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
										<FolderOpen className="w-4 h-4 text-warning" /> ~/.tamias/workspace/{activeProject.id}
									</span>
									{activeProject.discordChannelId && (
										<span className="flex items-center gap-1 text-info bg-info/10 px-2 py-1 rounded-md border border-info/20">
											<span className="w-4 h-4">🔗</span> Discord Configured
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
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'chat' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('chat')}
							>
								<MessageSquare className="w-4 h-4" /> Chat
							</button>
							<button
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'kanban' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('kanban')}
							>
								<KanbanSquare className="w-4 h-4" /> Kanban Board
							</button>
							<button
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'agents' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('agents')}
							>
								<Bot className="w-4 h-4" /> Agents
							</button>
							<button
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'crons' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('crons')}
							>
								<Clock className="w-4 h-4" /> Crons
							</button>
							<button
								className={`tab tab-lg gap-2 transition-all ${activeTab === 'skills' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
								onClick={() => setActiveTab('skills')}
							>
								<Puzzle className="w-4 h-4" /> Skills
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
										<button onClick={() => { setEditedContext(contextMarkdown.startsWith('> Could not load') ? '' : contextMarkdown); setIsEditingContext(true) }} className="btn btn-ghost btn-xs gap-2">
											<Edit className="w-3 h-3" /> {contextMarkdown.startsWith('> Could not load') ? 'Create Context' : 'Edit Context'}
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
							<KanbanBoard
								project={activeProject}
								onProjectUpdate={setActiveProject}
							/>
						)}

						{activeTab === 'chat' && activeProject && (
							<div className="absolute inset-0 bg-base-100 flex flex-col">
								<ChatTerminal sessionId={`project-${activeProject.id}`} />
							</div>
						)}

						{activeTab === 'agents' && activeProject && (
							<ProjectAgentsPanel projectId={activeProject.id} />
						)}

						{activeTab === 'crons' && activeProject && (
							<ProjectCronsPanel projectId={activeProject.id} />
						)}

						{activeTab === 'skills' && activeProject && (
							<ProjectSkillsPanel projectId={activeProject.id} />
						)}

						{activeTab === 'files' && activeProject && (
							<div className="absolute inset-0">
								<FileNavigator key={activeProject.id} basePath={`workspace/${activeProject.id}`} hideHeader={true} />
							</div>
						)}

						{activeTab === 'settings' && (
							<div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto flex flex-col gap-6">
								<div className="form-control">
									<label className="label pb-1"><span className="label-text font-bold text-base">Project Name</span></label>
									<input value={formName} onChange={e => setFormName(e.target.value)} type="text" className="input input-bordered w-full" placeholder="e.g. My Awesome Startup" />
								</div>

								<div className="form-control bg-base-200/50 p-4 rounded-xl border border-base-300">
									<label className="label pb-1 pt-0"><span className="label-text font-bold text-base">Project Folder Name</span></label>
									<div className="flex items-center gap-0 input input-bordered w-full font-mono text-sm overflow-hidden p-0">
										<span className="px-3 py-2 bg-base-300 border-r border-base-300 text-base-content/50 text-xs shrink-0">~/.tamias/workspace/</span>
										<input value={formPath} onChange={e => setFormPath(e.target.value)} type="text" className="flex-1 bg-transparent px-3 py-2 outline-none text-sm" placeholder="livecase" />
									</div>
									<label className="label"><span className="label-text-alt text-base-content/50">Folder name inside your workspace (e.g. <code className="bg-base-300 px-1 rounded">livecase</code>)</span></label>
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

								<div className="divider opacity-50">AI Connection Preferences</div>

								<div className="form-control">
									<label className="label pb-1"><span className="label-text font-bold text-base flex items-center gap-2"><Zap className="w-4 h-4 text-warning" /> Preferred Connections</span></label>
									<p className="text-xs text-base-content/50 mb-3">Select which AI connections this project should use. Leave empty to use global defaults.</p>
									{availableConnections.length === 0 ? (
										<p className="text-sm text-base-content/40 italic">No connections configured. Set up connections in the Models page first.</p>
									) : (
										<div className="space-y-2">
											{availableConnections.map(conn => (
												<label key={conn.nickname} className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 cursor-pointer">
													<input
														type="checkbox"
														className="checkbox checkbox-sm checkbox-primary"
														checked={formPreferredConnections.includes(conn.nickname)}
														onChange={e => {
															if (e.target.checked) {
																setFormPreferredConnections(prev => [...prev, conn.nickname])
															} else {
																setFormPreferredConnections(prev => prev.filter(n => n !== conn.nickname))
																setFormPreferredModel(prev => prev.startsWith(conn.nickname + '/') ? '' : prev)
																setFormPreferredModelFallbacks(prev => prev.filter(m => !m.startsWith(conn.nickname + '/')))
															}
														}}
													/>
													<span className="font-medium">{conn.nickname}</span>
													<span className="badge badge-sm badge-ghost">{conn.provider}</span>
												</label>
											))}
										</div>
									)}
								</div>

								{formPreferredConnections.length > 0 && (
									<>
										<div className="form-control">
											<label className="label pb-1"><span className="label-text font-bold text-base">Preferred Model</span></label>
											<select
												value={formPreferredModel}
												onChange={e => setFormPreferredModel(e.target.value)}
												className="select select-bordered w-full"
											>
												<option value="">-- Use global default --</option>
												{allAvailableModels.map(m => (
													<option key={m.id} value={m.id}>{m.name}</option>
												))}
											</select>
											<label className="label"><span className="label-text-alt text-base-content/50">Primary model for this project&apos;s AI sessions.</span></label>
										</div>

										<div className="form-control">
											<label className="label pb-1"><span className="label-text font-bold text-base">Fallback Models</span></label>
											<p className="text-xs text-base-content/50 mb-2">If the preferred model is unavailable, these models are tried in order.</p>
											{formPreferredModelFallbacks.length > 0 && (
												<div className="space-y-1 mb-3">
													{formPreferredModelFallbacks.map((fb, idx) => (
														<div key={fb} className="flex items-center gap-2 bg-base-200 rounded-lg px-3 py-2">
															<span className="text-xs text-base-content/40 w-5">{idx + 1}.</span>
															<span className="flex-1 font-mono text-sm">{fb}</span>
															<button
																onClick={() => {
																	const arr = [...formPreferredModelFallbacks]
																	if (idx > 0) { [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]] }
																	setFormPreferredModelFallbacks(arr)
																}}
																className="btn btn-ghost btn-xs"
																disabled={idx === 0}
															><ChevronUp className="w-3 h-3" /></button>
															<button
																onClick={() => {
																	const arr = [...formPreferredModelFallbacks]
																	if (idx < arr.length - 1) { [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]] }
																	setFormPreferredModelFallbacks(arr)
																}}
																className="btn btn-ghost btn-xs"
																disabled={idx === formPreferredModelFallbacks.length - 1}
															><ChevronDown className="w-3 h-3" /></button>
															<button
																onClick={() => setFormPreferredModelFallbacks(prev => prev.filter((_, i) => i !== idx))}
																className="btn btn-ghost btn-xs text-error"
															><X className="w-3 h-3" /></button>
														</div>
													))}
												</div>
											)}
											<select
												className="select select-bordered select-sm w-full"
												value=""
												onChange={e => {
													if (e.target.value && !formPreferredModelFallbacks.includes(e.target.value)) {
														setFormPreferredModelFallbacks(prev => [...prev, e.target.value])
													}
													e.target.value = ''
												}}
											>
												<option value="">+ Add fallback model...</option>
												{allAvailableModels
													.filter(m => m.id !== formPreferredModel && !formPreferredModelFallbacks.includes(m.id))
													.map(m => (
														<option key={m.id} value={m.id}>{m.name}</option>
													))}
											</select>
										</div>
									</>
								)}

								<div className="flex justify-between items-center pt-8 mt-4 border-t border-base-300">
									<button onClick={() => handleDelete(activeProject?.id || '')} className="btn btn-outline btn-error btn-sm">Delete Project</button>
									<button onClick={handleSave} className="btn btn-primary gap-2">
										<Check className="w-4 h-4" /> Save Configuration
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

interface ProjectAgent {
	id: string
	slug: string
	name: string
	model?: string
	instructions: string
	enabled: boolean
	allowedTools?: string[]
}

function ProjectAgentsPanel({ projectId }: { projectId: string }) {
	const [agents, setAgents] = useState<ProjectAgent[]>([])
	const [loading, setLoading] = useState(true)
	const [isAdding, setIsAdding] = useState(false)
	const [formName, setFormName] = useState('')
	const [formInstructions, setFormInstructions] = useState('')
	const [formModel, setFormModel] = useState('')
	const { success, error } = useToast()

	const fetchAgents = useCallback(async () => {
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agents`)
			if (res.ok) setAgents(await res.json())
		} catch { /* ignore */ } finally { setLoading(false) }
	}, [projectId])

	useEffect(() => { fetchAgents() }, [fetchAgents])

	const handleAdd = async () => {
		if (!formName.trim() || !formInstructions.trim()) {
			error('Name and instructions are required')
			return
		}
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agents`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: formName, instructions: formInstructions, model: formModel || undefined }),
			})
			if (res.ok) {
				success('Agent added')
				setFormName(''); setFormInstructions(''); setFormModel(''); setIsAdding(false)
				fetchAgents()
			} else {
				const data = await res.json()
				error(data.error || 'Failed to add agent')
			}
		} catch { error('Failed to add agent') }
	}

	const handleDelete = async (slug: string) => {
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agents?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
			if (res.ok) { success('Agent deleted'); fetchAgents() }
		} catch { error('Failed to delete agent') }
	}

	if (loading) return <div className="p-8 flex justify-center"><span className="loading loading-spinner loading-lg text-primary" /></div>

	return (
		<div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto">
			<div className="flex justify-between items-center mb-6">
				<div>
					<h3 className="text-lg font-bold">Project Agents</h3>
					<p className="text-sm text-base-content/60">Agents scoped to this project. They override global agents with the same slug.</p>
				</div>
				<button onClick={() => setIsAdding(!isAdding)} className="btn btn-primary btn-sm gap-2">
					<Plus className="w-4 h-4" /> Add Agent
				</button>
			</div>

			{isAdding && (
				<div className="card bg-base-200 border border-base-300 mb-6">
					<div className="card-body gap-4">
						<div className="form-control">
							<label className="label"><span className="label-text font-medium">Agent Name</span></label>
							<input value={formName} onChange={e => setFormName(e.target.value)} className="input input-bordered w-full" placeholder="e.g. Code Reviewer" />
						</div>
						<div className="form-control">
							<label className="label"><span className="label-text font-medium">Model (optional)</span></label>
							<input value={formModel} onChange={e => setFormModel(e.target.value)} className="input input-bordered w-full font-mono text-sm" placeholder="e.g. openai/gpt-4o" />
						</div>
						<div className="form-control">
							<label className="label"><span className="label-text font-medium">Instructions</span></label>
							<textarea value={formInstructions} onChange={e => setFormInstructions(e.target.value)} className="textarea textarea-bordered h-32 font-mono text-sm" placeholder="You are a code reviewer specialized in..." />
						</div>
						<div className="flex gap-2 justify-end">
							<button onClick={() => setIsAdding(false)} className="btn btn-ghost btn-sm">Cancel</button>
							<button onClick={handleAdd} className="btn btn-primary btn-sm">Save Agent</button>
						</div>
					</div>
				</div>
			)}

			{agents.length === 0 && !isAdding && (
				<div className="text-center py-12 text-base-content/40">
					<Bot className="w-12 h-12 mx-auto mb-4 opacity-30" />
					<p className="text-lg">No project-specific agents yet</p>
					<p className="text-sm mt-1">Add agents to customize AI personas for this project</p>
				</div>
			)}

			<div className="space-y-3">
				{agents.map(agent => (
					<div key={agent.slug} className="card bg-base-200 border border-base-300">
						<div className="card-body py-4 px-5">
							<div className="flex justify-between items-start">
								<div>
									<h4 className="font-bold flex items-center gap-2">
										{agent.name}
										<span className="badge badge-sm badge-ghost font-mono">{agent.slug}</span>
										{agent.enabled ? (
											<span className="badge badge-sm badge-success">enabled</span>
										) : (
											<span className="badge badge-sm badge-error">disabled</span>
										)}
									</h4>
									{agent.model && <p className="text-xs text-base-content/50 font-mono mt-1">{agent.model}</p>}
								</div>
								<button onClick={() => handleDelete(agent.slug)} className="btn btn-ghost btn-xs text-error">
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
							<details className="mt-2">
								<summary className="cursor-pointer text-sm text-base-content/50 hover:text-base-content/80">View instructions</summary>
								<pre className="mt-2 p-3 bg-base-100 rounded text-xs font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">{agent.instructions}</pre>
							</details>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

interface ProjectCron {
	id: string
	name: string
	schedule: string
	type: 'ai' | 'message'
	prompt: string
	enabled: boolean
	lastRun?: string
	lastStatus?: 'success' | 'error'
}

function ProjectCronsPanel({ projectId }: { projectId: string }) {
	const [crons, setCrons] = useState<ProjectCron[]>([])
	const [loading, setLoading] = useState(true)
	const [isAdding, setIsAdding] = useState(false)
	const [formName, setFormName] = useState('')
	const [formSchedule, setFormSchedule] = useState('')
	const [formType, setFormType] = useState<'ai' | 'message'>('ai')
	const [formPrompt, setFormPrompt] = useState('')
	const { success, error } = useToast()

	const fetchCrons = useCallback(async () => {
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/crons`)
			if (res.ok) setCrons(await res.json())
		} catch { /* ignore */ } finally { setLoading(false) }
	}, [projectId])

	useEffect(() => { fetchCrons() }, [fetchCrons])

	const handleAdd = async () => {
		if (!formName.trim() || !formSchedule.trim() || !formPrompt.trim()) {
			error('Name, schedule, and prompt are required')
			return
		}
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/crons`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: formName, schedule: formSchedule, type: formType, prompt: formPrompt }),
			})
			if (res.ok) {
				success('Cron added')
				setFormName(''); setFormSchedule(''); setFormPrompt(''); setFormType('ai'); setIsAdding(false)
				fetchCrons()
			} else {
				const data = await res.json()
				error(data.error || 'Failed to add cron')
			}
		} catch { error('Failed to add cron') }
	}

	const handleToggle = async (cron: ProjectCron) => {
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/crons`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jobId: cron.id, enabled: !cron.enabled }),
			})
			if (res.ok) fetchCrons()
		} catch { error('Failed to toggle cron') }
	}

	const handleDelete = async (jobId: string) => {
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/crons?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' })
			if (res.ok) { success('Cron deleted'); fetchCrons() }
		} catch { error('Failed to delete cron') }
	}

	if (loading) return <div className="p-8 flex justify-center"><span className="loading loading-spinner loading-lg text-primary" /></div>

	return (
		<div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto">
			<div className="flex justify-between items-center mb-6">
				<div>
					<h3 className="text-lg font-bold">Project Crons</h3>
					<p className="text-sm text-base-content/60">Scheduled tasks scoped to this project. They automatically have project context.</p>
				</div>
				<button onClick={() => setIsAdding(!isAdding)} className="btn btn-primary btn-sm gap-2">
					<Plus className="w-4 h-4" /> Add Cron
				</button>
			</div>

			{isAdding && (
				<div className="card bg-base-200 border border-base-300 mb-6">
					<div className="card-body gap-4">
						<div className="grid grid-cols-2 gap-4">
							<div className="form-control">
								<label className="label"><span className="label-text font-medium">Cron Name</span></label>
								<input value={formName} onChange={e => setFormName(e.target.value)} className="input input-bordered w-full" placeholder="e.g. Daily Status Update" />
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text font-medium">Schedule</span></label>
								<input value={formSchedule} onChange={e => setFormSchedule(e.target.value)} className="input input-bordered w-full font-mono" placeholder="e.g. 30m, 1h, 0 9 * * *" />
							</div>
						</div>
						<div className="form-control">
							<label className="label"><span className="label-text font-medium">Type</span></label>
							<select value={formType} onChange={e => setFormType(e.target.value as 'ai' | 'message')} className="select select-bordered w-full">
								<option value="ai">AI (send prompt to AI, deliver response)</option>
								<option value="message">Message (send prompt text directly)</option>
							</select>
						</div>
						<div className="form-control">
							<label className="label"><span className="label-text font-medium">Prompt</span></label>
							<textarea value={formPrompt} onChange={e => setFormPrompt(e.target.value)} className="textarea textarea-bordered h-24 font-mono text-sm" placeholder="Check the project kanban board and report any overdue tasks..." />
						</div>
						<div className="flex gap-2 justify-end">
							<button onClick={() => setIsAdding(false)} className="btn btn-ghost btn-sm">Cancel</button>
							<button onClick={handleAdd} className="btn btn-primary btn-sm">Save Cron</button>
						</div>
					</div>
				</div>
			)}

			{crons.length === 0 && !isAdding && (
				<div className="text-center py-12 text-base-content/40">
					<Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
					<p className="text-lg">No project-specific crons yet</p>
					<p className="text-sm mt-1">Add scheduled tasks that run with this project&apos;s context</p>
				</div>
			)}

			<div className="space-y-3">
				{crons.map(cron => (
					<div key={cron.id} className="card bg-base-200 border border-base-300">
						<div className="card-body py-4 px-5">
							<div className="flex justify-between items-start">
								<div className="flex items-center gap-3">
									<button onClick={() => handleToggle(cron)} className="text-base-content/60 hover:text-base-content">
										{cron.enabled ? <ToggleRight className="w-6 h-6 text-success" /> : <ToggleLeft className="w-6 h-6" />}
									</button>
									<div>
										<h4 className="font-bold flex items-center gap-2">
											{cron.name}
											<span className="badge badge-sm badge-ghost font-mono">{cron.schedule}</span>
											<span className={`badge badge-sm ${cron.type === 'ai' ? 'badge-primary' : 'badge-secondary'}`}>{cron.type}</span>
										</h4>
										{cron.lastRun && (
											<p className="text-xs text-base-content/50 mt-1">
												Last run: {new Date(cron.lastRun).toLocaleString()}
												{cron.lastStatus && (
													<span className={`ml-2 ${cron.lastStatus === 'success' ? 'text-success' : 'text-error'}`}>({cron.lastStatus})</span>
												)}
											</p>
										)}
									</div>
								</div>
								<button onClick={() => handleDelete(cron.id)} className="btn btn-ghost btn-xs text-error">
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
							<details className="mt-2">
								<summary className="cursor-pointer text-sm text-base-content/50 hover:text-base-content/80">View prompt</summary>
								<pre className="mt-2 p-3 bg-base-100 rounded text-xs font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">{cron.prompt}</pre>
							</details>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

function ProjectSkillsPanel({ projectId }: { projectId: string }) {
	const [skills, setSkills] = useState<{ name: string; description: string; content: string }[]>([])
	const [loading, setLoading] = useState(true)
	const [newSkillName, setNewSkillName] = useState('')
	const [newSkillContent, setNewSkillContent] = useState('')
	const [isAdding, setIsAdding] = useState(false)
	const { success, error } = useToast()

	const fetchSkills = useCallback(async () => {
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/skills`)
			if (res.ok) {
				setSkills(await res.json())
			}
		} catch {
			// ignore
		} finally {
			setLoading(false)
		}
	}, [projectId])

	useEffect(() => {
		fetchSkills()
	}, [fetchSkills])

	const handleAdd = async () => {
		if (!newSkillName.trim() || !newSkillContent.trim()) {
			error('Name and content are required')
			return
		}
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/skills`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newSkillName, content: newSkillContent }),
			})
			if (res.ok) {
				success('Skill added')
				setNewSkillName('')
				setNewSkillContent('')
				setIsAdding(false)
				fetchSkills()
			} else {
				const data = await res.json()
				error(data.error || 'Failed to add skill')
			}
		} catch {
			error('Failed to add skill')
		}
	}

	const handleDelete = async (skillName: string) => {
		try {
			const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/skills?name=${encodeURIComponent(skillName)}`, {
				method: 'DELETE',
			})
			if (res.ok) {
				success('Skill deleted')
				fetchSkills()
			}
		} catch {
			error('Failed to delete skill')
		}
	}

	if (loading) {
		return <div className="p-8 flex justify-center"><span className="loading loading-spinner loading-lg text-primary" /></div>
	}

	return (
		<div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto">
			<div className="flex justify-between items-center mb-6">
				<div>
					<h3 className="text-lg font-bold">Project Skills</h3>
					<p className="text-sm text-base-content/60">Skills local to this project. They override global skills with the same name.</p>
				</div>
				<button onClick={() => setIsAdding(!isAdding)} className="btn btn-primary btn-sm gap-2">
					<Plus className="w-4 h-4" /> Add Skill
				</button>
			</div>

			{isAdding && (
				<div className="card bg-base-200 border border-base-300 mb-6">
					<div className="card-body gap-4">
						<div className="form-control">
							<label className="label"><span className="label-text font-medium">Skill Name</span></label>
							<input
								value={newSkillName}
								onChange={e => setNewSkillName(e.target.value)}
								className="input input-bordered w-full"
								placeholder="e.g. my-custom-skill"
							/>
						</div>
						<div className="form-control">
							<label className="label"><span className="label-text font-medium">SKILL.md Content</span></label>
							<textarea
								value={newSkillContent}
								onChange={e => setNewSkillContent(e.target.value)}
								className="textarea textarea-bordered h-48 font-mono text-sm"
								placeholder={"---\nname: \"My Skill\"\ndescription: \"What this skill does\"\ntags: [\"example\"]\n---\n\n# My Skill Instructions\n\n..."}
							/>
						</div>
						<div className="flex gap-2 justify-end">
							<button onClick={() => setIsAdding(false)} className="btn btn-ghost btn-sm">Cancel</button>
							<button onClick={handleAdd} className="btn btn-primary btn-sm">Save Skill</button>
						</div>
					</div>
				</div>
			)}

			{skills.length === 0 && !isAdding && (
				<div className="text-center py-12 text-base-content/40">
					<Puzzle className="w-12 h-12 mx-auto mb-4 opacity-30" />
					<p className="text-lg">No project-specific skills yet</p>
					<p className="text-sm mt-1">Add skills to customize AI behavior for this project</p>
				</div>
			)}

			<div className="space-y-3">
				{skills.map(skill => (
					<div key={skill.name} className="card bg-base-200 border border-base-300">
						<div className="card-body py-4 px-5">
							<div className="flex justify-between items-start">
								<div>
									<h4 className="font-bold font-mono">{skill.name}</h4>
									{skill.description && <p className="text-sm text-base-content/60 mt-1">{skill.description}</p>}
								</div>
								<button onClick={() => handleDelete(skill.name)} className="btn btn-ghost btn-xs text-error">
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
							<details className="mt-2">
								<summary className="cursor-pointer text-sm text-base-content/50 hover:text-base-content/80">View content</summary>
								<pre className="mt-2 p-3 bg-base-100 rounded text-xs font-mono overflow-x-auto max-h-60 overflow-y-auto">{skill.content}</pre>
							</details>
						</div>
					</div>
				))}
			</div>
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
