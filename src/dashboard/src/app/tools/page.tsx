'use client'

import { useState, useEffect } from 'react'
import { Modal } from '../_components/Modal'

export type ToolFunctionConfig = {
	enabled: boolean
	allowlist?: string[]
}

export type InternalToolConfig = {
	enabled: boolean
	functions?: Record<string, ToolFunctionConfig>
}

function FunctionRulesSection({
	config,
	availableFunctions,
	onFunctionChange,
}: {
	config: InternalToolConfig
	availableFunctions: string[]
	onFunctionChange: (fnName: string, fnConfig: ToolFunctionConfig) => void
}) {
	const allFunctions = Array.from(new Set([...availableFunctions, ...Object.keys(config.functions || {})])).sort()

	if (allFunctions.length === 0) return null

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<label className="text-[10px] uppercase font-bold text-base-content/40">Function Rules</label>
				<span className="badge badge-outline badge-xs font-mono">{allFunctions.length} rules</span>
			</div>
			<div className="grid grid-cols-1 gap-2">
				{allFunctions.map((fn) => (
					<ToolFunctionRow
						key={fn}
						name={fn}
						config={config.functions?.[fn] || { enabled: true }}
						onChange={(u) => onFunctionChange(fn, u)}
					/>
				))}
			</div>
		</div>
	)
}

