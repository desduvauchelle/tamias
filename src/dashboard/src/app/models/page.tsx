'use client'

import { useState, useEffect, useRef } from 'react'

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

// Known model lists for non-OpenRouter providers
const KNOWN_MODELS: Partial<Record<ProviderType, string[]>> = {
	openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
	anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4', 'claude-sonnet-4'],
	google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
}

function ModelPicker({
	provider,
	apiKey,
	selected,
	onChange,
}: {
	provider: ProviderType
	apiKey?: string
	selected: string[]
	onChange: (models: string[]) => void
}) {
	const [orModels, setOrModels] = useState<{ id: string; name: string }[]>([])
	const [orLoading, setOrLoading] = useState(false)
	const [orError, setOrError] = useState('')
	const [manualMode, setManualMode] = useState(false)
	const [search, setSearch] = useState('')

	// Load OpenRouter models when provider is openrouter and we have a key
	useEffect(() => {
		if (provider !== 'openrouter') return
		setOrLoading(true)
		setOrError('')
		const headers: Record<string, string> = { 'Content-Type': 'application/json' }
		if (apiKey && apiKey !== '[REDACTED]') headers['Authorization'] = `Bearer ${apiKey}`
		fetch('https://openrouter.ai/api/v1/models', { headers })
			.then(r => r.json())
			.then(d => {
				const list = (d.data || []) as { id: string; name: string }[]
				setOrModels(list.sort((a, b) => a.id.localeCompare(b.id)))
			})
			.catch(() => setOrError('Failed to load models from OpenRouter'))
			.finally(() => setOrLoading(false))
	}, [provider, apiKey])

	const toggle = (id: string) => {
		if (selected.includes(id)) onChange(selected.filter(m => m !== id))
		else onChange([...selected, id])
	}

	// Manual textarea fallback
	if (manualMode || (provider !== 'openrouter' && !KNOWN_MODELS[provider])) {
		return (
			<div className="space-y-2">
				<textarea
					className="textarea textarea-bordered textarea-sm w-full font-mono text-xs"
					placeholder="gpt-4o, gpt-4o-mini"
					value={selected.join(', ')}
					onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
					rows={3}
				/>
				<div className="flex items-center justify-between">
					<p className="text-[10px] text-base-content/40">Comma-separated model IDs</p>
					{(provider === 'openrouter' || KNOWN_MODELS[provider]) && (
						<button className="text-[10px] text-primary underline" onClick={() => setManualMode(false)}>
							Switch to picker
						</button>
					)}
				</div>
			</div>
		)
	}

	// OpenRouter — searchable checkbox list
	if (provider === 'openrouter') {
		const filtered = orModels.filter(m =>
			!search || m.id.toLowerCase().includes(search.toLowerCase()) || m.name.toLowerCase().includes(search.toLowerCase())
		)
		return (
			<div className="space-y-2">
				{selected.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{selected.map(m => (
							<span key={m} className="badge badge-primary badge-sm font-mono gap-1 cursor-pointer" onClick={() => toggle(m)}>
								{m} ✕
							</span>
						))}
					</div>
				)}
				<input
					type="text"
					className="input input-sm input-bordered w-full font-mono text-xs"
					placeholder="Search models…"
					value={search}
					onChange={e => setSearch(e.target.value)}
				/>
				{orLoading && <div className="text-xs text-base-content/40 flex items-center gap-2"><span className="loading loading-spinner loading-xs" />Loading models…</div>}
				{orError && <div className="text-xs text-error">{orError}</div>}
				{!orLoading && (
					<div className="max-h-48 overflow-y-auto border border-base-300 rounded-lg divide-y divide-base-300">
						{filtered.slice(0, 150).map(m => (
							<label key={m.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-300 cursor-pointer">
								<input
									type="checkbox"
									className="checkbox checkbox-xs checkbox-primary"
									checked={selected.includes(m.id)}
									onChange={() => toggle(m.id)}
								/>
								<span className="font-mono text-xs flex-1 truncate">{m.id}</span>
							</label>
						))}
						{filtered.length === 0 && !orLoading && (
							<div className="text-xs text-base-content/40 p-3">No models match</div>
						)}
					</div>
				)}
				<button className="text-[10px] text-primary underline" onClick={() => setManualMode(true)}>
					Enter manually instead
				</button>
			</div>
		)
	}

	// Static known model list (openai, anthropic, google)
	const knownList = KNOWN_MODELS[provider] || []
	return (
		<div className="space-y-2">
			{selected.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{selected.map(m => (
						<span key={m} className="badge badge-primary badge-sm font-mono gap-1 cursor-pointer" onClick={() => toggle(m)}>
							{m} ✕
						</span>
					))}
				</div>
			)}
			<div className="border border-base-300 rounded-lg divide-y divide-base-300">
				{knownList.map(m => (
					<label key={m} className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-300 cursor-pointer">
						<input
							type="checkbox"
							className="checkbox checkbox-xs checkbox-primary"
							checked={selected.includes(m)}
							onChange={() => toggle(m)}
						/>
						<span className="font-mono text-xs">{m}</span>
					</label>
				))}
			</div>
			<button className="text-[10px] text-primary underline" onClick={() => setManualMode(true)}>
				Enter manually instead
			</button>
		</div>
	)
}

