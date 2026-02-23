'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

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
	Cpu
} from 'lucide-react'

const navItems = [
	{
		href: '/',
		label: 'Chat',
		icon: <MessageSquare className="w-5 h-5" />,
	},
	{
		href: '/models',
		label: 'AI Models',
		icon: <Zap className="w-5 h-5" />,
	},

	{
		href: '/tools',
		label: 'Tools & MCPs',
		icon: <Wrench className="w-5 h-5" />,
	},
	{
		href: '/skills',
		label: 'Skills',
		icon: <BookOpen className="w-5 h-5" />,
	},
	{
		href: '/channels',
		label: 'Channels',
		icon: <Smartphone className="w-5 h-5" />,
	},
	{
		href: '/crons',
		label: 'Crons',
		icon: <Clock className="w-5 h-5" />,
	},
	{
		href: '/history',
		label: 'History',
		icon: <List className="w-5 h-5" />,
	},
	{
		href: '/usage',
		label: 'Usage Info',
		icon: <CircleDollarSign className="w-5 h-5" />,
	},
	{
		href: '/docs',
		label: 'Docs',
		icon: <FileText className="w-5 h-5" />,
	},
	{
		href: '/changelog',
		label: 'Changelog',
		icon: <History className="w-5 h-5" />,
	},
]

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
				<span className={`w-2 h-2 rounded-full flex-shrink-0 ${status.running ? 'bg-success animate-pulse' : 'bg-error'}`} />
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

export default function Nav() {
	const pathname = usePathname()

	return (
		<aside className="w-56 flex-shrink-0 bg-base-200 border-r border-base-300 flex flex-col">
			{/* Logo */}
			<div className="px-6 py-5 border-b border-base-300">
				<div className="flex items-center gap-2">
					<div className="w-7 h-7 rounded-md bg-success flex items-center justify-center">
						<Cpu className="w-4 h-4 text-success-content" />
					</div>
					<span className="font-bold text-base-content tracking-wide font-mono">TamiasOS <small className="opacity-20">2</small></span>
				</div>
			</div>

			{/* Navigation Links */}
			<ul className="menu flex-1 p-3 gap-0.5 w-full">
				{navItems.map((item) => {
					const isActive = item.href === '/'
						? pathname === '/'
						: pathname.startsWith(item.href)
					return (
						<li key={item.href} className='block'>
							<Link
								href={item.href}
								className={`${isActive ? 'bg-base-300 text-primary hover:bg-base-300/50' : ''} w-full`}
							>
								{item.icon}
								{item.label}
							</Link>
						</li>
					)
				})}
			</ul>

			{/* Live Health Status Footer */}
			<HealthStatus />
		</aside>
	)
}