export type EmailAccountConfig = {
	nickname: string
	email?: string
	service?: 'gmail' | 'outlook' | 'icloud' | 'other'
	enabled: boolean
	envKeyName?: string
	appPassword?: string
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

const SERVICE_GUIDES: Record<string, { label: string; url: string; steps: string[] }> = {
	gmail: {
		label: 'Gmail App Password',
		url: 'https://myaccount.google.com/apppasswords',
		steps: [
			'Go to myaccount.google.com → Security',
			'Enable 2-Step Verification if not already active',
			'Search for "App passwords" and open it',
			'Under Select app → choose "Mail"; under Select device → choose "Other" and type "Tamias"',
			'Click Generate — copy the 16-character password and paste it in the App Password field',
		],
	},
	outlook: {
		label: 'Outlook App Password',
		url: 'https://account.microsoft.com/security',
		steps: [
			'Go to account.microsoft.com → Security → Advanced security options',
			'Under "App passwords", click "Create a new app password"',
			'Copy the generated password and paste it in the App Password field',
		],
	},
	icloud: {
		label: 'iCloud App-Specific Password',
		url: 'https://appleid.apple.com',
		steps: [
			'Go to appleid.apple.com and sign in',
			'Under Security → App-Specific Passwords, click "Generate Password"',
			'Enter a label like "Tamias" and click Create',
			'Copy the generated password and paste it in the App Password field',
		],
	},
	other: {
		label: 'Custom IMAP/SMTP',
		url: '',
		steps: [
			'Enter your email address and your regular account password (or an app password if your provider offers one)',
			'Tamias uses the himalaya CLI — it will auto-configure the IMAP/SMTP settings',
			'For custom providers, make sure IMAP access is enabled in your mail settings',
		],
	},
}

function EmailAccountCard({
	emailId,
	config,
	allEmails,
	onChange,
	onRemove,
	onSaveAll,
}: {
	emailId: string
	config: EmailAccountConfig
	allEmails: Record<string, EmailAccountConfig>
	onChange: (c: EmailAccountConfig) => void
	onRemove: () => void
	onSaveAll: (overrides: { emails: Record<string, EmailAccountConfig> }) => Promise<void>
}) {
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [draft, setDraft] = useState<EmailAccountConfig>(config)
	const [whitelistText, setWhitelistText] = useState(config.permissions.whitelist.join(', '))
	const [draftPassword, setDraftPassword] = useState('')
	const [showGuide, setShowGuide] = useState(false)

	const hasPassword = !!config.envKeyName
	const guide = SERVICE_GUIDES[draft.service || 'gmail']

	const openModal = () => {
		setDraft(config)
		setWhitelistText(config.permissions.whitelist.join(', '))
		setDraftPassword('')
		setShowGuide(false)
		setIsModalOpen(true)
	}

	const saveModal = () => {
		const whitelist = whitelistText.split(',').map(s => s.trim()).filter(Boolean)
		const updated: EmailAccountConfig = { ...draft, permissions: { ...draft.permissions, whitelist } }
		if (draftPassword) updated.appPassword = draftPassword
		onChange(updated)
		setIsModalOpen(false)
		// Auto-persist to server
		const updatedEmails = { ...allEmails, [emailId]: updated }
		onSaveAll({ emails: updatedEmails })
	}

	const closeModal = () => setIsModalOpen(false)

	return (
		<div className={`card bg-base-200 border ${config.enabled ? 'border-info/40' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all`}>
			<div className="card-body p-4 space-y-3">
				<div className="flex items-center gap-4">
					<span className="text-3xl w-10 text-center shrink-0">📧</span>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<div className="font-mono font-bold text-sm text-info truncate">{config.nickname}</div>
							{config.isDefault && <span className="badge badge-info badge-xs uppercase font-bold text-[8px]">Default</span>}
							{config.service && <span className="badge badge-ghost badge-xs font-mono uppercase">{config.service}</span>}
						</div>
						{config.email && (
							<div className="text-[11px] text-base-content/70 font-mono truncate">{config.email}</div>
						)}
						<div className="flex items-center gap-2 mt-0.5">
							<div className="text-[10px] text-base-content/40 lowercase">{config.accountName || 'no account id'}</div>
							{hasPassword
								? <span className="text-[10px] text-success">● password saved</span>
								: <span className="text-[10px] text-warning">⚠ no password</span>
							}
						</div>
					</div>
					<div className="flex flex-col items-end gap-2 shrink-0">
						<input
							type="checkbox"
							className="toggle toggle-info toggle-sm"
							checked={config.enabled}
							onChange={e => onChange({ ...config, enabled: e.target.checked })}
						/>
					</div>
				</div>
				<div className="text-[10px] text-base-content/50 flex items-center justify-between pt-1 border-t border-base-content/5">
					<span>{config.permissions.canSend ? 'Open send permissions' : `${config.permissions.whitelist.length} whitelisted recipients`}</span>
					<button onClick={openModal} className="btn btn-xs btn-ghost">Edit Details</button>
				</div>
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={closeModal}
				title={<h3 className="text-lg font-semibold">Email Account Settings</h3>}
				className="w-11/12 max-w-3xl"
			>
				<div className="space-y-4">

					{/* Setup guide */}
					<div className="rounded-lg border border-base-content/10 bg-base-300/40 overflow-hidden">
						<button
							className="w-full flex items-center justify-between px-3 py-2 text-left"
							onClick={() => setShowGuide(g => !g)}
						>
							<span className="text-[10px] font-bold uppercase text-base-content/40 flex items-center gap-1.5">
								<span>📖</span> How to connect — {guide.label}
							</span>
							<span className="text-[10px] text-base-content/40">{showGuide ? '▲ hide' : '▼ show'}</span>
						</button>
						{showGuide && (
							<div className="px-3 pb-3 space-y-2">
								<ol className="list-decimal list-inside space-y-1.5">
									{guide.steps.map((step, i) => (
										<li key={i} className="text-[11px] text-base-content/70 leading-relaxed">{step}</li>
									))}
								</ol>
								{guide.url && (
									<a href={guide.url} target="_blank" rel="noreferrer" className="btn btn-xs btn-outline btn-info mt-1">
										Open {guide.label} page ↗
									</a>
								)}
							</div>
						)}
					</div>

					{/* Service */}
					<div className="flex flex-col gap-1">
						<label className="text-xs uppercase font-bold text-base-content/50">Email Provider</label>
						<select
							className="select select-sm select-bordered w-full font-mono"
							value={draft.service || 'gmail'}
							onChange={e => setDraft({ ...draft, service: e.target.value as EmailAccountConfig['service'] })}
						>
							<option value="gmail">Gmail</option>
							<option value="outlook">Outlook / Microsoft 365</option>
							<option value="icloud">iCloud Mail</option>
							<option value="other">Other (custom IMAP/SMTP)</option>
						</select>
					</div>

					{/* Display name */}
					<div className="flex flex-col gap-1">
						<label className="text-xs uppercase font-bold text-base-content/50">Display Name</label>
						<input
							type="text"
							className="input input-sm input-bordered w-full font-mono"
							value={draft.nickname}
							onChange={e => setDraft({ ...draft, nickname: e.target.value })}
						/>
					</div>

					{/* Email address */}
					<div className="flex flex-col gap-1">
						<label className="text-xs uppercase font-bold text-base-content/50">Email Address</label>
						<input
							type="email"
							placeholder="me@example.com"
							className="input input-sm input-bordered w-full font-mono"
							value={draft.email || ''}
							onChange={e => setDraft({ ...draft, email: e.target.value })}
						/>
					</div>

					{/* App password */}
					<div className="flex flex-col gap-1">
						<label className="text-xs uppercase font-bold text-base-content/50 flex items-center gap-2">
							App Password
							{hasPassword
								? <span className="normal-case font-normal text-success text-[10px]">● saved — leave blank to keep</span>
								: <span className="normal-case font-normal text-warning text-[10px]">⚠ not set yet</span>
							}
						</label>
						<input
							type="password"
							placeholder={hasPassword ? 'Leave blank to keep current password' : 'Paste your app password here'}
							className="input input-sm input-bordered w-full font-mono"
							value={draftPassword}
							onChange={e => setDraftPassword(e.target.value)}
							autoComplete="new-password"
						/>
					</div>

					{/* Himalaya account ID */}
					<div className="flex flex-col gap-1">
						<label className="text-xs uppercase font-bold text-base-content/50">Himalaya Account ID</label>
						<input
							type="text"
							placeholder="e.g. personal"
							className="input input-sm input-bordered w-full font-mono"
							value={draft.accountName}
							onChange={e => setDraft({ ...draft, accountName: e.target.value })}
						/>
						<p className="text-[10px] text-base-content/40">Internal ID for the himalaya CLI config — defaults to your email address if left unchanged</p>
					</div>

					{/* Default account toggle */}
					<div className="flex items-center justify-between">
						<span className="text-xs uppercase font-bold text-base-content/50">Default Account</span>
						<input
							type="checkbox"
							className="checkbox checkbox-sm checkbox-info"
							checked={draft.isDefault}
							onChange={e => setDraft({ ...draft, isDefault: e.target.checked })}
						/>
					</div>

					{/* Send permissions toggle */}
					<div className="flex items-center justify-between">
						<span className="text-xs uppercase font-bold text-base-content/50">Anyone can receive emails</span>
						<input
							type="checkbox"
							className="checkbox checkbox-sm checkbox-info"
							checked={draft.permissions.canSend}
							onChange={e => setDraft({ ...draft, permissions: { ...draft.permissions, canSend: e.target.checked } })}
						/>
					</div>

					{/* Whitelist */}
					{!draft.permissions.canSend && (
						<div className="flex flex-col gap-1">
							<label className="text-xs uppercase font-bold text-base-content/50">Destination Whitelist</label>
							<textarea
								placeholder="boss@company.com, assistant@company.com"
								className="textarea textarea-bordered w-full font-mono text-xs min-h-20"
								value={whitelistText}
								onChange={e => setWhitelistText(e.target.value)}
							/>
							<p className="text-[10px] text-base-content/40">Comma-separated email addresses. Leave empty for no restriction.</p>
						</div>
					)}

					{/* Footer */}
					<div className="flex items-center justify-between pt-4 border-t border-base-content/10">
						<button
							onClick={() => { onRemove(); setIsModalOpen(false) }}
							className="btn btn-sm btn-error btn-outline"
						>
							Delete Account
						</button>
						<div className="flex gap-2">
							<button onClick={closeModal} className="btn btn-sm btn-ghost">Cancel</button>
							<button onClick={saveModal} className="btn btn-sm btn-info">Save</button>
						</div>
					</div>
				</div>
			</Modal>
		</div>
	)
}

function GeminiToolCard({
	config,
	availableFunctions,
	onChange
}: {
	config: InternalToolConfig
	availableFunctions: string[]
	onChange: (c: InternalToolConfig) => void
}) {
	const [isModalOpen, setIsModalOpen] = useState(false)

	const toggleFunction = (fnName: string, fnConfig: ToolFunctionConfig) => {
		const updatedFns = { ...(config.functions || {}), [fnName]: fnConfig }
		onChange({ ...config, functions: updatedFns })
	}

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
				<div className="text-[10px] text-base-content/50 flex items-center justify-between pt-1 border-t border-base-content/5">
					<span>{availableFunctions.length} functions available</span>
					<button
						onClick={() => setIsModalOpen(true)}
						className="btn btn-xs btn-ghost"
						disabled={!config.enabled}
					>
						Edit Details
					</button>
				</div>
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				title={<h3 className="text-lg font-semibold">Gemini Tool Settings</h3>}
				className="w-11/12 max-w-3xl"
			>
				<div className="space-y-4">
					<div className="p-3 bg-base-300/50 rounded-lg space-y-2">
						<p className="text-[10px] font-bold uppercase text-base-content/40">Setup Required</p>
						<div className="flex flex-col gap-2">
							<a href="https://github.com/google-gemini/gemini-cli" target="_blank" className="btn btn-xs btn-outline btn-primary">Install Gemini CLI</a>
							<div className="text-[10px] leading-relaxed opacity-70">
								Once installed, run <code className="bg-base-content/10 px-1 rounded">gemini auth login</code> in your terminal to authenticate.
							</div>
						</div>
					</div>
					<FunctionRulesSection
						config={config}
						availableFunctions={availableFunctions}
						onFunctionChange={toggleFunction}
					/>
				</div>
			</Modal>
		</div>
	)
}