function EditConnectionModal({
	config,
	onSave,
	onDelete,
	onClose,
}: {
	config: ConnectionConfig
	onSave: (original: string, updated: ConnectionConfig) => void
	onDelete: (nickname: string) => void
	onClose: () => void
}) {
	const [draft, setDraft] = useState<ConnectionConfig>({ ...config })
	const originalNickname = useRef(config.nickname)
	const meta = PROVIDER_META[draft.provider] || { label: draft.provider, icon: '⚙️' }
	const dialogRef = useRef<HTMLDialogElement>(null)

	useEffect(() => {
		dialogRef.current?.showModal()
	}, [])

	return (
		<dialog ref={dialogRef} className="modal modal-bottom sm:modal-middle" onClose={onClose}>
			<div className="modal-box max-w-lg font-mono">
				<h3 className="font-black text-lg uppercase flex items-center gap-2 mb-4">
					<span>{meta.icon}</span> Edit Connection
				</h3>

				<div className="space-y-4">
					{/* Nickname */}
					<label className="form-control w-full">
						<div className="label pb-0"><span className="label-text text-xs font-bold uppercase tracking-wider">Nickname</span></div>
						<input
							type="text"
							className="input input-bordered input-sm font-mono w-full"
							value={draft.nickname}
							onChange={e => setDraft({ ...draft, nickname: e.target.value.replace(/\s/g, '-') })}
						/>
					</label>

					{/* Provider (read-only) */}
					<label className="form-control w-full">
						<div className="label pb-0"><span className="label-text text-xs font-bold uppercase tracking-wider">Provider</span></div>
						<div className="input input-bordered input-sm flex items-center gap-2 bg-base-200 text-base-content/50 cursor-not-allowed">
							<span>{meta.icon}</span> {meta.label}
						</div>
					</label>

					{/* API Key */}
					{draft.provider !== 'antigravity' && draft.provider !== 'ollama' && (
						<label className="form-control w-full">
							<div className="label pb-0"><span className="label-text text-xs font-bold uppercase tracking-wider">API Key</span></div>
							<input
								type="password"
								placeholder={draft.apiKey === '[REDACTED]' ? '(saved — paste to replace)' : 'sk-…'}
								className="input input-bordered input-sm font-mono text-xs w-full"
								value={draft.apiKey === '[REDACTED]' ? '' : (draft.apiKey || '')}
								onChange={e => setDraft({ ...draft, apiKey: e.target.value })}
							/>
							{draft.apiKey === '[REDACTED]' && (
								<div className="label pt-0"><span className="label-text-alt text-success">Key is saved — leave blank to keep it</span></div>
							)}
						</label>
					)}
					{draft.provider === 'antigravity' && (
						<div className="text-xs text-success">OAuth via CLI — no key needed</div>
					)}
					{draft.provider === 'ollama' && (
						<div className="text-xs text-base-content/50">Local Ollama — no API key needed</div>
					)}

					{/* Models */}
					<div className="form-control w-full">
						<div className="label pb-1"><span className="label-text text-xs font-bold uppercase tracking-wider">Models</span></div>
						<ModelPicker
							provider={draft.provider}
							apiKey={draft.apiKey}
							selected={draft.selectedModels || []}
							onChange={models => setDraft({ ...draft, selectedModels: models })}
						/>
					</div>
				</div>

				<div className="modal-action mt-6 flex justify-between">
					<button
						className="btn btn-error btn-sm btn-outline"
						onClick={() => { onDelete(originalNickname.current); onClose() }}
					>
						Delete
					</button>
					<div className="flex gap-2">
						<button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
						<button
							className="btn btn-primary btn-sm"
							onClick={() => { onSave(originalNickname.current, draft); onClose() }}
						>
							Save
						</button>
					</div>
				</div>
			</div>
			<form method="dialog" className="modal-backdrop"><button>close</button></form>
		</dialog>
	)
}

function ConnectionRow({
	config,
	onEdit,
}: {
	config: ConnectionConfig
	onEdit: () => void
}) {
	const meta = PROVIDER_META[config.provider] || { label: config.provider, icon: '⚙️' }
	const hasKey = config.apiKey === '[REDACTED]' || (!!config.apiKey && config.apiKey !== '')
	return (
		<div
			className="flex items-center gap-4 p-4 bg-base-200 border border-base-300 rounded-xl hover:bg-base-300 cursor-pointer transition-colors group"
			onClick={onEdit}
		>
			<span className="text-3xl w-10 text-center shrink-0">{meta.icon}</span>
			<div className="flex-1 min-w-0">
				<div className="font-bold font-mono">{config.nickname}</div>
				<div className="text-xs text-base-content/50">{meta.label}</div>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				{config.selectedModels && config.selectedModels.length > 0 ? (
					<span className="badge badge-ghost badge-sm font-mono">{config.selectedModels.length} model{config.selectedModels.length !== 1 ? 's' : ''}</span>
				) : (
					<span className="badge badge-warning badge-sm badge-outline">no models</span>
				)}
				{hasKey ? (
					<span className="badge badge-success badge-sm badge-outline">key saved</span>
				) : config.provider === 'ollama' || config.provider === 'antigravity' ? null : (
					<span className="badge badge-error badge-sm badge-outline">no key</span>
				)}
				<span className="text-base-content/30 group-hover:text-base-content/70 transition-colors">✎</span>
			</div>
		</div>
	)
}

