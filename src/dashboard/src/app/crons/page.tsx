'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trash2, Plus, Check, Clock, Play, Loader2, Pencil, Target, Activity } from 'lucide-react'
import { Modal } from '../_components/Modal'

export type CronJob = {
	id: string
	name: string
	schedule: string
	type: 'ai' | 'message'
	prompt: string
	target: string
	enabled: boolean
	lastRun?: string
	lastStatus?: 'success' | 'error'
	lastError?: string
	createdAt: string
}

interface SessionInfo {
	id: string
	channelId: string
	channelUserId?: string
	channelName?: string
	updatedAt: string
}

interface CronTargetOption {
	target: string
	label: string
	platform?: string
	source?: string
}

function normalizeTargetLabel(target: string, options: CronTargetOption[]) {
	if (target === 'last') return 'Last active session'
	const match = options.find(option => option.target === target)
	if (match) return match.label
	if (target.startsWith('discord:')) {
		const channelId = target.split(':')[1]
		return `Discord #${channelId}`
	}
	return target
}

function CronTestModal({ job, onClose }: { job: CronJob; onClose: () => void }) {
	const [sessions, setSessions] = useState<SessionInfo[]>([])
	const [selectedTarget, setSelectedTarget] = useState(job.target)
	const [customTarget, setCustomTarget] = useState('')
	const [useCustom, setUseCustom] = useState(false)
	const [running, setRunning] = useState(false)
	const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

	useEffect(() => {
		fetch('/api/sessions')
			.then(r => r.json())
			.then(d => {
				const sess: SessionInfo[] = (d.sessions || []).filter(
					(s: SessionInfo) => s.channelId && s.channelId !== 'terminal' && s.channelUserId
				)
				setSessions(sess)
			})
			.catch(() => { })
	}, [])

	const sessionTargets = sessions
		.map(s => ({
			target: `${s.channelId}:${s.channelUserId}`,
			label: s.channelName || `${s.channelId}:${s.channelUserId}`,
		}))
		.filter((v, i, arr) => arr.findIndex(x => x.target === v.target) === i)

	const effectiveTarget = useCustom ? customTarget : selectedTarget

	const run = async () => {
		setRunning(true)
		setResult(null)
		try {
			const res = await fetch('/api/crons/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cronId: job.id, target: effectiveTarget || undefined }),
			})
			const data = await res.json()
			if (data.ok) {
				setResult({ ok: true, message: `Triggered "${data.jobName}" → ${data.target}` })
			} else {
				setResult({ ok: false, message: data.error || 'Unknown error' })
			}
		} catch (err) {
			setResult({ ok: false, message: String(err) })
		}
		setRunning(false)
	}

	return (
		<Modal
			isOpen={true}
			onClose={onClose}
			className="w-full max-w-lg"
			title={
				<div>
					<h2 className="text-xl font-black uppercase tracking-tighter text-primary flex items-center gap-2">
						<Play size={20} /> Test Job
					</h2>
					<p className="text-sm text-base-content/60 mt-0.5">{job.name}</p>
				</div>
			}
			footer={
				<div className="flex gap-3 justify-end">
					<button onClick={onClose} className="btn btn-sm btn-ghost">Cancel</button>
					<button onClick={run} disabled={running} className="btn btn-sm btn-primary gap-2">
						{running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
						{running ? 'Triggering…' : 'Run Test'}
					</button>
				</div>
			}
		>
			<div className="space-y-5 font-mono">
				<div className="text-xs text-base-content/50">
					Type: <span className="badge badge-ghost badge-sm">{job.type === 'message' ? '💬 Direct message' : '🤖 AI Response'}</span>
				</div>

				<div className="space-y-2">
					<p className="text-xs font-bold uppercase tracking-wider text-base-content/50">Send to channel</p>

					<label className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-all ${!useCustom && selectedTarget === job.target ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-base-content/30'}`}>
						<input type="radio" className="radio radio-primary radio-sm" checked={!useCustom && selectedTarget === job.target} onChange={() => { setUseCustom(false); setSelectedTarget(job.target) }} />
						<div className="min-w-0">
							<div className="text-xs font-bold">Job default</div>
							<code className="text-xs text-base-content/60 truncate block">{job.target}</code>
						</div>
					</label>

					{sessionTargets.filter(t => t.target !== job.target).map(t => (
						<label key={t.target} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-all ${!useCustom && selectedTarget === t.target ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-base-content/30'}`}>
							<input type="radio" className="radio radio-primary radio-sm" checked={!useCustom && selectedTarget === t.target} onChange={() => { setUseCustom(false); setSelectedTarget(t.target) }} />
							<div className="min-w-0">
								<div className="text-xs font-bold truncate">{t.label}</div>
								<code className="text-xs text-base-content/60 truncate block">{t.target}</code>
							</div>
						</label>
					))}

					<label className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-all ${useCustom ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-base-content/30'}`}>
						<input type="radio" className="radio radio-primary radio-sm" checked={useCustom} onChange={() => setUseCustom(true)} />
						<div className="flex-1 min-w-0">
							<div className="text-xs font-bold mb-1">Custom target</div>
							<input
								type="text"
								placeholder="e.g. discord:1234567890"
								className="input input-xs input-bordered w-full font-mono"
								value={customTarget}
								onFocus={() => setUseCustom(true)}
								onChange={e => setCustomTarget(e.target.value)}
							/>
						</div>
					</label>
				</div>

				{result && (
					<div className={`text-xs p-3 rounded-xl font-mono ${result.ok ? 'bg-success/20 text-success border border-success/30' : 'bg-error/20 text-error border border-error/30'}`}>
						{result.ok ? '✅ ' : '❌ '}{result.message}
					</div>
				)}
			</div>
		</Modal>
	)
}

function CronEditModal({
	job,
	targetOptions,
	onSave,
	onClose,
}: {
	job: CronJob
	targetOptions: CronTargetOption[]
	onSave: (job: CronJob) => void
	onClose: () => void
}) {
	const [draft, setDraft] = useState<CronJob>(job)
	const [selectedTarget, setSelectedTarget] = useState(job.target)
	const [customTarget, setCustomTarget] = useState('')

	const targetChoices = useMemo(() => {
		const base: CronTargetOption[] = [{ target: 'last', label: 'Last active session', platform: 'system', source: 'builtin' }]
		for (const option of targetOptions) {
			if (!base.find(b => b.target === option.target)) {
				base.push(option)
			}
		}
		if (!base.find(b => b.target === draft.target)) {
			base.push({ target: draft.target, label: normalizeTargetLabel(draft.target, targetOptions), platform: 'custom', source: 'existing' })
		}
		return base
	}, [targetOptions, draft.target])

	const isKnownTarget = targetChoices.some(choice => choice.target === selectedTarget)
	const effectiveTarget = isKnownTarget ? selectedTarget : (customTarget || selectedTarget)

	return (
		<Modal
			isOpen={true}
			onClose={onClose}
			className="w-full max-w-2xl"
			title={
				<div>
					<h2 className="text-xl font-black uppercase tracking-tighter text-primary flex items-center gap-2">
						<Pencil size={20} /> Edit Cron
					</h2>
					<p className="text-sm text-base-content/60 mt-0.5">{draft.name}</p>
				</div>
			}
			footer={
				<div className="flex gap-3 justify-end">
					<button onClick={onClose} className="btn btn-sm btn-ghost">Cancel</button>
					<button
						onClick={() => onSave({ ...draft, target: effectiveTarget })}
						className="btn btn-sm btn-primary"
					>
						Save
					</button>
				</div>
			}
		>
			<div className="space-y-4 font-mono">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<div className="space-y-1">
						<label className="text-xs font-bold uppercase tracking-wider text-base-content/60">Name</label>
						<input
							type="text"
							className="input input-sm input-bordered w-full"
							value={draft.name}
							onChange={e => setDraft({ ...draft, name: e.target.value })}
						/>
					</div>
					<div className="space-y-1">
						<label className="text-xs font-bold uppercase tracking-wider text-base-content/60">Schedule</label>
						<input
							type="text"
							className="input input-sm input-bordered w-full"
							placeholder="e.g. 1h or 0 9 * * 1-5"
							value={draft.schedule}
							onChange={e => setDraft({ ...draft, schedule: e.target.value })}
						/>
					</div>
				</div>

				<div className="flex items-center justify-between rounded-lg border border-base-300 p-3">
					<div>
						<p className="text-xs font-bold uppercase tracking-wider text-base-content/60">Enabled</p>
						<p className="text-xs text-base-content/50">Run this cron when the daemon is active</p>
					</div>
					<input
						type="checkbox"
						className="toggle toggle-primary toggle-sm"
						checked={draft.enabled}
						onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
					/>
				</div>

				<div className="space-y-1">
					<label className="text-xs font-bold uppercase tracking-wider text-base-content/60">Type</label>
					<div className="flex gap-2">
						<button
							className={`btn btn-xs ${(draft.type ?? 'ai') === 'ai' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
							onClick={() => setDraft({ ...draft, type: 'ai' })}
						>
							🤖 AI Response
						</button>
						<button
							className={`btn btn-xs ${draft.type === 'message' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
							onClick={() => setDraft({ ...draft, type: 'message' })}
						>
							💬 Direct
						</button>
					</div>
				</div>

				<div className="space-y-1">
					<label className="text-xs font-bold uppercase tracking-wider text-base-content/60">
						{draft.type === 'message' ? 'Message' : 'Prompt'}
					</label>
					<textarea
						className="textarea textarea-bordered textarea-sm w-full min-h-24"
						value={draft.prompt}
						onChange={e => setDraft({ ...draft, prompt: e.target.value })}
					/>
				</div>

				<div className="space-y-1">
					<label className="text-xs font-bold uppercase tracking-wider text-base-content/60">Target</label>
					<select
						className="select select-sm select-bordered w-full"
						value={isKnownTarget ? selectedTarget : '__custom__'}
						onChange={e => {
							const value = e.target.value
							if (value === '__custom__') {
								setSelectedTarget(customTarget || draft.target)
								return
							}
							setSelectedTarget(value)
						}}
					>
						{targetChoices.map(choice => (
							<option key={choice.target} value={choice.target}>{choice.label}</option>
						))}
						<option value="__custom__">Custom target…</option>
					</select>
					{(!isKnownTarget || (isKnownTarget && selectedTarget === draft.target && !targetChoices.find(c => c.target === draft.target))) && (
						<input
							type="text"
							className="input input-sm input-bordered w-full mt-2"
							placeholder="e.g. discord:1234567890"
							value={customTarget || draft.target}
							onChange={e => {
								setCustomTarget(e.target.value)
								setSelectedTarget(e.target.value)
							}}
						/>
					)}
				</div>
			</div>
		</Modal>
	)
}

function CronCard({
	job,
	targetOptions,
	onToggle,
	onEdit,
	onRemove,
	onTest,
}: {
	job: CronJob
	targetOptions: CronTargetOption[]
	onToggle: (id: string, enabled: boolean) => void
	onEdit: (job: CronJob) => void
	onRemove: (id: string) => void
	onTest: (job: CronJob) => void
}) {
	const statusClass = job.lastStatus === 'error' ? 'text-error' : 'text-success'
	const statusText = job.lastStatus === 'error'
		? `Failed${job.lastError ? `: ${job.lastError}` : ''}`
		: job.lastStatus === 'success'
			? 'Success'
			: 'No runs yet'

	return (
		<div className={`card bg-base-200 border ${job.enabled ? 'border-primary' : 'border-base-300 opacity-70'} transition-all`}>
			<div className="card-body p-4 space-y-4">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h3 className="font-black uppercase tracking-tight text-base truncate">{job.name}</h3>
						<p className="text-xs text-base-content/45">ID: {job.id.slice(0, 8)}</p>
					</div>
					<input
						type="checkbox"
						className="toggle toggle-primary toggle-sm"
						checked={job.enabled}
						onChange={e => onToggle(job.id, e.target.checked)}
					/>
				</div>

				<div className="space-y-2 text-xs">
					<div className="flex items-center gap-2 text-base-content/70">
						<Clock size={12} />
						<span className="font-bold uppercase tracking-wide">Schedule</span>
						<span className="font-mono">{job.schedule}</span>
					</div>
					<div className="flex items-center gap-2 text-base-content/70">
						<Target size={12} />
						<span className="font-bold uppercase tracking-wide">Target</span>
						<span className="truncate">{normalizeTargetLabel(job.target, targetOptions)}</span>
					</div>
					<div className="flex items-start gap-2">
						<Activity size={12} className="mt-0.5 text-base-content/70" />
						<div className="min-w-0">
							<div className="text-base-content/70">
								<span className="font-bold uppercase tracking-wide">Last run</span>{' '}
								{job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
							</div>
							<div className={`truncate ${statusClass}`}>{statusText}</div>
						</div>
					</div>
				</div>

				<div className="flex items-center justify-end gap-2">
					<button onClick={() => onTest(job)} className="btn btn-xs btn-ghost text-success">
						<Play size={14} /> Test
					</button>
					<button onClick={() => onEdit(job)} className="btn btn-xs btn-primary">
						<Pencil size={14} /> Edit
					</button>
					<button
						onClick={() => {
							if (window.confirm(`Delete "${job.name}"? This cannot be undone.`)) {
								onRemove(job.id)
							}
						}}
						className="btn btn-xs btn-ghost text-error"
					>
						<Trash2 size={14} /> Delete
					</button>
				</div>
			</div>
		</div>
	)
}

export default function CronsPage() {
	const [crons, setCrons] = useState<CronJob[]>([])
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)
	const [testJob, setTestJob] = useState<CronJob | null>(null)
	const [editingJob, setEditingJob] = useState<CronJob | null>(null)
	const [targetOptions, setTargetOptions] = useState<CronTargetOption[]>([])
	const [daemonRunning, setDaemonRunning] = useState(false)

	useEffect(() => {
		fetch('/api/crons')
			.then(r => r.json())
			.then(d => {
				setCrons(d.crons || [])
			})
	}, [])

	useEffect(() => {
		Promise.all([
			fetch('/api/status').then(r => r.json()),
			fetch('/api/crons/targets').then(r => r.json()),
		])
			.then(([status, targets]) => {
				setDaemonRunning(Boolean(status?.running))
				setTargetOptions(Array.isArray(targets?.targets) ? targets.targets : [])
			})
			.catch(() => {
				setDaemonRunning(false)
				setTargetOptions([])
			})
	}, [])

	const save = async () => {
		setSaving(true)
		await fetch('/api/crons', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ crons }),
		})
		setSaving(false)
		setSaved(true)
		setTimeout(() => setSaved(false), 2000)
	}

	const addCron = () => {
		const newCron: CronJob = {
			id: crypto.randomUUID(),
			name: 'New Cron Task',
			schedule: '1h',
			type: 'ai',
			prompt: 'Check pending tasks and summarize them.',
			target: 'last',
			enabled: true,
			createdAt: new Date().toISOString(),
		}
		setCrons(prev => [newCron, ...prev])
		setEditingJob(newCron)
	}

	const updateCron = (id: string, update: CronJob) => {
		setCrons(prev => prev.map(c => c.id === id ? update : c))
	}

	const removeCron = (id: string) => {
		setCrons(prev => prev.filter(c => c.id !== id))
	}

	return (
		<>
			<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
				<div className="flex justify-between items-start">
					<div>
						<h1 className="text-3xl font-black text-primary uppercase tracking-tighter flex items-center gap-3">
							<Clock size={32} /> AUTOMATED TASKS
						</h1>
						<p className="text-base-content/50 text-sm mt-1">Configure background AI agent triggers.</p>
						<p className={`text-xs mt-2 ${daemonRunning ? 'text-success' : 'text-warning'}`}>
							Daemon: {daemonRunning ? 'running' : 'not running'}
						</p>
					</div>
					<button
						onClick={save}
						disabled={saving}
						className="btn btn-primary btn-md shadow-lg m-1 px-8 rounded-full"
					>
						{saving ? <span className="loading loading-spinner loading-sm" /> : saved ? <Check size={18} /> : null}
						{saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
					</button>
				</div>

				<section className="space-y-6">
					<div className="border-b-2 border-primary/20 pb-4 flex justify-between items-end">
						<h2 className="text-2xl font-black flex items-center gap-3 uppercase">
							Active Background Tasks
						</h2>
						<button onClick={addCron} className="btn btn-sm btn-primary gap-2">
							<Plus size={16} /> Create Cron
						</button>
					</div>

					{crons.length === 0 ? (
						<div className="text-sm text-base-content/30 italic p-12 border-2 border-dashed rounded-2xl border-base-300 text-center bg-base-200/50">
							No scheduled tasks yet. Click above to create your first background worker.
						</div>
					) : (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
							{crons.map(c => (
								<CronCard
									key={c.id}
									job={c}
									targetOptions={targetOptions}
									onToggle={(id, enabled) => {
										const current = crons.find(item => item.id === id)
										if (!current) return
										updateCron(id, { ...current, enabled })
									}}
									onEdit={setEditingJob}
									onRemove={removeCron}
									onTest={setTestJob}
								/>
							))}
						</div>
					)}
				</section>
			</div>

			{editingJob && (
				<CronEditModal
					key={editingJob.id}
					job={editingJob}
					targetOptions={targetOptions}
					onClose={() => setEditingJob(null)}
					onSave={(job) => {
						updateCron(job.id, job)
						setEditingJob(null)
					}}
				/>
			)}
			{testJob && <CronTestModal job={testJob} onClose={() => setTestJob(null)} />}
		</>
	)
}
