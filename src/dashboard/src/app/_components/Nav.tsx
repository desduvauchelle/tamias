'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const navItems = [
	{
		href: '/',
		label: 'Chat',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
			</svg>
		),
	},
	{
		href: '/models',
		label: 'AI Models',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
			</svg>
		),
	},

	{
		href: '/tools',
		label: 'Tools & MCPs',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.83-5.83M15.17 11.42L21 5.58A2.652 2.652 0 0017.25 1.83l-5.83 5.83m-1.42 8.66l-5.83 5.83A2.652 2.652 0 011.83 17.25l5.83-5.83m8.66-1.42l5.83-5.83A2.652 2.652 0 0017.25 1.83l-5.83 5.83" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		),
	},
	{
		href: '/skills',
		label: 'Skills',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
			</svg>
		),
	},
	{
		href: '/channels',
		label: 'Channels',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 3h3m-3 3h3" />
			</svg>
		),
	},
	{
		href: '/crons',
		label: 'Crons',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
		),
	},
	{
		href: '/logs',
		label: 'Logs',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
			</svg>
		),
	},
	{
		href: '/usage',
		label: 'Usage Info',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
		),
	},
	{
		href: '/docs',
		label: 'Docs',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
			</svg>
		),
	},
	{
		href: '/changelog',
		label: 'Changelog',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
			</svg>
		),
	},
]

interface DaemonStatus {
	running: boolean
	pid: number | null
	uptimeSec: number | null
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
					{status.running ? 'Daemon running' : 'Daemon stopped'}
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
				<p className="pl-4 text-xs text-base-content/40 mt-0.5">Run <code className="text-base-content/60">aegis start</code></p>
			)}
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
						<svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-success-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z" />
						</svg>
					</div>
					<span className="font-bold text-base-content tracking-wide font-mono">TamiasOS</span>
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
