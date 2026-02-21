'use client'

import { useState, useEffect } from 'react'

export type CronJob = {
	id: string
	name: string
	schedule: string
	prompt: string
	target: string
	enabled: boolean
	lastRun?: string
	createdAt: string
}

function CronCard({
	job,
	onChange,
	onRemove
}: {
	job: CronJob
	onChange: (c: CronJob) => void
	onRemove: (id: string) => void
}) {
	return (
		<div className={`card bg-base-200 border ${job.enabled ? 'border-primary' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all group relative`}>
			<button
				onClick={() => onRemove(job.id)}
				className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2 opacity-30 group-hover:opacity-100 transition-opacity text-error"
				title="Remove cron job"
			>✕</button>
			<div className="card-body p-4 space-y-4">
				<div className="flex items-start justify-between gap-4">
					<div className="flex-1 space-y-2">
						<input
							type="text"
							placeholder="Job Name"
							className="input input-sm input-ghost w-full font-bold text-base-content text-lg uppercase px-0 h-auto min-h-0"
							value={job.name}
							onChange={e => onChange({ ...job, name: e.target.value })}
						/>
						<div className="text-xs text-base-content/50 font-mono">ID: {job.id.slice(0, 8)}</div>
					</div>
					<input
						type="checkbox"
						className="toggle toggle-primary shrink-0 mt-1"
						checked={job.enabled}
						onChange={e => onChange({ ...job, enabled: e.target.checked })}
					/>
				</div>

				<div className="divider m-0 opacity-20">Configuration</div>

				<div className="flex-1 space-y-3">
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">Schedule</span>
						<input
							type="text"
							placeholder="e.g. 30m, 1h, or cron expression"
							className="input input-sm input-bordered w-full font-mono text-xs"
							value={job.schedule}
							onChange={e => onChange({ ...job, schedule: e.target.value })}
						/>
					</div>
					<div className="flex items-start gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 mt-2">Prompt</span>
						<textarea
							placeholder="Instruction for the AI agent"
							className="textarea textarea-bordered textarea-sm w-full font-mono min-h-[80px]"
							value={job.prompt}
							onChange={e => onChange({ ...job, prompt: e.target.value })}
						/>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">Target</span>
						<input
							type="text"
							placeholder="e.g. 'last' or 'channel:user'"
							className="input input-sm input-bordered w-full font-mono text-xs"
							value={job.target}
							onChange={e => onChange({ ...job, target: e.target.value })}
						/>
					</div>
					{job.lastRun && (
						<div className="text-[10px] text-base-content/40 uppercase tracking-widest mt-2">
							Last run: {new Date(job.lastRun).toLocaleString()}
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
		<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
			<div className="flex justify-between items-start">
				<div>
					<h1 className="text-3xl font-black text-primary uppercase tracking-tighter">AUTOMATED TASKS (CRONS)</h1>
					<p className="text-base-content/50 text-sm mt-1">Configure background background AI agent triggers.</p>
				</div>
				<button
					onClick={save}
					disabled={saving}
					className="btn btn-primary btn-md shadow-lg m-1 px-8 rounded-full"
				>
					{saving ? <span className="loading loading-spinner loading-sm" /> : null}
					{saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
				</button>
			</div>

			<section className="space-y-6">
				<div className="border-b-2 border-primary/20 pb-4 flex justify-between items-end">
					<h2 className="text-2xl font-black flex items-center gap-3 uppercase">
						Active Background Tasks
					</h2>
					<button onClick={addCron} className="btn btn-sm btn-primary">+ Create Cron</button>
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
							/>
						))}
					</div>
				)}
			</section>
		</div>
	)
}
