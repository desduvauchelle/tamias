'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { useToast } from './ToastProvider'

import {
	MessageSquare,
	Zap,
	Wrench,
	BookOpen,
	Smartphone,
	Clock,
	List,
	CircleDollarSign,
	FileText,
	History,
	Cpu,
	FolderOpen,
	Bot,
	Activity,
	KanbanSquare,
	Plus,
	Check
} from 'lucide-react'

const navGroups = {
	Workspace: [],
	Capabilities: [
		{
			href: '/',
			label: 'Chat',
			icon: <MessageSquare className="w-4 h-4" />,
		},
		{
			href: '/agents',
			label: 'Agents',
			icon: <Bot className="w-4 h-4" />,
		},
		{
			href: '/skills',
			label: 'Skills',
			icon: <BookOpen className="w-4 h-4" />,
		},
		{
			href: '/tools',
			label: 'Tools & MCPs',
			icon: <Wrench className="w-4 h-4" />,
		},
		{
			href: '/crons',
			label: 'Crons',
			icon: <Clock className="w-4 h-4" />,
		},
		{
			href: '/files',
			label: 'Files',
			icon: <FolderOpen className="w-4 h-4" />,
		},
	],
	Usage: [
		{
			href: '/usage',
			label: 'Usage info',
			icon: <CircleDollarSign className="w-4 h-4" />,
		},
		{
			href: '/history',
			label: 'History',
			icon: <List className="w-4 h-4" />,
		},
		{
			href: '/live-logs',
			label: 'Live logs',
			icon: <Activity className="w-4 h-4" />,
		},
	],
	Infrastructure: [
		{
			href: '/models',
			label: 'AI Models',
			icon: <Zap className="w-4 h-4" />,
		},
		{
			href: '/channels',
			label: 'Channels',
			icon: <Smartphone className="w-4 h-4" />,
		},
		{
			href: '/docs',
			label: 'Docs',
			icon: <FileText className="w-4 h-4" />,
		},
		{
			href: '/changelog',
			label: 'Changelogs',
			icon: <History className="w-4 h-4" />,
		},
	]
}

interface DaemonStatus {
	running: boolean
	pid: number | null
	uptimeSec: number | null
	tamiasVersion?: string
	dashboardVersion?: string
}