function ImageToolCard({
	config,
	availableFunctions,
	defaultImageModels,
	onChange,
	onModelsChange,
}: {
	config: InternalToolConfig
	availableFunctions: string[]
	defaultImageModels: string[]
	onChange: (c: InternalToolConfig) => void
	onModelsChange: (models: string[]) => void
}) {
	const [newModel, setNewModel] = useState('')
	const [isModalOpen, setIsModalOpen] = useState(false)

	const toggleFunction = (fnName: string, fnConfig: ToolFunctionConfig) => {
		const updatedFns = { ...(config.functions || {}), [fnName]: fnConfig }
		onChange({ ...config, functions: updatedFns })
	}

	const addModel = () => {
		const model = newModel.trim()
		if (!model || defaultImageModels.includes(model)) return
		onModelsChange([...defaultImageModels, model])
		setNewModel('')
	}

	const removeModel = (index: number) => {
		onModelsChange(defaultImageModels.filter((_, idx) => idx !== index))
	}

	const moveModel = (index: number, direction: -1 | 1) => {
		const next = [...defaultImageModels]
		const target = index + direction
		if (target < 0 || target >= next.length) return
		const [item] = next.splice(index, 1)
		next.splice(target, 0, item)
		onModelsChange(next)
	}

	return (
		<div className={`card bg-base-200 border ${config.enabled ? 'border-primary/40' : 'border-base-300 opacity-60 hover:opacity-100'} transition-all`}>
			<div className="card-body p-4 space-y-3">
				<div className="flex items-center gap-4">
					<span className="text-3xl w-10 text-center shrink-0">🖼️</span>
					<div className="flex-1">
						<div className="font-mono font-bold text-sm text-primary uppercase">Image Generation</div>
						<div className="text-[10px] text-base-content/50">Generate AI images</div>
					</div>
					<input
						type="checkbox"
						className="toggle toggle-primary toggle-sm shrink-0"
						checked={config.enabled}
						onChange={e => onChange({ ...config, enabled: e.target.checked })}
					/>
				</div>
				<div className="text-[10px] text-base-content/50 flex items-center justify-between pt-1 border-t border-base-content/5">
					<span>{defaultImageModels.length} preferred models</span>
					<button
						onClick={() => setIsModalOpen(true)}
						className="btn btn-xs btn-ghost"
						disabled={!config.enabled}
					>
						Edit Details
					</button>
				</div>
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				title={<h3 className="text-lg font-semibold">Image Tool Settings</h3>}
				className="w-11/12 max-w-3xl"
			>
				<div className="space-y-4">
					<div className="space-y-2">
						<label className="text-[10px] uppercase font-bold text-base-content/40 ml-1">Default Image Models (priority order)</label>
						<div className="space-y-1.5">
							{defaultImageModels.map((model, index) => (
								<div key={`${model}-${index}`} className="flex items-center gap-1.5 p-2 bg-base-300/30 rounded-lg border border-base-content/5">
									<span className="text-[10px] font-mono text-base-content/60 w-5 text-center">{index + 1}</span>
									<span className="font-mono text-xs flex-1 truncate">{model}</span>
									<button
										onClick={() => moveModel(index, -1)}
										className="btn btn-xs btn-ghost btn-square"
										disabled={index === 0}
										title="Move up"
									>
										↑
									</button>
									<button
										onClick={() => moveModel(index, 1)}
										className="btn btn-xs btn-ghost btn-square"
										disabled={index === defaultImageModels.length - 1}
										title="Move down"
									>
										↓
									</button>
									<button
										onClick={() => removeModel(index)}
										className="btn btn-xs btn-ghost btn-square text-error"
										title="Remove"
									>
										✕
									</button>
								</div>
							))}
						</div>
						<div className="flex gap-1.5 mt-2">
							<input
								type="text"
								placeholder="provider/model-id"
								className="input input-xs input-bordered flex-1 font-mono text-[10px]"
								value={newModel}
								onChange={e => setNewModel(e.target.value)}
								onKeyDown={e => e.key === 'Enter' && addModel()}
							/>
							<button onClick={addModel} className="btn btn-xs btn-outline">Add</button>
						</div>
					</div>
					<FunctionRulesSection
						config={config}
						availableFunctions={availableFunctions}
						onFunctionChange={toggleFunction}
					/>
				</div>
			</Modal>
		</div>
	)
}

