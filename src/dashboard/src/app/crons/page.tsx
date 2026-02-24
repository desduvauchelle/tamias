'use client'

import { useState, useEffect } from 'react'
import { Trash2, Plus, Check, Clock, Brain, Target, Info, Play, X, Loader2 } from 'lucide-react'

export type CronJob = {
	id: string
	name: string
	schedule: string
	/** 'ai' = prompt to AI → response to channel; 'message' = send text directly */
	type: 'ai' | 'message'
	prompt: string
	target: string
	enabled: boolean
	lastRun?: string
	createdAt: string
}

interface SessionInfo {
	id: string
	channelId: string
	channelUserId?: string
	channelName?: string
	updatedAt: string
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
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
			<div className="bg-base-100 border border-base-300 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-5 font-mono" onClick={e => e.stopPropagation()}>
				<div className="flex items-start justify-between">
					<div>
						<h2 className="text-xl font-black uppercase tracking-tighter text-primary flex items-center gap-2">
							<Play size={20} /> Test Job
						</h2>
						<p className="text-sm text-base-content/60 mt-0.5">{job.name}</p>
					</div>
					<button onClick={onClose} className="btn btn-sm btn-ghost btn-circle"><X size={18} /></button>
				</div>

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

				<div className="flex gap-3 justify-end pt-1">
					<button onClick={onClose} className="btn btn-sm btn-ghost">Cancel</button>
					<button onClick={run} disabled={running} className="btn btn-sm btn-primary gap-2">
						{running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
						{running ? 'Triggering…' : 'Run Test'}
					</button>
				</div>
			</div>
		</div>
	)
}

function CronCard({
	job,
	onChange,
	onRemove,
	onTest
}: {
	job: CronJob
	onChange: (c: CronJob) => void
	onRemove: (id: string) => void
	onTest: (job: CronJob) => void
}) {
	return (
		<div className={`card bg-base-200 border ${job.enabled ? 'border-primary' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all group relative overflow-hidden`}>
			<div className="card-body p-4 space-y-4">
				<div className="flex items-start justify-between gap-4">
					<div className="flex-1 space-y-2">
						<input
							type="text"
							placeholder="Job Name"
							className="input input-sm input-ghost w-full font-bold text-base-content text-lg uppercase px-0 h-auto min-h-0 focus:text-primary transition-colors"
							value={job.name}
							onChange={e => onChange({ ...job, name: e.target.value })}
						/>
						<div className="text-xs text-base-content/50 font-mono">ID: {job.id.slice(0, 8)}</div>
					</div>
					<div className="flex items-center gap-3 shrink-0">
						<div className="tooltip tooltip-left" data-tip={job.enabled ? 'Pause task' : 'Enable task'}>
							<input
								type="checkbox"
								className="toggle toggle-primary toggle-sm"
								checked={job.enabled}
								onChange={e => onChange({ ...job, enabled: e.target.checked })}
							/>
						</div>
						<button
							onClick={() => onTest(job)}
							className="btn btn-sm btn-circle btn-ghost text-success opacity-0 group-hover:opacity-100 transition-all hover:bg-success/20"
							title="Test this job now"
						>
							<Play size={16} />
						</button>
						<button
							onClick={() => {
								if (window.confirm(`⚠️ DELETION CONFIRMATION\n\nAre you sure you want to permanently delete "${job.name}"?\n\nThis action cannot be undone.`)) {
									onRemove(job.id)
								}
							}}
							className="btn btn-sm btn-circle btn-error btn-ghost opacity-0 group-hover:opacity-100 transition-all hover:bg-error/20"
							title="Remove cron job"
						>
							<Trash2 size={16} />
						</button>
					</div>
				</div>

				<div className="divider m-0 opacity-20">Configuration</div>

				<div className="flex-1 space-y-3">
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 flex items-center gap-1">
							<Clock size={12} /> Schedule
						</span>
						<input
							type="text"
							placeholder="e.g. 30m, 1h, or cron expression"
							className="input input-sm input-bordered w-full font-mono text-xs"
							value={job.schedule}
							onChange={e => onChange({ ...job, schedule: e.target.value })}
						/>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">Type</span>
						<div className="flex gap-2">
							<button
								className={`btn btn-xs ${(job.type ?? 'ai') === 'ai' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
								onClick={() => onChange({ ...job, type: 'ai' })}
								title="Send prompt to AI, deliver generated response to the channel"
							>🤖 AI Response</button>
							<button
								className={`btn btn-xs ${job.type === 'message' ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
								onClick={() => onChange({ ...job, type: 'message' })}
								title="Send the text directly to the channel with no AI involved"
							>💬 Direct</button>
						</div>
					</div>
					<div className="flex items-start gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 mt-2 flex items-center gap-1">
							<Brain size={12} /> {job.type === 'message' ? 'Message' : 'Prompt'}
						</span>
						<textarea
							placeholder={job.type === 'message' ? 'Text to send directly to the channel' : 'Instruction for the AI agent'}
							className="textarea textarea-bordered textarea-sm w-full font-mono min-h-20"
							value={job.prompt}
							onChange={e => onChange({ ...job, prompt: e.target.value })}
						/>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 flex items-center gap-1">
							<Target size={12} /> Target
						</span>
						<input
							type="text"
							placeholder="e.g. 'last' or 'channel:user'"
							className="input input-sm input-bordered w-full font-mono text-xs"
							value={job.target}
							onChange={e => onChange({ ...job, target: e.target.value })}
						/>
					</div>
					{job.lastRun && (
						<div className="text-[10px] text-base-content/40 uppercase tracking-widest mt-2 flex items-center gap-1">
							<Info size={10} /> Last run: {new Date(job.lastRun).toLocaleString()}
						</div>
					)}
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

	useEffect(() => {
		fetch('/api/crons')
			.then(r => r.json())
			.then(d => {
				setCrons(d.crons || [])
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
			createdAt: new Date().toISOString()
		}
		setCrons([newCron, ...crons])
	}

	const updateCron = (id: string, update: CronJob) => {
		setCrons(crons.map(c => c.id === id ? update : c))
	}

	const removeCron = (id: string) => {
		setCrons(crons.filter(c => c.id !== id))
	}

	return (
		<>
		<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
			<div className="flex justify-between items-start">
				<div>
					<h1 className="text-3xl font-black text-primary uppercase tracking-tighter flex items-center gap-3">
						<Clock size={32} /> AUTOMATED TASKS
					</h1>
					<p className="text-base-content/50 text-sm mt-1">Configure background background AI agent triggers.</p>
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
								onChange={(u) => updateCron(c.id, u)}
								onRemove={(id) => removeCron(id)}
								onTest={(job) => setTestJob(job)}
							/>
						))}
					</div>
				)}
			</section>
		</div>
		{testJob && <CronTestModal job={testJob} onClose={() => setTestJob(null)} />}
		</>
	)
}
