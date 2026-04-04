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
	Check,
	Code
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
			href: '/coding',
			label: 'Coding CLIs',
			icon: <Code className="w-4 h-4" />,
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

	if (!status) return null

	return (
		<li data-testid="health-status" className="mt-4 pt-4 border-t border-base-300/50">
			<div className="px-3 flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<span data-testid="health-indicator" className={`w-1.5 h-1.5 rounded-full ${status.running ? 'bg-success animate-pulse' : 'bg-error'}`} />
					<span className="text-[10px] font-bold uppercase tracking-wider opacity-40">System Status</span>
				</div>
				{/* <span className={`text-[10px] font-mono ${status.running ? 'text-success' : 'text-error'}`}>
					{status.running ? 'ONLINE' : 'OFFLINE'}
				</span> */}
			</div>

			<div className="px-1 opacity-50 flex flex-col gap-0.5">
				{status.running && (
					<div className="flex justify-between text-[9px] font-mono uppercase">
						<span>PID {status.pid}</span>
						<span>UP {status.uptimeSec !== null ? formatUptime(status.uptimeSec) : '...'}</span>
					</div>
				)}
				<div className="flex justify-between text-[9px] font-mono uppercase">
					<span>Tamias</span>
					<span>{status.tamiasVersion || '...'}</span>
				</div>
				<div className="flex justify-between text-[9px] font-mono uppercase">
					<span>Dashboard</span>
					<span>{status.dashboardVersion || '...'}</span>
				</div>
			</div>
		</li>
	)
}

interface NavContentProps {
	onNewProject: () => void
}

function NavContent({ onNewProject }: NavContentProps) {
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const activeProjectId = searchParams.get('id')

	const [projects, setProjects] = useState<{ id: string, name: string }[]>([])

	const fetchProjects = () => {
		fetch('/api/projects')
			.then(r => r.json())
			.then(setProjects)
			.catch(console.error)
	}

	useEffect(() => {
		fetchProjects()
		// Listen for project refresh events (e.g. from layout modal)
		const handleRefresh = () => fetchProjects()
		window.addEventListener('refreshProjects', handleRefresh)
		return () => window.removeEventListener('refreshProjects', handleRefresh)
	}, [])

	const renderItem = (item: { href: string; label: string; icon: React.ReactNode }) => {
		const isActive = item.href === '/'
			? pathname === '/'
			: pathname.startsWith(item.href)

		return (
			<li key={item.href}>
				<Link
					data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
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
		<aside data-testid="sidebar" className="w-64 shrink-0 bg-base-200 border-r border-base-300 flex flex-col h-screen overflow-hidden">
			{/* Logo */}
			<div className="px-6 py-5 border-b border-base-300 shrink-0">
				<div className="flex items-center gap-2">
					<div className="w-7 h-7 rounded-md bg-success flex items-center justify-center">
						<Cpu className="w-4 h-4 text-success-content" />
					</div>
					<span className="font-bold text-base-content tracking-wide font-mono">TamiasOS <small className="opacity-20">i4</small></span>
				</div>
			</div>

			{/* Navigation Links */}
			<div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
				<ul className="menu menu-sm p-0 w-full gap-4">
					{/* Workspace */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2 group flex items-center justify-between">
								<span>Workspace</span>
								<div className="tooltip tooltip-left before:text-[10px] before:px-2 before:py-1" data-tip="Create New Project">
									<button
										className="btn btn-xs btn-ghost btn-circle scale-75 transition-all hover:bg-base-300"
										onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNewProject() }}
									>
										<Plus className="w-4 h-4" />
									</button>
								</div>
							</summary>
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
								{projects.length === 0 && (
									<li className="px-3 py-2 text-xs opacity-30 italic">No projects found.</li>
								)}
							</ul>
						</details>
					</li>

					{/* Capabilities */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2">Capabilities</summary>
							<ul className="mt-1 flex flex-col gap-1">
								{navGroups.Capabilities.map(renderItem)}
							</ul>
						</details>
					</li>

					{/* Usage */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2">Usage</summary>
							<ul className="mt-1 flex flex-col gap-1">
								{navGroups.Usage.map(renderItem)}
							</ul>
						</details>
					</li>

					{/* Infrastructure */}
					<li>
						<details open>
							<summary className="font-bold text-xs uppercase tracking-widest text-base-content/40 hover:text-base-content/60 py-2">Infrastructure</summary>
							<ul className="mt-1 flex flex-col gap-1">
								{navGroups.Infrastructure.map(renderItem)}
							</ul>
						</details>
					</li>

					{/* Inline Health Status */}
					<HealthStatus />
				</ul>
			</div>
		</aside>
	)
}

interface NavProps {
	onNewProject: () => void
}

export default function Nav({ onNewProject }: NavProps) {
	return (
		<Suspense fallback={<div className="w-64 bg-base-200 animate-pulse h-full border-r border-base-300" />}>
			<NavContent onNewProject={onNewProject} />
		</Suspense>
	)
}
