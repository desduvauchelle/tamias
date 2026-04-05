'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Download } from 'lucide-react'
import { useToast } from './ToastProvider'

interface UpdateInfo {
	updateAvailable: boolean
	currentVersion?: string
	latestVersion?: string
	checkedAt?: number
	daemonOffline?: boolean
	updateInProgress?: boolean
	error?: string
}

const CHECK_INTERVAL_MS = 10 * 60 * 1000

function formatCheckedAt(timestamp?: number): string {
	if (!timestamp) return 'Never'
	try {
		return new Date(timestamp).toLocaleString()
	} catch {
		return 'Unknown'
	}
}

export default function SidebarUpdater() {
	const { success, error, info } = useToast()
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
	const [checking, setChecking] = useState(false)
	const [updating, setUpdating] = useState(false)
	const [updateStarted, setUpdateStarted] = useState(false)

	const checkForUpdates = useCallback(async (announce = false) => {
		setChecking(true)
		try {
			const res = await fetch('/api/update')
			const data = (await res.json()) as UpdateInfo
			setUpdateInfo(data)
			if (announce) {
				if (data.daemonOffline) info('Daemon is offline. Start it before updating.')
				else if (data.updateAvailable) success(`Update found: v${data.currentVersion} -> v${data.latestVersion}`)
				else success(`Already up to date${data.currentVersion ? ` (v${data.currentVersion})` : ''}.`)
			}
		} catch (err) {
			if (announce) error(`Update check failed: ${String(err)}`)
		} finally {
			setChecking(false)
		}
	}, [error, info, success])

	useEffect(() => {
		void checkForUpdates()
		const timer = setInterval(() => {
			void checkForUpdates()
		}, CHECK_INTERVAL_MS)
		return () => clearInterval(timer)
	}, [checkForUpdates])

	const triggerUpdate = useCallback(async () => {
		if (updating) return
		setUpdating(true)
		try {
			const res = await fetch('/api/update', { method: 'POST' })
			const body = await res.json() as { ok?: boolean; message?: string; error?: string; updateAvailable?: boolean }
			if (!res.ok) {
				error(body.error ?? 'Update request failed.')
				setUpdating(false)
				return
			}

			if (body.updateAvailable === false) {
				success(body.message ?? 'Already up to date.')
				setUpdating(false)
				void checkForUpdates()
				return
			}

			setUpdateStarted(true)
			success(body.message ?? 'Update started. Daemon will restart shortly.')
		} catch (err) {
			error(`Update failed: ${String(err)}`)
			setUpdating(false)
		}
	}, [checkForUpdates, error, success, updating])

	const canUpdate = useMemo(() => {
		if (!updateInfo) return false
		if (updateInfo.daemonOffline) return false
		if (updateInfo.updateInProgress) return false
		if (!updateInfo.updateAvailable) return false
		if (updateStarted) return false
		return true
	}, [updateInfo, updateStarted])

	const statusLine = useMemo(() => {
		if (!updateInfo) return checking ? 'Checking updates…' : 'Update status unknown'
		if (updateStarted || updateInfo.updateInProgress) return 'Update in progress… daemon will restart'
		if (updateInfo.daemonOffline) return 'Daemon offline'
		if (updateInfo.updateAvailable) return `Update available: v${updateInfo.latestVersion}`
		return `Up to date${updateInfo.currentVersion ? ` (v${updateInfo.currentVersion})` : ''}`
	}, [checking, updateInfo, updateStarted])

	return (
		<li data-testid="sidebar-updater" className="mt-4 pt-4 border-t border-base-300/50">
			<div className="px-3 flex items-center justify-between mb-2">
				<span className="text-[10px] font-bold uppercase tracking-wider opacity-40">Updates</span>
				<button
					type="button"
					onClick={() => void checkForUpdates(true)}
					disabled={checking || updating || updateStarted}
					className="btn btn-ghost btn-xs px-2 min-h-0 h-6"
					title="Check for updates now"
				>
					{checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
					Check
				</button>
			</div>

			<div className="px-1 opacity-70 flex flex-col gap-1">
				<div className="flex justify-between text-[9px] font-mono uppercase">
					<span>Status</span>
					<span className="max-w-[130px] truncate text-right">{statusLine}</span>
				</div>
				<div className="flex justify-between text-[9px] font-mono uppercase">
					<span>Current</span>
					<span>{updateInfo?.currentVersion ?? '...'}</span>
				</div>
				<div className="flex justify-between text-[9px] font-mono uppercase">
					<span>Latest</span>
					<span>{updateInfo?.latestVersion ?? '...'}</span>
				</div>
				<div className="flex justify-between text-[9px] font-mono uppercase">
					<span>Checked</span>
					<span className="max-w-[130px] truncate text-right">{formatCheckedAt(updateInfo?.checkedAt)}</span>
				</div>
			</div>

			<div className="mt-2 px-1">
				<button
					type="button"
					onClick={() => void triggerUpdate()}
					disabled={!canUpdate || updating}
					className="btn btn-primary btn-xs w-full gap-1"
					title="Install latest update and restart daemon"
				>
					{updating || updateStarted ? (
						<Loader2 className="w-3 h-3 animate-spin" />
					) : (
						<Download className="w-3 h-3" />
					)}
					{updating || updateStarted ? 'Updating…' : 'Update now'}
				</button>
			</div>
		</li>
	)
}
