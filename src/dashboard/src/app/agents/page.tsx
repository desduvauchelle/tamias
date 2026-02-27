'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../_components/ToastProvider'
import { Modal } from '../_components/Modal'
import { Bot, Plus, HelpCircle, Pencil, Trash2, Power, PowerOff } from 'lucide-react'

interface AgentDefinition {
	id: string
	slug: string
	name: string
	model?: string
	modelFallbacks?: string[]
	instructions: string
	enabled: boolean
	channels?: string[]
	extraSkills?: string[]
	allowedTools?: string[]
	allowedMcpServers?: string[]
}

const EMPTY_FORM = {
	name: '',
	slug: '',
	model: '',
	modelFallbacks: '',
	instructions: '',
	channels: '',
	extraSkills: '',
	allowedTools: '',
	allowedMcpServers: '',
}

export default function AgentsPage() {
	const [agents, setAgents] = useState<AgentDefinition[]>([])
	const [loading, setLoading] = useState(true)
	const [selected, setSelected] = useState<AgentDefinition | null>(null)
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null)
	const [form, setForm] = useState(EMPTY_FORM)
	const [saving, setSaving] = useState(false)
	const { success, error } = useToast()

	const fetchAgents = useCallback(async () => {
		try {
			const res = await fetch('/api/agents')
			if (res.ok) {
				const data = await res.json()
				setAgents(data)
			}
		} catch (err) {
			console.error('Failed to fetch agents', err)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchAgents()
	}, [fetchAgents])

	const slugify = (name: string) =>
		name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

	const openCreate = () => {
		setEditingAgent(null)
		setForm(EMPTY_FORM)
		setIsModalOpen(true)
	}

	const openEdit = (agent: AgentDefinition) => {
		setEditingAgent(agent)
		setForm({
			name: agent.name,
			slug: agent.slug,
			model: agent.model || '',
			modelFallbacks: (agent.modelFallbacks || []).join(', '),
			instructions: agent.instructions,
			channels: (agent.channels || []).join(', '),
			extraSkills: (agent.extraSkills || []).join(', '),
			allowedTools: (agent.allowedTools || []).join(', '),
			allowedMcpServers: (agent.allowedMcpServers || []).join(', '),
		})
		setIsModalOpen(true)
	}

	const handleNameChange = (name: string) => {
		setForm(prev => ({
			...prev,
			name,
			// Auto-derive slug only during creation
			...(editingAgent ? {} : { slug: slugify(name) }),
		}))
	}

	const splitCSV = (val: string) =>
		val.split(',').map(s => s.trim()).filter(Boolean)

	const handleSave = async () => {
		if (!form.name.trim() || !form.instructions.trim()) {
			error('Name and Instructions are required')
			return
		}

		setSaving(true)
		try {
			const payload = {
				name: form.name.trim(),
				slug: form.slug.trim() || slugify(form.name),
				model: form.model.trim() || undefined,
				modelFallbacks: splitCSV(form.modelFallbacks),
				instructions: form.instructions.trim(),
				channels: splitCSV(form.channels),
				extraSkills: splitCSV(form.extraSkills),
				allowedTools: splitCSV(form.allowedTools),
				allowedMcpServers: splitCSV(form.allowedMcpServers),
			}

			let res: Response
			if (editingAgent) {
				res = await fetch(`/api/agents/${editingAgent.id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
			} else {
				res = await fetch('/api/agents', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
			}

			if (res.ok) {
				const updated = await res.json()
				success(editingAgent ? 'Agent updated!' : 'Agent created!')
				setIsModalOpen(false)
				await fetchAgents()
				setSelected(updated)
			} else {
				const data = await res.json()
				error(data.error || 'Failed to save agent')
			}
		} catch (err: unknown) {
			error(err instanceof Error ? err.message : 'An error occurred')
		} finally {
			setSaving(false)
		}
	}

	const handleDelete = async (agent: AgentDefinition) => {
		if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return

		try {
			const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' })
			if (res.ok) {
				success('Agent deleted')
				if (selected?.id === agent.id) setSelected(null)
				fetchAgents()
			} else {
				error('Failed to delete agent')
			}
		} catch {
			error('An error occurred')
		}
	}

	const handleToggle = async (agent: AgentDefinition) => {
		try {
			const res = await fetch(`/api/agents/${agent.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !agent.enabled }),
			})
			if (res.ok) {
				success(`Agent ${agent.enabled ? 'disabled' : 'enabled'}`)
				fetchAgents()
				if (selected?.id === agent.id) {
					setSelected({ ...agent, enabled: !agent.enabled })
				}
			}
		} catch {
			error('Failed to toggle agent')
		}
	}

	return (
		<div className="flex h-full gap-6">
			{/* Left Sidebar — Agent List */}
			<div className="w-1/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
				<div className="p-4 border-b border-base-200/50 flex items-center justify-between">
					<h2 className="font-semibold text-lg flex items-center gap-2">
						<Bot className="w-5 h-5 text-primary" />
						Agents
					</h2>
					<button onClick={openCreate} className="btn btn-sm btn-ghost btn-circle" title="New Agent">
						<Plus className="w-5 h-5" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-2 space-y-1">
					{loading ? (
						<div className="p-4 text-center text-base-content/50">Loading agents...</div>
					) : agents.length === 0 ? (
						<div className="p-4 text-center text-base-content/50">No agents yet.</div>
					) : (
						agents.map(agent => (
							<button
								key={agent.id}
								onClick={() => setSelected(agent)}
								className={`w-full text-left p-3 rounded-xl transition-all ${selected?.id === agent.id
									? 'bg-primary/10 text-primary'
									: 'hover:bg-base-200'
									}`}
							>
								<div className="flex items-center justify-between mb-1">
									<span className="font-medium truncate">{agent.name}</span>
									<span className={`w-2 h-2 rounded-full shrink-0 ${agent.enabled ? 'bg-success' : 'bg-base-content/20'}`} />
								</div>
								<div className="flex items-center gap-2">
									<span className="text-xs font-mono text-base-content/40">{agent.slug}</span>
									{agent.model && (
										<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-base-300/70 text-base-content/50 truncate max-w-[120px]">
											{agent.model}
										</span>
									)}
								</div>
							</button>
						))
					)}
				</div>
			</div>

			{/* Right Panel — Detail / Empty State */}
			<div className="w-2/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
				{selected ? (
					<div className="flex flex-col h-full">
						{/* Header */}
						<div className="p-6 border-b border-base-200/50 flex justify-between items-start">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-3 mb-1">
									<h2 className="text-2xl font-bold truncate">{selected.name}</h2>
									<span className={`badge badge-sm ${selected.enabled ? 'badge-success' : 'badge-ghost'}`}>
										{selected.enabled ? 'Enabled' : 'Disabled'}
									</span>
								</div>
								<div className="flex items-center gap-2 flex-wrap mt-1">
									<span className="text-xs font-mono text-base-content/40 bg-base-200 px-2 py-0.5 rounded">{selected.id}</span>
									<span className="text-xs font-mono text-base-content/40">slug: {selected.slug}</span>
								</div>
							</div>
							<div className="flex gap-1 shrink-0">
								<button
									onClick={() => handleToggle(selected)}
									className={`btn btn-sm btn-ghost btn-square ${selected.enabled ? 'text-warning hover:bg-warning/10' : 'text-success hover:bg-success/10'}`}
									title={selected.enabled ? 'Disable' : 'Enable'}
								>
									{selected.enabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
								</button>
								<button
									onClick={() => openEdit(selected)}
									className="btn btn-sm btn-ghost btn-square text-info hover:bg-info/10"
									title="Edit"
								>
									<Pencil className="w-4 h-4" />
								</button>
								<button
									onClick={() => handleDelete(selected)}
									className="btn btn-sm btn-ghost btn-square text-error hover:bg-error/10"
									title="Delete"
								>
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
						</div>

						{/* Body */}
						<div className="flex-1 p-6 overflow-y-auto space-y-6 bg-base-300/20">
							{/* Model */}
							<div>
								<h4 className="text-xs uppercase font-bold text-base-content/50 mb-2 tracking-wider">Model</h4>
								<p className="text-sm font-mono">{selected.model || '(default)'}</p>
								{selected.modelFallbacks && selected.modelFallbacks.length > 0 && (
									<div className="mt-1">
										<span className="text-xs text-base-content/40">Fallbacks: </span>
										<span className="text-xs font-mono text-base-content/60">{selected.modelFallbacks.join(' → ')}</span>
									</div>
								)}
							</div>

							{/* Instructions */}
							<div>
								<h4 className="text-xs uppercase font-bold text-base-content/50 mb-2 tracking-wider">Instructions</h4>
								<pre className="text-sm font-mono whitespace-pre-wrap leading-relaxed text-base-content/80 bg-base-100 p-4 rounded-xl border border-base-200/50 shadow-inner max-h-64 overflow-y-auto">
									{selected.instructions}
								</pre>
							</div>

							{/* Channels */}
							{selected.channels && selected.channels.length > 0 && (
								<div>
									<h4 className="text-xs uppercase font-bold text-base-content/50 mb-2 tracking-wider">Bound Channels</h4>
									<div className="flex flex-wrap gap-1.5">
										{selected.channels.map(ch => (
											<span key={ch} className="text-xs px-2 py-1 rounded-full bg-base-200 text-base-content/60 border border-base-300 font-mono">{ch}</span>
										))}
									</div>
								</div>
							)}

							{/* Extra Skills */}
							{selected.extraSkills && selected.extraSkills.length > 0 && (
								<div>
									<h4 className="text-xs uppercase font-bold text-base-content/50 mb-2 tracking-wider">Extra Skills</h4>
									<div className="flex flex-wrap gap-1.5">
										{selected.extraSkills.map(sk => (
											<span key={sk} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">{sk}</span>
										))}
									</div>
								</div>
							)}

							{/* Allowed Tools */}
							{selected.allowedTools && selected.allowedTools.length > 0 && (
								<div>
									<h4 className="text-xs uppercase font-bold text-base-content/50 mb-2 tracking-wider">Allowed Tools</h4>
									<div className="flex flex-wrap gap-1.5">
										{selected.allowedTools.map(t => (
											<span key={t} className="text-xs px-2 py-1 rounded-full bg-info/10 text-info border border-info/20">{t}</span>
										))}
									</div>
								</div>
							)}

							{/* Allowed MCP Servers */}
							{selected.allowedMcpServers && selected.allowedMcpServers.length > 0 && (
								<div>
									<h4 className="text-xs uppercase font-bold text-base-content/50 mb-2 tracking-wider">Allowed MCP Servers</h4>
									<div className="flex flex-wrap gap-1.5">
										{selected.allowedMcpServers.map(m => (
											<span key={m} className="text-xs px-2 py-1 rounded-full bg-secondary/10 text-secondary border border-secondary/20">{m}</span>
										))}
									</div>
								</div>
							)}

							{/* Persona Dir */}
							<div>
								<h4 className="text-xs uppercase font-bold text-base-content/50 mb-2 tracking-wider">Persona Directory</h4>
								<p className="text-xs font-mono text-base-content/40">~/.tamias/agents/{selected.slug}/</p>
							</div>
						</div>
					</div>
				) : (
					/* Empty state */
					<div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
						<div className="max-w-2xl w-full space-y-8 py-12">
							<div className="text-center space-y-4">
								<div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
									<HelpCircle className="w-10 h-10 text-primary" />
								</div>
								<h3 className="text-3xl font-bold text-base-content">What are Agents?</h3>
								<p className="text-lg text-base-content/70 leading-relaxed">
									Agents are persistent AI personas with their own character, model preferences, and specialized instructions.
									Unlike sub-agents spawned at runtime, these are long-lived identities you configure once and use across channels.
								</p>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								<div className="space-y-2">
									<div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-base-content/40">
										<Bot className="w-3.5 h-3.5" />
										<span>Custom Persona</span>
									</div>
									<p className="text-sm text-base-content/60">
										Each agent has its own system instructions, persona folder with SOUL.md and IDENTITY.md files.
									</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-base-content/40">
										<Bot className="w-3.5 h-3.5" />
										<span>Channel Routing</span>
									</div>
									<p className="text-sm text-base-content/60">
										Bind agents to specific Discord or Telegram channels so they automatically handle conversations there.
									</p>
								</div>
							</div>

							<div className="flex flex-col items-center gap-4 pt-4 text-center">
								<button onClick={openCreate} className="btn btn-primary btn-lg px-8 gap-3 shadow-lg shadow-primary/20 rounded-2xl">
									<Plus className="w-5 h-5" />
									Create New Agent
								</button>
								<p className="text-sm text-base-content/40">
									Or select an existing one from the sidebar
								</p>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Create / Edit Modal */}
			<Modal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				title={<h3 className="text-lg font-semibold">{editingAgent ? 'Edit Agent' : 'Create New Agent'}</h3>}
				className="w-11/12 max-w-3xl"
				footer={
					<div className="flex justify-end gap-2">
						<button onClick={() => setIsModalOpen(false)} className="btn btn-ghost">Cancel</button>
						<button onClick={handleSave} className="btn btn-primary gap-2" disabled={saving}>
							{saving ? <span className="loading loading-spinner loading-sm" /> : null}
							{editingAgent ? 'Save Changes' : 'Create Agent'}
						</button>
					</div>
				}
			>
				<div className="space-y-4">
					{/* Name */}
					<div className="form-control">
						<label className="label"><span className="label-text font-medium">Name *</span></label>
						<input
							type="text"
							className="input input-bordered focus:input-primary transition-colors"
							placeholder="e.g. Researcher, Customer Support"
							value={form.name}
							onChange={e => handleNameChange(e.target.value)}
						/>
					</div>

					{/* Slug */}
					<div className="form-control">
						<label className="label">
							<span className="label-text font-medium">Slug</span>
							<span className="label-text-alt text-base-content/40">auto-derived from name</span>
						</label>
						<input
							type="text"
							className="input input-bordered input-sm font-mono focus:input-primary transition-colors"
							placeholder="my-agent"
							value={form.slug}
							onChange={e => setForm(prev => ({ ...prev, slug: e.target.value }))}
							disabled={!!editingAgent}
						/>
					</div>

					{/* Model */}
					<div className="form-control">
						<label className="label">
							<span className="label-text font-medium">Model</span>
							<span className="label-text-alt text-base-content/40">leave empty for default</span>
						</label>
						<input
							type="text"
							className="input input-bordered input-sm font-mono focus:input-primary transition-colors"
							placeholder="e.g. openai/gpt-4o, anthropic/claude-sonnet-4-20250514"
							value={form.model}
							onChange={e => setForm(prev => ({ ...prev, model: e.target.value }))}
						/>
					</div>

					{/* Model Fallbacks */}
					<div className="form-control">
						<label className="label">
							<span className="label-text font-medium">Model Fallbacks</span>
							<span className="label-text-alt text-base-content/40">comma-separated</span>
						</label>
						<input
							type="text"
							className="input input-bordered input-sm font-mono focus:input-primary transition-colors"
							placeholder="e.g. openai/gpt-4o-mini, anthropic/claude-sonnet-4-20250514"
							value={form.modelFallbacks}
							onChange={e => setForm(prev => ({ ...prev, modelFallbacks: e.target.value }))}
						/>
					</div>

					{/* Instructions */}
					<div className="form-control">
						<label className="label"><span className="label-text font-medium">Instructions *</span></label>
						<textarea
							className="textarea textarea-bordered font-mono text-sm leading-relaxed min-h-[160px] focus:textarea-primary transition-colors resize-none"
							placeholder="You are a research assistant specializing in..."
							value={form.instructions}
							onChange={e => setForm(prev => ({ ...prev, instructions: e.target.value }))}
						/>
					</div>

					{/* Channels */}
					<div className="form-control">
						<label className="label">
							<span className="label-text font-medium">Bound Channels</span>
							<span className="label-text-alt text-base-content/40">comma-separated channel IDs</span>
						</label>
						<input
							type="text"
							className="input input-bordered input-sm font-mono focus:input-primary transition-colors"
							placeholder="e.g. 123456789, 987654321"
							value={form.channels}
							onChange={e => setForm(prev => ({ ...prev, channels: e.target.value }))}
						/>
					</div>

					{/* Extra Skills */}
					<div className="form-control">
						<label className="label">
							<span className="label-text font-medium">Extra Skills</span>
							<span className="label-text-alt text-base-content/40">comma-separated skill folder names</span>
						</label>
						<input
							type="text"
							className="input input-bordered input-sm font-mono focus:input-primary transition-colors"
							placeholder="e.g. lookup-larry, code-review"
							value={form.extraSkills}
							onChange={e => setForm(prev => ({ ...prev, extraSkills: e.target.value }))}
						/>
					</div>

					{/* Allowed Tools */}
					<div className="form-control">
						<label className="label">
							<span className="label-text font-medium">Allowed Tools</span>
							<span className="label-text-alt text-base-content/40">empty = all tools</span>
						</label>
						<input
							type="text"
							className="input input-bordered input-sm font-mono focus:input-primary transition-colors"
							placeholder="e.g. browser, terminal, github"
							value={form.allowedTools}
							onChange={e => setForm(prev => ({ ...prev, allowedTools: e.target.value }))}
						/>
					</div>

					{/* Allowed MCP Servers */}
					<div className="form-control">
						<label className="label">
							<span className="label-text font-medium">Allowed MCP Servers</span>
							<span className="label-text-alt text-base-content/40">empty = all servers</span>
						</label>
						<input
							type="text"
							className="input input-bordered input-sm font-mono focus:input-primary transition-colors"
							placeholder="e.g. my-mcp-server"
							value={form.allowedMcpServers}
							onChange={e => setForm(prev => ({ ...prev, allowedMcpServers: e.target.value }))}
						/>
					</div>
				</div>
			</Modal>
		</div>
	)
}
