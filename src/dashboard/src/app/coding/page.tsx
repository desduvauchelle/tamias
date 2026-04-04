'use client'

import { useState, useEffect } from 'react'
import { Code, Plus, Trash2, ChevronUp, ChevronDown, TestTube, Loader2 } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CodingProvider {
	name: string
	enabled: boolean
	priority: number
	command: string
	smartModel?: string
	normalModel?: string
	autoAcceptFlag?: string
	outputFlag?: string
	additionalFlags?: string
	timeout: number
	maxRetries: number
	complexityThreshold: number
}

interface Preset {
	name: string
	displayName: string
	command: string
	smartModel: string
	normalModel: string
	autoAcceptFlag: string
	outputFlag: string
	timeout: number
}

const PRESETS: Preset[] = [
	{
		name: 'claude-code',
		displayName: 'Claude Code',
		command: 'claude',
		smartModel: 'opus',
		normalModel: 'sonnet',
		autoAcceptFlag: '--permission-mode bypassPermissions',
		outputFlag: '--output-format stream-json -p',
		timeout: 600,
	},
	{
		name: 'copilot-cli',
		displayName: 'GitHub Copilot CLI',
		command: 'gh copilot',
		smartModel: '',
		normalModel: '',
		autoAcceptFlag: '',
		outputFlag: '',
		timeout: 300,
	},
	{
		name: 'aider',
		displayName: 'Aider',
		command: 'aider',
		smartModel: 'opus',
		normalModel: 'sonnet',
		autoAcceptFlag: '--yes --no-auto-commits',
		outputFlag: '',
		timeout: 600,
	},
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function CodingPage() {
	const [providers, setProviders] = useState<CodingProvider[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [editIndex, setEditIndex] = useState<number | null>(null)
	const [testResults, setTestResults] = useState<Record<string, 'loading' | 'ok' | 'fail'>>({})
	const [dirty, setDirty] = useState(false)

	useEffect(() => {
		fetch('/api/coding-providers')
			.then(r => r.json())
			.then(d => setProviders(d.codingProviders || []))
			.catch(console.error)
			.finally(() => setLoading(false))
	}, [])

	const save = async (updated: CodingProvider[]) => {
		setSaving(true)
		try {
			await fetch('/api/coding-providers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ codingProviders: updated }),
			})
			setDirty(false)
		} catch (err) {
			console.error('Failed to save:', err)
		} finally {
			setSaving(false)
		}
	}

	const addFromPreset = (preset: Preset) => {
		const newProvider: CodingProvider = {
			name: preset.name,
			enabled: true,
			priority: providers.length,
			command: preset.command,
			smartModel: preset.smartModel,
			normalModel: preset.normalModel,
			autoAcceptFlag: preset.autoAcceptFlag,
			outputFlag: preset.outputFlag,
			additionalFlags: '',
			timeout: preset.timeout,
			maxRetries: 1,
			complexityThreshold: 50,
		}
		const updated = [...providers, newProvider]
		setProviders(updated)
		setEditIndex(updated.length - 1)
		setDirty(true)
	}

	const addCustom = () => {
		const newProvider: CodingProvider = {
			name: 'custom',
			enabled: true,
			priority: providers.length,
			command: '',
			smartModel: '',
			normalModel: '',
			autoAcceptFlag: '',
			outputFlag: '',
			additionalFlags: '',
			timeout: 300,
			maxRetries: 1,
			complexityThreshold: 50,
		}
		const updated = [...providers, newProvider]
		setProviders(updated)
		setEditIndex(updated.length - 1)
		setDirty(true)
	}

	const removeProvider = (idx: number) => {
		const updated = providers.filter((_, i) => i !== idx)
		// Re-index priorities
		updated.forEach((p, i) => p.priority = i)
		setProviders(updated)
		setEditIndex(null)
		setDirty(true)
	}

	const moveProvider = (idx: number, direction: 'up' | 'down') => {
		const newIdx = direction === 'up' ? idx - 1 : idx + 1
		if (newIdx < 0 || newIdx >= providers.length) return
		const updated = [...providers]
		const [moved] = updated.splice(idx, 1)
		updated.splice(newIdx, 0, moved)
		updated.forEach((p, i) => p.priority = i)
		setProviders(updated)
		if (editIndex === idx) setEditIndex(newIdx)
		setDirty(true)
	}

	const updateProvider = (idx: number, field: keyof CodingProvider, value: string | number | boolean) => {
		const updated = [...providers]
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		;(updated[idx] as any)[field] = value
		setProviders(updated)
		setDirty(true)
	}

	const testProvider = async (provider: CodingProvider) => {
		setTestResults(prev => ({ ...prev, [provider.name]: 'loading' }))
		try {
			const baseCmd = provider.command.split(/\s+/)[0]
			const res = await fetch('/api/coding-providers/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ command: baseCmd }),
			})
			const data = await res.json()
			setTestResults(prev => ({ ...prev, [provider.name]: data.available ? 'ok' : 'fail' }))
		} catch {
			setTestResults(prev => ({ ...prev, [provider.name]: 'fail' }))
		}
	}

	const unusedPresets = PRESETS.filter(pr => !providers.some(p => p.name === pr.name))

	if (loading) {
		return (
			<div className="p-8 flex items-center gap-2">
				<Loader2 className="w-4 h-4 animate-spin" />
				<span className="opacity-60">Loading coding providers…</span>
			</div>
		)
	}

	return (
		<div className="p-6 max-w-4xl mx-auto space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold flex items-center gap-3">
						<Code className="w-6 h-6" />
						Coding Providers
					</h1>
					<p className="mt-1 text-sm opacity-60">
						Configure external coding CLIs for task delegation. Tamias will try them in order and auto-select smart/normal models based on task complexity.
					</p>
				</div>
				{dirty && (
					<button
						className={`btn btn-primary btn-sm ${saving ? 'loading' : ''}`}
						onClick={() => save(providers)}
						disabled={saving}
					>
						{saving ? 'Saving…' : 'Save Changes'}
					</button>
				)}
			</div>

			{/* Provider list */}
			{providers.length === 0 ? (
				<div className="card bg-base-200 p-8 text-center">
					<p className="text-lg opacity-60 mb-4">No coding providers configured</p>
					<p className="text-sm opacity-40 mb-6">
						Add a coding CLI like Claude Code, GitHub Copilot, or Aider to enable AI-powered coding task delegation.
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{providers.map((provider, idx) => (
						<div key={`${provider.name}-${idx}`} className="card bg-base-200 shadow-sm">
							{/* Provider header row */}
							<div className="card-body p-4">
								<div className="flex items-center gap-3">
									{/* Priority arrows */}
									<div className="flex flex-col gap-0.5">
										<button
											className="btn btn-ghost btn-xs p-0"
											onClick={() => moveProvider(idx, 'up')}
											disabled={idx === 0}
										>
											<ChevronUp className="w-3 h-3" />
										</button>
										<button
											className="btn btn-ghost btn-xs p-0"
											onClick={() => moveProvider(idx, 'down')}
											disabled={idx === providers.length - 1}
										>
											<ChevronDown className="w-3 h-3" />
										</button>
									</div>

									{/* Priority number */}
									<span className="badge badge-sm badge-outline font-mono w-6 h-6 flex items-center justify-center">
										{idx + 1}
									</span>

									{/* Provider info */}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-bold text-sm">{provider.name}</span>
											<code className="text-xs opacity-50">{provider.command}</code>
											{testResults[provider.name] === 'ok' && (
												<span className="badge badge-success badge-xs">Installed</span>
											)}
											{testResults[provider.name] === 'fail' && (
												<span className="badge badge-error badge-xs">Not found</span>
											)}
											{testResults[provider.name] === 'loading' && (
												<Loader2 className="w-3 h-3 animate-spin opacity-40" />
											)}
										</div>
										<div className="flex gap-3 mt-1 text-xs opacity-50">
											{provider.smartModel && <span>Smart: <code>{provider.smartModel}</code></span>}
											{provider.normalModel && <span>Normal: <code>{provider.normalModel}</code></span>}
											<span>Timeout: {provider.timeout}s</span>
											<span>Threshold: {provider.complexityThreshold}</span>
										</div>
									</div>

									{/* Actions */}
									<div className="flex items-center gap-1">
										<input
											type="checkbox"
											className="toggle toggle-sm toggle-success"
											checked={provider.enabled}
											onChange={e => updateProvider(idx, 'enabled', e.target.checked)}
										/>
										<button
											className="btn btn-ghost btn-xs"
											onClick={() => testProvider(provider)}
											title="Test CLI availability"
										>
											<TestTube className="w-3.5 h-3.5" />
										</button>
										<button
											className="btn btn-ghost btn-xs"
											onClick={() => setEditIndex(editIndex === idx ? null : idx)}
										>
											{editIndex === idx ? 'Close' : 'Edit'}
										</button>
										<button
											className="btn btn-ghost btn-xs text-error"
											onClick={() => removeProvider(idx)}
										>
											<Trash2 className="w-3.5 h-3.5" />
										</button>
									</div>
								</div>

								{/* Expanded edit form */}
								{editIndex === idx && (
									<div className="mt-4 pt-4 border-t border-base-300 grid grid-cols-2 gap-4">
										<div className="form-control">
											<label className="label"><span className="label-text text-xs">Name</span></label>
											<input
												className="input input-bordered input-sm"
												value={provider.name}
												onChange={e => updateProvider(idx, 'name', e.target.value)}
											/>
										</div>
										<div className="form-control">
											<label className="label"><span className="label-text text-xs">Command</span></label>
											<input
												className="input input-bordered input-sm"
												value={provider.command}
												onChange={e => updateProvider(idx, 'command', e.target.value)}
												placeholder="e.g., claude"
											/>
										</div>
										<div className="form-control">
											<label className="label"><span className="label-text text-xs">Smart Model</span></label>
											<input
												className="input input-bordered input-sm"
												value={provider.smartModel || ''}
												onChange={e => updateProvider(idx, 'smartModel', e.target.value)}
												placeholder="e.g., opus"
											/>
										</div>
										<div className="form-control">
											<label className="label"><span className="label-text text-xs">Normal Model</span></label>
											<input
												className="input input-bordered input-sm"
												value={provider.normalModel || ''}
												onChange={e => updateProvider(idx, 'normalModel', e.target.value)}
												placeholder="e.g., sonnet"
											/>
										</div>
										<div className="form-control col-span-2">
											<label className="label"><span className="label-text text-xs">Auto-Accept Flag</span></label>
											<input
												className="input input-bordered input-sm"
												value={provider.autoAcceptFlag || ''}
												onChange={e => updateProvider(idx, 'autoAcceptFlag', e.target.value)}
												placeholder="e.g., --permission-mode bypassPermissions"
											/>
										</div>
										<div className="form-control col-span-2">
											<label className="label"><span className="label-text text-xs">Output Flag</span></label>
											<input
												className="input input-bordered input-sm"
												value={provider.outputFlag || ''}
												onChange={e => updateProvider(idx, 'outputFlag', e.target.value)}
												placeholder="e.g., --output-format stream-json -p"
											/>
										</div>
										<div className="form-control col-span-2">
											<label className="label"><span className="label-text text-xs">Additional Flags</span></label>
											<input
												className="input input-bordered input-sm"
												value={provider.additionalFlags || ''}
												onChange={e => updateProvider(idx, 'additionalFlags', e.target.value)}
												placeholder="Any extra CLI arguments"
											/>
										</div>
										<div className="form-control">
											<label className="label"><span className="label-text text-xs">Timeout (seconds)</span></label>
											<input
												type="number"
												className="input input-bordered input-sm"
												value={provider.timeout}
												onChange={e => updateProvider(idx, 'timeout', parseInt(e.target.value) || 300)}
												min={10}
												max={3600}
											/>
										</div>
										<div className="form-control">
											<label className="label"><span className="label-text text-xs">Max Retries</span></label>
											<input
												type="number"
												className="input input-bordered input-sm"
												value={provider.maxRetries}
												onChange={e => updateProvider(idx, 'maxRetries', parseInt(e.target.value) || 0)}
												min={0}
												max={5}
											/>
										</div>
										<div className="form-control col-span-2">
											<label className="label">
												<span className="label-text text-xs">
													Complexity Threshold: {provider.complexityThreshold}
												</span>
												<span className="label-text-alt text-xs opacity-40">
													Score {'>'} threshold → smart model
												</span>
											</label>
											<input
												type="range"
												className="range range-sm range-primary"
												value={provider.complexityThreshold}
												onChange={e => updateProvider(idx, 'complexityThreshold', parseInt(e.target.value))}
												min={0}
												max={100}
												step={5}
											/>
											<div className="flex justify-between text-xs opacity-30 px-1 mt-1">
												<span>Always Smart</span>
												<span>Balanced</span>
												<span>Always Normal</span>
											</div>
										</div>
									</div>
								)}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Add provider section */}
			<div className="card bg-base-200 p-4">
				<h3 className="text-sm font-bold mb-3">Add Provider</h3>
				<div className="flex flex-wrap gap-2">
					{unusedPresets.map(preset => (
						<button
							key={preset.name}
							className="btn btn-sm btn-outline"
							onClick={() => addFromPreset(preset)}
						>
							<Plus className="w-3 h-3" />
							{preset.displayName}
						</button>
					))}
					<button
						className="btn btn-sm btn-ghost"
						onClick={addCustom}
					>
						<Plus className="w-3 h-3" />
						Custom CLI
					</button>
				</div>
			</div>

			{/* How it works */}
			<div className="card bg-base-200 p-4">
				<h3 className="text-sm font-bold mb-2">How it works</h3>
				<ul className="text-xs opacity-60 space-y-1.5 list-disc list-inside">
					<li>When Tamias receives a coding task, it estimates complexity and selects <strong>smart</strong> (complex) or <strong>normal</strong> (simple) model tier.</li>
					<li>Providers are tried in priority order (top = first). If one fails or is rate-limited, the next is tried.</li>
					<li>CLIs run with auto-accept flags so they can edit files without manual confirmation.</li>
					<li>If all providers fail, Tamias falls back to handling the task with its built-in terminal tools.</li>
				</ul>
			</div>
		</div>
	)
}