function InternalToolCard({
	id,
	label,
	config,
	availableFunctions,
	onChange
}: {
	id: string
	label: string
	config: InternalToolConfig
	availableFunctions: string[]
	onChange: (c: InternalToolConfig) => void
}) {
	const [isModalOpen, setIsModalOpen] = useState(false)

	const toggleFunction = (fnName: string, fnConfig: ToolFunctionConfig) => {
		const updatedFns = { ...(config.functions || {}), [fnName]: fnConfig }
		onChange({ ...config, functions: updatedFns })
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
				<div className="text-[10px] text-base-content/50 flex items-center justify-between pt-1 border-t border-base-content/5">
					<span>{availableFunctions.length} functions available</span>
					<button
						onClick={() => setIsModalOpen(true)}
						className="btn btn-xs btn-ghost"
						disabled={!config.enabled}
					>
						Edit Details
					</button>
				</div>
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				title={<h3 className="text-lg font-semibold">{id} Tool Settings</h3>}
				className="w-11/12 max-w-3xl"
			>
				<FunctionRulesSection
					config={config}
					availableFunctions={availableFunctions}
					onFunctionChange={toggleFunction}
				/>
			</Modal>
		</div>
	)
}

function McpServerCard({
	serverId,
	name,
	config,
	allMcpServers,
	onChange,
	onRemove,
	onSaveAll,
}: {
	serverId: string
	name: string
	config: McpServerConfig
	allMcpServers: Record<string, McpServerConfig>
	onChange: (c: McpServerConfig) => void
	onRemove: () => void
	onSaveAll: (overrides: { mcpServers: Record<string, McpServerConfig> }) => Promise<void>
}) {
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [draft, setDraft] = useState<McpServerConfig>(config)

	const openModal = () => {
		setDraft(config)
		setIsModalOpen(true)
	}

	const saveModal = () => {
		onChange(draft)
		setIsModalOpen(false)
		// Auto-persist to server
		const updatedServers = { ...allMcpServers, [serverId]: draft }
		onSaveAll({ mcpServers: updatedServers })
	}

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
							<div className="font-mono text-sm text-base-content/70 truncate">{config.label || 'No label'}</div>
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

				<div className="text-[10px] text-base-content/50 flex items-center justify-between pt-1 border-t border-base-content/5">
					<span>{config.transport === 'stdio' ? 'Local stdio transport' : 'Remote HTTP transport'}</span>
					<button data-testid="mcp-edit-btn" onClick={openModal} className="btn btn-xs btn-ghost">Edit Details</button>
				</div>
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				title={<h3 className="text-lg font-semibold">MCP Server Settings</h3>}
				className="w-11/12 max-w-3xl"
				footer={
					<div className="flex justify-end gap-2">
						<button data-testid="mcp-modal-cancel" onClick={() => setIsModalOpen(false)} className="btn btn-sm btn-ghost">Cancel</button>
						<button data-testid="mcp-modal-save" onClick={saveModal} className="btn btn-sm btn-success">Save</button>
					</div>
				}
			>
				<div className="space-y-3">
					<div className="form-control">
						<label className="label"><span className="label-text text-xs uppercase font-bold text-base-content/50">Label</span></label>
						<input
							data-testid="mcp-label-input"
							type="text"
							placeholder="e.g. Memory Server"
							className="input input-sm input-bordered w-full font-mono text-xs"
							value={draft.label || ''}
							onChange={e => setDraft({ ...draft, label: e.target.value })}
						/>
					</div>

					<div className="form-control">
						<label className="label"><span className="label-text text-xs uppercase font-bold text-base-content/50">Transport</span></label>
						<select
							data-testid="mcp-transport-select"
							className="select select-sm select-bordered font-mono w-full text-xs"
							value={draft.transport}
							onChange={e => setDraft({ ...draft, transport: e.target.value as 'stdio' | 'http' })}
						>
							<option value="stdio">Local Process (Stdio)</option>
							<option value="http">Remote Server (HTTP / SSE)</option>
						</select>
					</div>

					{draft.transport === 'stdio' ? (
						<>
							<div className="form-control">
								<label className="label"><span className="label-text text-xs uppercase font-bold text-base-content/50">Command</span></label>
								<input
									data-testid="mcp-command-input"
									type="text"
									placeholder="e.g. npx"
									className="input input-sm input-bordered w-full font-mono text-xs"
									value={draft.command || ''}
									onChange={e => setDraft({ ...draft, command: e.target.value })}
								/>
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text text-xs uppercase font-bold text-base-content/50">Args</span></label>
								<textarea
									data-testid="mcp-args-input"
									placeholder="e.g. -y, @modelcontextprotocol/server-memory"
									className="textarea textarea-bordered textarea-sm w-full font-mono min-h-15"
									value={(draft.args || []).join('\n')}
									onChange={e => {
										const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean)
										setDraft({ ...draft, args: lines })
									}}
								/>
								<p className="text-[10px] text-base-content/40 mt-1">One argument per line</p>
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text text-xs uppercase font-bold text-base-content/50">Env Vars</span></label>
								<textarea
									data-testid="mcp-env-input"
									placeholder="e.g. API_KEY=abc123"
									className="textarea textarea-bordered textarea-sm w-full font-mono min-h-15"
									value={Object.entries(draft.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
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
										setDraft({ ...draft, env: Object.keys(env).length ? env : undefined })
									}}
								/>
								<p className="text-[10px] text-base-content/40 mt-1">KEY=VALUE, one per line</p>
							</div>
						</>
					) : (
						<>
							<div className="form-control">
								<label className="label"><span className="label-text text-xs uppercase font-bold text-base-content/50">SSE URL</span></label>
								<input
									data-testid="mcp-url-input"
									type="text"
									placeholder="https://my-server.com/mcp/sse"
									className="input input-sm input-bordered w-full font-mono text-xs"
									value={draft.url || ''}
									onChange={e => setDraft({ ...draft, url: e.target.value })}
								/>
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text text-xs uppercase font-bold text-base-content/50">Headers</span></label>
								<textarea
									data-testid="mcp-headers-input"
									placeholder="e.g. Authorization=Bearer abc"
									className="textarea textarea-bordered textarea-sm w-full font-mono min-h-15"
									value={Object.entries(draft.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
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
										setDraft({ ...draft, headers: Object.keys(headers).length ? headers : undefined })
									}}
								/>
								<p className="text-[10px] text-base-content/40 mt-1">KEY=VALUE, one per line</p>
							</div>
						</>
					)}
				</div>
			</Modal>
		</div>
	)
}