function formatUptime(secs: number): string {
	if (secs < 60) return `${secs}s`
	if (secs < 3600) return `${Math.floor(secs / 60)}m`
	if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
	return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`
}

function HealthStatus() {
	const [status, setStatus] = useState<DaemonStatus | null>(null)

	const poll = () =>
		fetch('/api/status')
			.then(r => r.json())
			.then(setStatus)
			.catch(() => setStatus({ running: false, pid: null, uptimeSec: null }))

	useEffect(() => {
		poll()
		const id = setInterval(poll, 5000)
		return () => clearInterval(id)
	}, [])

	if (!status) {
		return (
			<div className="p-4 border-t border-base-300">
				<div className="flex items-center gap-2 text-xs text-base-content/40">
					<span className="w-2 h-2 rounded-full bg-base-content/20" />
					<span>Checking daemon...</span>
				</div>
			</div>
		)
	}

	return (
		<div className="p-4 border-t border-base-300">
			<div className="flex items-center gap-2 mb-1">
				<span className={`w-2 h-2 rounded-full shrink-0 ${status.running ? 'bg-success animate-pulse' : 'bg-error'}`} />
				<span className={`text-xs font-medium ${status.running ? 'text-success' : 'text-error'}`}>
					{status.running ? 'Tamias ON' : 'Tamias OFF'}
				</span>
			</div>
			{status.running && status.pid && (
				<div className="pl-4 space-y-0.5">
					<p className="text-xs text-base-content/40 font-mono">PID: {status.pid}</p>
					{status.uptimeSec !== null && (
						<p className="text-xs text-base-content/40 font-mono">Up: {formatUptime(status.uptimeSec)}</p>
					)}
				</div>
			)}
			{!status.running && (
				<p className="pl-4 text-xs text-base-content/40 mt-0.5">Run <code className="text-base-content/60">tamias start</code></p>
			)}
			<div className="mt-4 pt-4 border-t border-base-300/50 space-y-1">
				<div className="flex justify-between items-center text-[10px] uppercase tracking-wider text-base-content/30 font-bold">
					<span>Tamias</span>
					<span className="font-mono">{status.tamiasVersion || '...'}</span>
				</div>
				<div className="flex justify-between items-center text-[10px] uppercase tracking-wider text-base-content/30 font-bold">
					<span>Dashboard</span>
					<span className="font-mono">{status.dashboardVersion || '...'}</span>
				</div>
			</div>
		</div>
	)
}

function NavContent() {
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const activeProjectId = searchParams.get('id')
	const { success, error } = useToast()

	const [projects, setProjects] = useState<{ id: string, name: string }[]>([])
	const [channels, setChannels] = useState<{ id: string, name: string, guildName: string, guildId: string }[]>([])

	// Modal State
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [formName, setFormName] = useState("")
	const [formPath, setFormPath] = useState("")
	const [formDesc, setFormDesc] = useState("")
	const [formChannel, setFormChannel] = useState("")
	const [formContext, setFormContext] = useState("readme.md")

	const fetchProjects = () => {
		fetch('/api/projects')
			.then(r => r.json())
			.then(setProjects)
			.catch(console.error)
	}

	useEffect(() => {
		fetchProjects()
		fetch('/api/discord/channels')
			.then(r => r.json())
			.then(data => setChannels(data.channels || []))
			.catch(console.error)
	}, [])

	const handleSaveProject = async () => {
		if (!formName || !formPath) {
			error("Name and Path are required")
			return
		}

		const selectedChannel = channels.find(c => c.id === formChannel)

		try {
			const res = await fetch(`/api/projects`, {
				method: "POST",
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
				success("Project saved!")
				setIsModalOpen(false)
				setFormName("")
				setFormPath("")
				setFormDesc("")
				setFormChannel("")
				setFormContext("readme.md")
				fetchProjects()
			} else {
				const errorData = await res.json()
				error(errorData.error || "Failed to save project")
			}
		} catch (err: any) {
			error(err.message || "An error occurred")
		}
	}

	const renderItem = (item: { href: string; label: string; icon: React.ReactNode }) => {
		const isActive = item.href === '/'
			? pathname === '/'
			: pathname.startsWith(item.href)

		return (
			<li key={item.href}>
				<Link
					href={item.href}
					onClick={() => {
						const drawer = document.getElementById('nav-drawer') as HTMLInputElement
						if (drawer) drawer.checked = false
					}}
					className={`${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-base-content/70 hover:bg-base-300/50'} py-2 px-3 flex items-center gap-3 rounded-lg transition-colors`}
				>
					{item.icon}
					<span className="text-sm">{item.label}</span>
				</Link>
			</li>
		)
	}

	return (
		<aside className="w-64 shrink-0 bg-base-200 border-r border-base-300 flex flex-col">
			{/* Logo */}
			<div className="px-6 py-5 border-b border-base-300">
				<div className="flex items-center gap-2">
					<div className="w-7 h-7 rounded-md bg-success flex items-center justify-center">
						<Cpu className="w-4 h-4 text-success-content" />
					</div>
					<span className="font-bold text-base-content tracking-wide font-mono">TamiasOS <small className="opacity-20">i4</small></span>
				</div>
			</div>

			{/* Navigation Links */}
			<div className="flex-1 overflow-y-auto p-4">
				<ul className="menu menu-sm p-0 w-full gap-4">
					{/* Workspace */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2 group flex items-center justify-between">
								<span>Workspace</span>
								<div className="tooltip tooltip-left before:text-[10px] before:px-2 before:py-1" data-tip="Create New Project">
									<button
										className="btn btn-xs btn-ghost btn-circle scale-75 opacity-0 group-hover:opacity-100 transition-all hover:bg-base-300"
										onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsModalOpen(true) }}
									>
										<Plus className="w-4 h-4" />
									</button>
								</div>
							</summary>
							<ul className="before:bg-base-300/50 mt-1 flex flex-col gap-1">
								{navGroups.Workspace.map(renderItem)}
								{/* Custom Projects List */}
								{projects.length > 0 && (
									<li className="mt-2">
										<p className="px-3 text-[10px] font-bold text-base-content/30 uppercase tracking-tighter">Projects</p>
										<ul className="mt-1 flex flex-col gap-0.5">
											{projects.map(p => {
												const isActive = activeProjectId === p.id && pathname.startsWith('/projects')
												return (
													<li key={p.id}>
														<Link
															href={`/projects?id=${p.id}`}
															onClick={() => {
																const drawer = document.getElementById('nav-drawer') as HTMLInputElement
																if (drawer) drawer.checked = false
															}}
															className={`${isActive ? 'bg-primary/10 text-primary font-bold shadow-sm' : 'text-base-content/60 hover:text-base-content/80 hover:bg-base-300/30'} py-1.5 px-3 text-xs flex items-center gap-2 rounded-md transition-all`}
														>
															<KanbanSquare className={`w-3.5 h-3.5 ${isActive ? 'opacity-100' : 'opacity-40'}`} />
															<span className="truncate">{p.name}</span>
														</Link>
													</li>
												)
											})}
										</ul>
									</li>
								)}
								{/* Default Projects link if no projects found or just to have it */}
								<li>
									<Link
										href="/projects"
										onClick={() => {
											const drawer = document.getElementById('nav-drawer') as HTMLInputElement
											if (drawer) drawer.checked = false
										}}
										className={`${(pathname === '/projects' && !activeProjectId) ? 'bg-primary/10 text-primary font-bold' : 'text-base-content/70 hover:bg-base-300/50'} py-2 px-3 text-sm flex items-center gap-3 rounded-lg mt-1 border border-base-300/30 border-dashed transition-all`}
									>
										<Plus className="w-4 h-4" />
										<span>All Projects</span>
									</Link>
								</li>
							</ul>
						</details>
					</li>

					{/* Capabilities */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2">Capabilities</summary>
							<ul className="before:bg-base-300/50 mt-1 flex flex-col gap-1">
								{navGroups.Capabilities.map(renderItem)}
							</ul>
						</details>
					</li>

					{/* Usage */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2">Usage</summary>
							<ul className="before:bg-base-300/50 mt-1 flex flex-col gap-1">
								{navGroups.Usage.map(renderItem)}
							</ul>
						</details>
					</li>

					{/* Infrastructure */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2">Infrastructure</summary>
							<ul className="before:bg-base-300/50 mt-1 flex flex-col gap-1">
								{navGroups.Infrastructure.map(renderItem)}
							</ul>
						</details>
					</li>
				</ul>
			</div>

			{/* Project Creation Modal */}
			{isModalOpen && (
				<dialog className="modal modal-open z-50" open>
					<div className="modal-box bg-base-100/90 backdrop-blur border border-base-200/50 w-full max-w-lg">
						<h3 className="text-lg font-semibold mb-4 text-primary flex items-center gap-2">
							<FolderOpen className="w-5 h-5" />
							Create New Project
						</h3>

						<div className="space-y-4">
							<div className="form-control">
								<label className="label"><span className="label-text">Project Name *</span></label>
								<input value={formName} onChange={e => setFormName(e.target.value)} type="text" className="input input-sm input-bordered w-full" placeholder="e.g. My Awesome Startup" />
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text">Absolute Path *</span></label>
								<input value={formPath} onChange={e => setFormPath(e.target.value)} type="text" className="input input-sm input-bordered w-full font-mono text-xs" placeholder="/Users/me/Projects/start" />
								<label className="label"><span className="label-text-alt text-base-content/50">The absolute directory path to your project.</span></label>
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text">Description</span></label>
								<textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} className="textarea textarea-sm textarea-bordered h-20" placeholder="Brief context about this project" />
							</div>

							<div className="divider my-0">Integrations</div>

							<div className="form-control">
								<label className="label py-1"><span className="label-text flex items-center gap-2 text-xs">Link Discord Channel</span></label>
								<select value={formChannel} onChange={e => setFormChannel(e.target.value)} className="select select-sm select-bordered w-full text-xs">
									<option value="">-- No Channel Linked --</option>
									{channels.map(c => (
										<option key={c.id} value={c.id}>
											{c.guildName} / #{c.name}
										</option>
									))}
								</select>
							</div>

							{formChannel && (
								<div className="form-control bg-base-200/50 p-3 rounded-lg border border-base-300">
									<label className="label pt-0"><span className="label-text font-semibold text-xs">Context File Path (Relative)</span></label>
									<input value={formContext} onChange={e => setFormContext(e.target.value)} type="text" className="input input-bordered w-full input-sm font-mono text-xs" placeholder="readme.md" />
								</div>
							)}
						</div>

						<div className="flex justify-end gap-2 pt-6 mt-4 border-t border-base-200/50">
							<button onClick={() => setIsModalOpen(false)} className="btn btn-sm btn-ghost">Cancel</button>
							<button onClick={handleSaveProject} className="btn btn-sm btn-primary gap-2">
								<Check className="w-4 h-4" /> Save Project
							</button>
						</div>
					</div>
					<form method="dialog" className="modal-backdrop">
						<button onClick={() => setIsModalOpen(false)}>close</button>
					</form>
				</dialog>
			)}

			{/* Live Health Status Footer */}
			<HealthStatus />
		</aside>
	)
}

export default function Nav() {
	return (
		<Suspense fallback={<div className="w-64 bg-base-200 animate-pulse" />}>
			<NavContent />
		</Suspense>
	)
}
