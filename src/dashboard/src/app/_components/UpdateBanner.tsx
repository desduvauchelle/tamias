'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, X, AlertTriangle } from 'lucide-react'

interface UpdateInfo {
	updateAvailable: boolean
	currentVersion?: string
	latestVersion?: string
	checkedAt?: number
	daemonOffline?: boolean
}

const DISMISSED_KEY = 'tamias_update_dismissed'
const CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

export default function UpdateBanner() {
	const [info, setInfo] = useState<UpdateInfo | null>(null)
	const [dismissed, setDismissed] = useState(false)
	const [updating, setUpdating] = useState(false)
	const [updateDone, setUpdateDone] = useState(false)

	useEffect(() => {
		// Check if user already dismissed this version
		const dismissedVersion = localStorage.getItem(DISMISSED_KEY)

		const checkUpdate = async () => {
			try {
				const res = await fetch('/api/update')
				if (!res.ok) return
				const data: UpdateInfo = await res.json()
				setInfo(data)

				// Auto-dismiss if this version was already dismissed
				if (data.latestVersion && dismissedVersion === data.latestVersion) {
					setDismissed(true)
				}
			} catch {
				// Network error — silently ignore
			}
		}

		checkUpdate()
		const id = setInterval(checkUpdate, CHECK_INTERVAL)
		return () => clearInterval(id)
	}, [])

	const handleDismiss = () => {
		if (info?.latestVersion) {
			localStorage.setItem(DISMISSED_KEY, info.latestVersion)
		}
		setDismissed(true)
	}

	const handleUpdate = async () => {
		if (updating) return
		setUpdating(true)
		try {
			const res = await fetch('/api/update', { method: 'POST' })
			const data = await res.json()
			if (res.ok) {
				setUpdateDone(true)
			} else {
				alert(`Update failed: ${data.error}`)
				setUpdating(false)
			}
		} catch (err) {
			alert(`Update failed: ${err}`)
			setUpdating(false)
		}
	}

	if (!info?.updateAvailable || dismissed) return null

	if (updateDone) {
		return (
			<div className="bg-success/10 border-b border-success/30 text-success-content px-4 py-2 text-sm flex items-center justify-between">
				<span className="flex items-center gap-2">
					<RefreshCw className="w-4 h-4 animate-spin" />
					Updating to v{info.latestVersion}… Daemon will restart momentarily.
				</span>
			</div>
		)
	}

	return (
		<div className="bg-warning/10 border-b border-warning/40 px-4 py-2 text-sm flex items-center justify-between gap-3 shrink-0">
			<div className="flex items-center gap-2 text-warning-content min-w-0">
				<AlertTriangle className="w-4 h-4 text-warning shrink-0" />
				<span className="truncate">
					<span className="font-semibold">Tamias v{info.latestVersion} available</span>
					{info.currentVersion && <span className="opacity-60 ml-1">(current: v{info.currentVersion})</span>}
				</span>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<div
					className="tooltip tooltip-left before:text-[11px] before:max-w-[220px] before:whitespace-pre-wrap"
					data-tip={`⚠️ Updating will stop all active sessions and restart the daemon.`}
				>
					<button
						onClick={handleUpdate}
						disabled={updating}
						className="btn btn-warning btn-xs gap-1"
					>
						<RefreshCw className={`w-3 h-3 ${updating ? 'animate-spin' : ''}`} />
						{updating ? 'Updating…' : 'Update now'}
					</button>
				</div>
				<button onClick={handleDismiss} className="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100">
					<X className="w-3 h-3" />
				</button>
			</div>
		</div>
	)
}
