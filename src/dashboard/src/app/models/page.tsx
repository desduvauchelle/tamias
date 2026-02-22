'use client'

import { useState, useEffect } from 'react'

type ProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'antigravity' | 'ollama'

export type ConnectionConfig = {
	nickname: string
	provider: ProviderType
	envKeyName?: string
	apiKey?: string // from API hydration
	selectedModels?: string[]
}

const PROVIDER_META: Record<ProviderType, { label: string; icon: string }> = {
	antigravity: { label: 'Antigravity (OAuth)', icon: '🛸' },
	google: { label: 'Google (Gemini)', icon: '🤖' },
	openai: { label: 'OpenAI', icon: '🧠' },
	anthropic: { label: 'Anthropic', icon: '💡' },
	openrouter: { label: 'OpenRouter', icon: '🔀' },
	ollama: { label: 'Ollama', icon: '🦙' },
}

function ConnectionCard({
	config,
	onChange,
	onRemove
}: {
	config: ConnectionConfig
	onChange: (c: ConnectionConfig) => void
	onRemove: (nickname: string) => void
}) {
	const meta = PROVIDER_META[config.provider] || { label: config.provider, icon: '⚙️' }

	return (
		<div className="card bg-base-200 border border-base-300 transition-all group relative">
			<button
				onClick={() => onRemove(config.nickname)}
				className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2 opacity-30 group-hover:opacity-100 transition-opacity text-error"
				title="Remove connection"
			>✕</button>
			<div className="card-body p-4 space-y-4">
				<div className="flex items-center gap-4">
					<span className="text-4xl w-12 text-center shrink-0 mt-2">{meta.icon}</span>
					<div className="flex-1 space-y-1">
						<div className="flex items-center gap-2">
							<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">Provider</span>
							<div className="font-semibold">{meta.label}</div>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 mt-1">Nickname</span>
							<input
								type="text"
								placeholder="e.g. My OpenAI"
								className="input input-sm input-ghost w-full font-mono font-bold text-base-content"
								value={config.nickname}
								disabled
								title="To rename, create a new connection and copy keys"
							/>
						</div>
					</div>
				</div>

				<div className="divider m-0 opacity-20">Settings</div>

				<div className="flex-1 space-y-3">
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">API Key</span>
						<div className="flex-1 w-full">
							{config.provider === 'antigravity' ? (
								<div className="text-xs font-mono text-success">OAuth via CLI</div>
							) : config.provider === 'ollama' ? (
								<div className="text-xs font-mono text-base-content/50">Local (No API Key)</div>
							) : (
								<input
									type="password"
									placeholder="sk-..."
									className="input input-sm input-bordered w-full font-mono text-xs"
									value={config.apiKey}
									onChange={e => onChange({ ...config, apiKey: e.target.value })}
								/>
							)}
						</div>
					</div>
					<div className="flex items-start gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 mt-2">Models</span>
						<div className="flex-1">
							<textarea
								className="textarea textarea-bordered textarea-sm w-full font-mono"
								placeholder="gpt-4o, gpt-4o-mini"
								value={config.selectedModels?.join(', ') || ''}
								onChange={e => onChange({ ...config, selectedModels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
								rows={2}
							/>
							<p className="text-[10px] text-base-content/40 mt-1">Comma-separated model IDs</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

export default function ModelsPage() {
	const [connections, setConnections] = useState<ConnectionConfig[]>([])
	const [defaultModels, setDefaultModels] = useState<string[]>([])
	const [defaultConnection, setDefaultConnection] = useState<string>('')
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		fetch('/api/models')
			.then(r => r.json())
			.then(d => {
				setConnections(d.connections || [])
				setDefaultModels(d.defaultModels || [])
				setDefaultConnection(d.defaultConnection || '')
			})
	}, [])

	const save = async () => {
		setSaving(true)
		await fetch('/api/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ connections, defaultModels, defaultConnection }),
		})
		setSaving(false)
		setSaved(true)
		setTimeout(() => setSaved(false), 2000)
	}

	const addConnection = (provider: ProviderType) => {
		const newConn: ConnectionConfig = {
			nickname: `${provider}-${Date.now().toString().slice(-4)}`,
			provider,
			apiKey: '',
			selectedModels: []
		}
		setConnections([...connections, newConn])
	}

	const updateConnection = (nickname: string, update: ConnectionConfig) => {
		setConnections(connections.map(c => c.nickname === nickname ? update : c))
	}

	const removeConnection = (nickname: string) => {
		setConnections(connections.filter(c => c.nickname !== nickname))
	}

	const allModelOptions = connections.flatMap(c =>
		(c.selectedModels || []).map(m => `${c.nickname}/${m}`)
	)

	return (
		<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
			<div className="flex justify-between items-start">
				<div>
					<h1 className="text-3xl font-black text-primary uppercase tracking-tighter">AI CONNECTIONS</h1>
					<p className="text-base-content/50 text-sm mt-1">Configure your API keys and select available models.</p>
				</div>
				<button
					onClick={save}
					disabled={saving}
					className="btn btn-primary btn-md shadow-lg m-1 px-8 rounded-full"
				>
					{saving ? <span className="loading loading-spinner loading-sm" /> : null}
					{saving ? 'Saving...' : saved ? '✓ Changes Saved' : 'Save Changes'}
				</button>
			</div>

			<section className="space-y-6">
				<div className="p-6 bg-base-200 border border-base-300 rounded-2xl flex flex-col md:flex-row items-center gap-6 justify-between">
					<div>
						<h2 className="text-lg font-black uppercase">Default Routing (Priority Order)</h2>
						<p className="text-xs opacity-60">The primary model and its fallbacks in order of preference.</p>
					</div>
					<div className="flex flex-col gap-2 w-full md:w-80">
						{defaultModels.map((m, i) => (
							<div key={i} className="flex items-center gap-2">
								<span className="text-xs font-bold opacity-30 w-4">{i + 1}.</span>
								<select
									className="select select-bordered select-sm font-mono flex-1"
									value={m}
									onChange={e => {
										const newModels = [...defaultModels]
										newModels[i] = e.target.value
										setDefaultModels(newModels)
									}}
								>
									{allModelOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
								</select>
								<button
									onClick={() => setDefaultModels(defaultModels.filter((_, idx) => idx !== i))}
									className="btn btn-ghost btn-xs text-error"
								>✕</button>
							</div>
						))}
						<button
							className="btn btn-ghost btn-xs btn-outline border-dashed uppercase text-[10px]"
							onClick={() => {
								const unused = allModelOptions.find(o => !defaultModels.includes(o)) || allModelOptions[0]
								if (unused) setDefaultModels([...defaultModels, unused])
							}}
						>+ Add Fallback Model</button>
					</div>
				</div>

				<div className="border-b-2 border-primary/20 pb-4 flex justify-between items-end">
					<div>
						<h2 className="text-2xl font-black flex items-center gap-3 uppercase">
							Connections
						</h2>
					</div>
					<div className="dropdown dropdown-end">
						<label tabIndex={0} className="btn btn-sm btn-primary">+ Register Connection</label>
						<ul tabIndex={0} className="dropdown-content menu bg-base-200 border border-base-300 rounded-box z-[1] w-64 p-2 shadow-2xl mt-1">
							<li className="menu-title opacity-50 text-[10px] uppercase font-black">Select Provider Type</li>
							{(Object.keys(PROVIDER_META) as ProviderType[]).map(p => (
								<li key={p}>
									<button onClick={() => addConnection(p)} className="text-sm py-3">
										<span className="w-8 text-center text-xl">{PROVIDER_META[p].icon}</span> {PROVIDER_META[p].label}
									</button>
								</li>
							))}
						</ul>
					</div>
				</div>

				{connections.length === 0 ? (
					<div className="text-sm text-base-content/30 italic p-12 border-2 border-dashed rounded-2xl border-base-300 text-center bg-base-200/50">
						Welcome! Start by connecting an AI provider above.
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{connections.map(c => (
							<ConnectionCard
								key={c.nickname}
								config={c}
								onChange={(update) => updateConnection(c.nickname, update)}
								onRemove={(nick) => removeConnection(nick)}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	)
}