export default function ModelsPage() {
	const [connections, setConnections] = useState<ConnectionConfig[]>([])
	const [defaultModels, setDefaultModels] = useState<string[]>([])
	const [smartModels, setSmartModels] = useState<string[]>([])
	const [defaultConnection, setDefaultConnection] = useState<string>('')
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)
	const [editingNickname, setEditingNickname] = useState<string | null>(null)

	useEffect(() => {
		fetch('/api/models')
			.then(r => r.json())
			.then(d => {
				setConnections(d.connections || [])
				setDefaultModels(d.defaultModels || [])
				setSmartModels(d.smartModels || [])
				setDefaultConnection(d.defaultConnection || '')
			})
	}, [])

	const save = async () => {
		setSaving(true)
		await fetch('/api/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ connections, defaultModels, smartModels, defaultConnection }),
		})
		setSaving(false)
		setSaved(true)
		setTimeout(() => setSaved(false), 2000)
	}

	const addConnection = (provider: ProviderType) => {
		const nickname = `${provider}-${Date.now().toString().slice(-4)}`
		const newConn: ConnectionConfig = {
			nickname,
			provider,
			apiKey: '',
			selectedModels: []
		}
		setConnections([...connections, newConn])
		setEditingNickname(nickname)
	}

	const updateConnection = (originalNickname: string, updated: ConnectionConfig) => {
		setConnections(connections.map(c => c.nickname === originalNickname ? updated : c))
	}

	const removeConnection = (nickname: string) => {
		setConnections(connections.filter(c => c.nickname !== nickname))
	}

	const allModelOptions = connections.flatMap(c =>
		(c.selectedModels || []).map(m => `${c.nickname}/${m}`)
	)

	const editingConfig = editingNickname !== null
		? connections.find(c => c.nickname === editingNickname) ?? null
		: null

	return (
		<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
			{editingConfig && (
				<EditConnectionModal
					config={editingConfig}
					onSave={(orig, updated) => updateConnection(orig, updated)}
					onDelete={(nick) => removeConnection(nick)}
					onClose={() => setEditingNickname(null)}
				/>
			)}

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
				<div className="p-6 bg-base-200 border border-base-300 rounded-2xl space-y-6">
					{/* Normal Models */}
					<div className="flex flex-col md:flex-row items-start gap-6 justify-between">
						<div>
							<h2 className="text-lg font-black uppercase flex items-center gap-2">💬 Normal Models</h2>
							<p className="text-xs opacity-60">For everyday tasks — chat, summaries, quick answers. Priority order with fallbacks.</p>
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

					<div className="divider my-0" />

					{/* Smart Models */}
					<div className="flex flex-col md:flex-row items-start gap-6 justify-between">
						<div>
							<h2 className="text-lg font-black uppercase flex items-center gap-2">🧠 Smart Models</h2>
							<p className="text-xs opacity-60">For complex tasks — coding, deep analysis, prolonged thinking. Falls back to normal models if empty.</p>
						</div>
						<div className="flex flex-col gap-2 w-full md:w-80">
							{smartModels.map((m, i) => (
								<div key={i} className="flex items-center gap-2">
									<span className="text-xs font-bold opacity-30 w-4">{i + 1}.</span>
									<select
										className="select select-bordered select-sm font-mono flex-1"
										value={m}
										onChange={e => {
											const newModels = [...smartModels]
											newModels[i] = e.target.value
											setSmartModels(newModels)
										}}
									>
										{allModelOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
									</select>
									<button
										onClick={() => setSmartModels(smartModels.filter((_, idx) => idx !== i))}
										className="btn btn-ghost btn-xs text-error"
									>✕</button>
								</div>
							))}
							<button
								className="btn btn-ghost btn-xs btn-outline border-dashed uppercase text-[10px]"
								onClick={() => {
									const unused = allModelOptions.find(o => !smartModels.includes(o)) || allModelOptions[0]
									if (unused) setSmartModels([...smartModels, unused])
								}}
							>+ Add Smart Model</button>
						</div>
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
					<div className="flex flex-col gap-3">
						{connections.map(c => (
							<ConnectionRow
								key={c.nickname}
								config={c}
								onEdit={() => setEditingNickname(c.nickname)}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	)
}