export default function ToolsPage() {
	const [internalTools, setInternalTools] = useState<Record<string, InternalToolConfig>>({})
	const [availableInternalTools, setAvailableInternalTools] = useState<Record<string, string>>({})
	const [availableFunctions, setAvailableFunctions] = useState<Record<string, string[]>>({})
	const [defaultImageModels, setDefaultImageModels] = useState<string[]>([])
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
				setAvailableFunctions(d.availableFunctions || {})
				setDefaultImageModels(d.defaultImageModels || [])
				setEmails(d.emails || {})
				setMcpServers(d.mcpServers || {})
			})
	}, [])

	const save = async (overrides?: {
		internalTools?: Record<string, InternalToolConfig>
		mcpServers?: Record<string, McpServerConfig>
		emails?: Record<string, EmailAccountConfig>
		defaultImageModels?: string[]
	}) => {
		setSaving(true)
		await fetch('/api/tools', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				internalTools: overrides?.internalTools ?? internalTools,
				mcpServers: overrides?.mcpServers ?? mcpServers,
				emails: overrides?.emails ?? emails,
				defaultImageModels: overrides?.defaultImageModels ?? defaultImageModels,
			}),
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
					data-testid="tools-save-btn"
					onClick={() => save()}
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
					<button data-testid="add-email-btn" onClick={addEmailAccount} className="btn btn-sm btn-info">+ Add Account</button>
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
								emailId={id}
								config={config}
								allEmails={emails}
								onChange={(u) => updateEmailAccount(id, u)}
								onRemove={() => removeEmailAccount(id)}
								onSaveAll={save}
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
						availableFunctions={availableFunctions['gemini'] || []}
						onChange={(u) => updateInternalTool('gemini', u)}
					/>

					<ImageToolCard
						config={internalTools['image'] || { enabled: true }}
						availableFunctions={availableFunctions['image'] || []}
						defaultImageModels={defaultImageModels}
						onChange={(u) => updateInternalTool('image', u)}
						onModelsChange={setDefaultImageModels}
					/>

					{/* Other Internal Tools */}
					{Object.entries(availableInternalTools).filter(([id]) => id !== 'gemini' && id !== 'email' && id !== 'image').map(([id, label]) => (
						<InternalToolCard
							key={id}
							id={id}
							label={label}
							config={internalTools[id] || { enabled: true }}
							availableFunctions={availableFunctions[id] || []}
							onChange={(u) => updateInternalTool(id, u)}
						/>
					))}
				</div>
			</section>

			<section className="space-y-6">
				<div className="border-b-2 border-success/20 pb-4 flex justify-between items-end">
					<h2 className="text-2xl font-black flex items-center gap-3 uppercase">MCP Integrations</h2>
					<button data-testid="add-mcp-btn" onClick={addMcpServer} className="btn btn-sm btn-success">+ Add MCP Server</button>
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
								serverId={id}
								name={id}
								config={config}
								allMcpServers={mcpServers}
								onChange={(u) => updateMcpServer(id, u)}
								onRemove={() => removeMcpServer(id)}
								onSaveAll={save}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	)
}
