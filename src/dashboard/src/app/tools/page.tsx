'use client'

import { useState, useEffect } from 'react'

export type ToolFunctionConfig = {
	enabled: boolean
	allowlist?: string[]
}

export type InternalToolConfig = {
	enabled: boolean
	functions?: Record<string, ToolFunctionConfig>
}

export type EmailAccountConfig = {
	nickname: string
	enabled: boolean
	envKeyName?: string
	accountName: string
	isDefault: boolean
	permissions: {
		whitelist: string[]
		canSend: boolean
	}
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

function ToolFunctionRow({
	name,
	config,
	onChange
}: {
	name: string
	config: ToolFunctionConfig
	onChange: (c: ToolFunctionConfig) => void
}) {
	return (
		<div className="flex flex-col gap-2 p-3 bg-base-300/30 rounded-lg border border-base-content/5">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className={`w-2 h-2 rounded-full ${config.enabled ? 'bg-success' : 'bg-error'}`} />
					<span className="font-mono text-xs font-bold">{name}</span>
				</div>
				<input
					type="checkbox"
					className="toggle toggle-xs toggle-primary"
					checked={config.enabled}
					onChange={e => onChange({ ...config, enabled: e.target.checked })}
				/>
			</div>
			{config.enabled && (
				<div className="space-y-1">
					<label className="text-[10px] uppercase font-bold text-base-content/40 ml-1">Allowlist (regex, comma-separated)</label>
					<input
						type="text"
						placeholder="^ls , ^cat (empty for all)"
						className="input input-xs input-bordered w-full font-mono text-[10px]"
						value={config.allowlist?.join(', ') || ''}
						onChange={e => {
							const val = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
							onChange({ ...config, allowlist: val.length ? val : undefined })
						}}
					/>
				</div>
			)}
		</div>
	)
}

function EmailAccountCard({
	config,
	onChange,
	onRemove
}: {
	config: EmailAccountConfig
	onChange: (c: EmailAccountConfig) => void
	onRemove: () => void
}) {
	return (
		<div className={`card bg-base-200 border ${config.enabled ? 'border-info/40' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all`}>
			<div className="card-body p-4 space-y-3">
				<div className="flex items-center gap-4">
					<span className="text-3xl w-10 text-center shrink-0">📧</span>
					<div className="flex-1">
						<div className="flex items-center gap-2">
							<div className="flex flex-col flex-1">
								<span className="text-[8px] uppercase font-bold text-base-content/40 ml-0.5">Display Name</span>
								<input
									type="text"
									className="input input-xs input-ghost font-mono font-bold text-sm text-info p-0 h-auto w-full"
									value={config.nickname}
									onChange={e => onChange({ ...config, nickname: e.target.value })}
								/>
							</div>
							{config.isDefault && <span className="badge badge-info badge-xs uppercase font-bold text-[8px]">Default</span>}
						</div>
						<div className="flex flex-col w-full">
							<span className="text-[8px] uppercase font-bold text-base-content/40 ml-0.5">Himalaya Account ID</span>
							<input
								type="text"
								placeholder="e.g. personal"
								className="input input-xs input-ghost text-[10px] text-base-content/60 lowercase p-0 h-auto w-full"
								value={config.accountName}
								onChange={e => onChange({ ...config, accountName: e.target.value })}
							/>
						</div>
					</div>
					<div className="flex flex-col items-end gap-2">
						<input
							type="checkbox"
							className="toggle toggle-info toggle-sm shrink-0"
							checked={config.enabled}
							onChange={e => onChange({ ...config, enabled: e.target.checked })}
						/>
						<button onClick={onRemove} className="btn btn-xs btn-ghost text-error opacity-20 hover:opacity-100">✕</button>
					</div>
				</div>

				{config.enabled && (
					<div className="space-y-3 pt-2 border-t border-base-content/5">
						<div className="flex items-center justify-between">
							<span className="text-[10px] uppercase font-bold text-base-content/40">Default Account</span>
							<input
								type="checkbox"
								className="checkbox checkbox-xs checkbox-info"
								checked={config.isDefault}
								onChange={e => onChange({ ...config, isDefault: e.target.checked })}
							/>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-[10px] uppercase font-bold text-base-content/40">Authorize anyone to receive emails</span>
							<input
								type="checkbox"
								className="checkbox checkbox-xs checkbox-info"
								checked={config.permissions.canSend}
								onChange={e => onChange({ ...config, permissions: { ...config.permissions, canSend: e.target.checked } })}
							/>
						</div>
						{!config.permissions.canSend && (
							<div className="space-y-1">
								<div className="flex justify-between items-center ml-1">
									<label className="text-[10px] uppercase font-bold text-base-content/40">Destination Whitelist</label>
									<span className="text-[8px] text-base-content/30 italic">Comma separated emails only</span>
								</div>
								<textarea
									placeholder="Limit to: boss@company.com, assistant@company.com"
									className="textarea textarea-xs textarea-bordered w-full font-mono text-[10px] min-h-[60px]"
									value={config.permissions.whitelist.join(', ')}
									onChange={e => {
										const val = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
										onChange({ ...config, permissions: { ...config.permissions, whitelist: val } })
									}}
								/>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

function GeminiToolCard({
	config,
	onChange
}: {
	config: InternalToolConfig
	onChange: (c: InternalToolConfig) => void
}) {
	return (
		<div className={`card bg-base-200 border ${config.enabled ? 'border-primary/40' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all`}>
			<div className="card-body p-4 space-y-3">
				<div className="flex items-center gap-4">
					<span className="text-3xl w-10 text-center shrink-0">♊</span>
					<div className="flex-1">
						<div className="font-mono font-bold text-sm text-primary uppercase">Gemini CLI</div>
						<div className="text-[10px] text-base-content/50">Run prompts in project directories</div>
					</div>
					<input
						type="checkbox"
						className="toggle toggle-primary toggle-sm shrink-0"
						checked={config.enabled}
						onChange={e => onChange({ ...config, enabled: e.target.checked })}
					/>
				</div>

				{config.enabled && (
					<div className="space-y-3 pt-2 border-t border-base-content/5">
						<div className="p-3 bg-base-300/50 rounded-lg space-y-2">
							<p className="text-[10px] font-bold uppercase text-base-content/40">Setup Required</p>
							<div className="flex flex-col gap-2">
								<a href="https://github.com/google-gemini/gemini-cli" target="_blank" className="btn btn-xs btn-outline btn-primary">Install Gemini CLI</a>
								<div className="text-[10px] leading-relaxed opacity-70">
									Once installed, run <code className="bg-base-content/10 px-1 rounded">gemini auth login</code> in your terminal to authenticate.
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

function InternalToolCard({
	id,
	label,
	config,
	onChange
}: {
	id: string
	label: string
	config: InternalToolConfig
	onChange: (c: InternalToolConfig) => void
}) {
	const [expanded, setExpanded] = useState(false)
	const [newFnName, setNewFnName] = useState('')

	const toggleFunction = (fnName: string, fnConfig: ToolFunctionConfig) => {
		const updatedFns = { ...(config.functions || {}), [fnName]: fnConfig }
		onChange({ ...config, functions: updatedFns })
	}

	const addFunction = () => {
		if (!newFnName) return
		toggleFunction(newFnName, { enabled: true })
		setNewFnName('')
	}

	return (
		<div className={`card bg-base-200 border ${config.enabled ? 'border-primary/40' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all`}>
			<div className="card-body p-4 space-y-3">
				<div className="flex items-center gap-4">
					<span className="text-3xl w-10 text-center shrink-0">🛠️</span>
					<div className="flex-1">
						<div className="font-mono font-bold text-sm text-primary">{id}</div>
						<div className="text-xs text-base-content/60 lowercase">{label}</div>
					</div>
					<input
						type="checkbox"
						className="toggle toggle-primary shrink-0"
						checked={config.enabled}
						onChange={e => onChange({ ...config, enabled: e.target.checked })}
					/>
				</div>

				{config.enabled && (
					<div className="space-y-3 pt-2">
						<button
							onClick={() => setExpanded(!expanded)}
							className="btn btn-xs btn-ghost w-full justify-between opacity-50 hover:opacity-100"
						>
							<span>{expanded ? '▲ Hide' : '▼ Show'} Functions</span>
							<span className="badge badge-outline badge-xs font-mono">{Object.keys(config.functions || {}).length} rules</span>
						</button>

						{expanded && (
							<div className="space-y-3 border-t border-base-content/10 pt-3">
								<div className="grid grid-cols-1 gap-2">
									{Object.entries(config.functions || {}).map(([fn, fnCfg]) => (
										<ToolFunctionRow
											key={fn}
											name={fn}
											config={fnCfg}
											onChange={(u) => toggleFunction(fn, u)}
										/>
									))}
								</div>

								<div className="flex gap-1 mt-2">
									<input
										type="text"
										placeholder="New function name..."
										className="input input-xs input-bordered flex-1 font-mono text-[10px]"
										value={newFnName}
										onChange={e => setNewFnName(e.target.value)}
										onKeyDown={e => e.key === 'Enter' && addFunction()}
									/>
									<button onClick={addFunction} className="btn btn-xs btn-outline btn-square">+</button>
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
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
		<div className={`card bg-base-200 border ${config.enabled ? 'border-success/40' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all group relative`}>
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
							<div className="font-mono font-bold text-lg text-success">{name}</div>
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
						className="toggle toggle-success shrink-0"
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
							<div className="flex items-start gap-2">
								<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 mt-2">Env Vars</span>
								<div className="flex-1">
									<textarea
										placeholder="e.g. API_KEY=abc123"
										className="textarea textarea-bordered textarea-sm w-full font-mono min-h-[60px]"
										value={Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
										onChange={e => {
											const env: Record<string, string> = {}
											e.target.value.split('\n').forEach(line => {
												const eq = line.indexOf('=')
												if (eq > 0) {
													const k = line.slice(0, eq).trim()
													const v = line.slice(eq + 1).trim()
													if (k) env[k] = v
												}
											})
											onChange({ ...config, env: Object.keys(env).length ? env : undefined })
										}}
									/>
									<p className="text-[10px] text-base-content/40 mt-1">KEY=VALUE, one per line</p>
								</div>
							</div>
						</>
					) : (
						<>
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
							<div className="flex items-start gap-2">
								<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 shrink-0 mt-2">Headers</span>
								<div className="flex-1">
									<textarea
										placeholder="e.g. Authorization=Bearer abc"
										className="textarea textarea-bordered textarea-sm w-full font-mono min-h-[60px]"
										value={Object.entries(config.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
										onChange={e => {
											const headers: Record<string, string> = {}
											e.target.value.split('\n').forEach(line => {
												const eq = line.indexOf('=')
												if (eq > 0) {
													const k = line.slice(0, eq).trim()
													const v = line.slice(eq + 1).trim()
													if (k) headers[k] = v
												}
											})
											onChange({ ...config, headers: Object.keys(headers).length ? headers : undefined })
										}}
									/>
									<p className="text-[10px] text-base-content/40 mt-1">KEY=VALUE, one per line</p>
								</div>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	)
}

export default function ToolsPage() {
	const [internalTools, setInternalTools] = useState<Record<string, InternalToolConfig>>({})
	const [availableInternalTools, setAvailableInternalTools] = useState<Record<string, string>>({})
	const [emails, setEmails] = useState<Record<string, EmailAccountConfig>>({})
	const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({})
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		fetch('/api/tools')
			.then(r => r.json())
			.then(d => {
				setInternalTools(d.internalTools || {})
				setAvailableInternalTools(d.availableInternalTools || {})
				setEmails(d.emails || {})
				setMcpServers(d.mcpServers || {})
			})
	}, [])

	const save = async () => {
		setSaving(true)
		await fetch('/api/tools', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ internalTools, mcpServers, emails }),
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

	const addEmailAccount = () => {
		const newId = `email-${Date.now().toString().slice(-4)}`
		setEmails({
			...emails,
			[newId]: {
				nickname: newId,
				enabled: true,
				accountName: 'personal',
				isDefault: Object.keys(emails).length === 0,
				permissions: {
					whitelist: [],
					canSend: true
				}
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

	const updateInternalTool = (id: string, update: InternalToolConfig) => {
		setInternalTools({ ...internalTools, [id]: update })
	}

	const updateEmailAccount = (id: string, update: EmailAccountConfig) => {
		const newEmails = { ...emails, [id]: update }
		// If this is set to default, unset others
		if (update.isDefault) {
			Object.keys(newEmails).forEach(k => {
				if (k !== id) newEmails[k].isDefault = false
			})
		}
		setEmails(newEmails)
	}

	const removeEmailAccount = (id: string) => {
		const updated = { ...emails }
		delete updated[id]
		setEmails(updated)
	}

	return (
		<div className="p-6 max-w-6xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
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

			<section className="space-y-6">
				<div className="border-b-2 border-info/20 pb-4 flex justify-between items-end">
					<h2 className="text-2xl font-black flex items-center gap-3 uppercase text-info">Email Accounts</h2>
					<button onClick={addEmailAccount} className="btn btn-sm btn-info">+ Add Account</button>
				</div>

				{Object.keys(emails).length === 0 ? (
					<div className="text-sm text-base-content/30 italic p-12 border-2 border-dashed rounded-2xl border-base-300 text-center bg-base-200/50">
						No email accounts configured. Add one to enable email capabilities via Himalaya.
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{Object.entries(emails).map(([id, config]) => (
							<EmailAccountCard
								key={id}
								config={config}
								onChange={(u) => updateEmailAccount(id, u)}
								onRemove={() => removeEmailAccount(id)}
							/>
						))}
					</div>
				)}
			</section>

			<section className="space-y-6">
				<div className="border-b-2 border-primary/20 pb-4 flex justify-between items-end">
					<h2 className="text-2xl font-black flex items-center gap-3 uppercase">Internal Tools</h2>
					<p className="text-xs text-base-content/50 font-bold uppercase tracking-widest hidden md:block">Native Tamias capabilities</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{/* Specialized Gemini Card */}
					<GeminiToolCard
						config={internalTools['gemini'] || { enabled: true }}
						onChange={(u) => updateInternalTool('gemini', u)}
					/>

					{/* Other Internal Tools */}
					{Object.entries(availableInternalTools).filter(([id]) => id !== 'gemini' && id !== 'email').map(([id, label]) => (
						<InternalToolCard
							key={id}
							id={id}
							label={label}
							config={internalTools[id] || { enabled: true }}
							onChange={(u) => updateInternalTool(id, u)}
						/>
					))}
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
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
