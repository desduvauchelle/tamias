'use client'

import { useState, useEffect } from 'react'

export type InternalToolConfig = {
	enabled: boolean
}

export type McpServerConfig = {
	enabled: boolean
	label?: string
	transport: 'stdio' | 'http'
	command?: string
	args?: string[]
	env?: Record<string, string>
	url?: string
	headers?: Record<string, string>
}

function McpServerCard({
	name,
	config,
	onChange,
	onRemove
}: {
	name: string
	config: McpServerConfig
	onChange: (c: McpServerConfig) => void
	onRemove: () => void
}) {
	return (
		<div className={`card bg-base-200 border ${config.enabled ? 'border-primary' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all group relative`}>
			<button
				onClick={onRemove}
				className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2 opacity-30 group-hover:opacity-100 transition-opacity text-error"
				title="Remove MCP Server"
			>✕</button>
			<div className="card-body p-4 space-y-4">
				<div className="flex items-center gap-4">
					<span className="text-4xl w-12 text-center shrink-0 mt-2">🔌</span>
					<div className="flex-1 space-y-1">
						<div className="flex items-center gap-2">
							<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">ID / Name</span>
							<div className="font-mono font-bold text-lg text-primary">{name}</div>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">Label</span>
							<input
								type="text"
								placeholder="e.g. Memory Server"
								className="input input-xs input-ghost w-full font-mono text-base-content/80 text-sm p-0 h-auto"
								value={config.label || ''}
								onChange={e => onChange({ ...config, label: e.target.value })}
							/>
						</div>
					</div>
					<input
						type="checkbox"
						className="toggle toggle-primary shrink-0"
						checked={config.enabled}
						onChange={e => onChange({ ...config, enabled: e.target.checked })}
						title="Enable/Disable MCP globally"
					/>
				</div>

				<div className="divider m-0 opacity-20">Configuration</div>

				<div className="flex-1 space-y-3">
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">Transport</span>
						<select
							className="select select-sm select-bordered font-mono w-full text-xs"
							value={config.transport}
							onChange={e => onChange({ ...config, transport: e.target.value as 'stdio' | 'http' })}
						>
							<option value="stdio">Local Process (Stdio)</option>
							<option value="http">Remote Server (HTTP / SSE)</option>
						</select>
					</div>

					{config.transport === 'stdio' ? (
						<>
							<div className="flex items-center gap-2">
								<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">Command</span>
								<input
									type="text"
									placeholder="e.g. npx"
									className="input input-sm input-bordered w-full font-mono text-xs"
									value={config.command || ''}
									onChange={e => onChange({ ...config, command: e.target.value })}
								/>
							</div>
							<div className="flex items-start gap-2">
								<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 mt-2">Args</span>
								<div className="flex-1">
									<textarea
										placeholder="e.g. -y, @modelcontextprotocol/server-memory"
										className="textarea textarea-bordered textarea-sm w-full font-mono min-h-[60px]"
										value={(config.args || []).join('\n')}
										onChange={e => {
											const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean)
											onChange({ ...config, args: lines })
										}}
									/>
									<p className="text-[10px] text-base-content/40 mt-1">One argument per line</p>
								</div>
							</div>
						</>
					) : (
						<div className="flex items-center gap-2">
							<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0">SSE URL</span>
							<input
								type="text"
								placeholder="https://my-server.com/mcp/sse"
								className="input input-sm input-bordered w-full font-mono text-xs"
								value={config.url || ''}
								onChange={e => onChange({ ...config, url: e.target.value })}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default function ToolsPage() {
	const [internalTools, setInternalTools] = useState<Record<string, InternalToolConfig>>({})
	const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({})
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		fetch('/api/tools')
			.then(r => r.json())
			.then(d => {
				setInternalTools(d.internalTools || {})
				setMcpServers(d.mcpServers || {})
			})
	}, [])

	const save = async () => {
		setSaving(true)
		await fetch('/api/tools', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ internalTools, mcpServers }),
		})
		setSaving(false)
		setSaved(true)
		setTimeout(() => setSaved(false), 2000)
	}

	const addMcpServer = () => {
		const newId = `mcp-${Date.now().toString().slice(-4)}`
		setMcpServers({
			...mcpServers,
			[newId]: {
				enabled: true,
				label: 'New MCP Server',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@modelcontextprotocol/server-everything']
			}
		})
	}

	const updateMcpServer = (id: string, update: McpServerConfig) => {
		setMcpServers({ ...mcpServers, [id]: update })
	}

	const removeMcpServer = (id: string) => {
		const updated = { ...mcpServers }
		delete updated[id]
		setMcpServers(updated)
	}

	return (
		<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
			<div className="flex justify-between items-start">
				<div>
					<h1 className="text-3xl font-black text-primary uppercase tracking-tighter">TOOLS & MCP SERVERS</h1>
					<p className="text-base-content/50 text-sm mt-1">Configure internal tools and third-party Model Context Protocol integrations.</p>
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

			<section className="space-y-4">
				<div className="border-b-2 border-primary/20 pb-4 flex justify-between items-end">
					<h2 className="text-2xl font-black flex items-center gap-3 uppercase">Internal Tools</h2>
					<p className="text-xs text-base-content/50 font-bold uppercase tracking-widest hidden md:block">Native Tamias capabilities</p>
				</div>
				<div className="p-4 bg-base-200 border border-base-300 rounded-xl space-y-2">
					<p className="text-xs text-base-content/50 ml-1 mb-4 italic">Built-in tools are automatically registered by Tamias. Future updates will allow toggling them here.</p>
				</div>
			</section>

			<section className="space-y-6">
				<div className="border-b-2 border-success/20 pb-4 flex justify-between items-end">
					<h2 className="text-2xl font-black flex items-center gap-3 uppercase">MCP Integrations</h2>
					<button onClick={addMcpServer} className="btn btn-sm btn-success">+ Add MCP Server</button>
				</div>

				{Object.keys(mcpServers).length === 0 ? (
					<div className="text-sm text-base-content/30 italic p-12 border-2 border-dashed rounded-2xl border-base-300 text-center bg-base-200/50">
						No MCP servers connected. Model Context Protocol servers give the AI access to read/write external systems.
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{Object.entries(mcpServers).map(([id, config]) => (
							<McpServerCard
								key={id}
								name={id}
								config={config}
								onChange={(u) => updateMcpServer(id, u)}
								onRemove={() => removeMcpServer(id)}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	)
}
