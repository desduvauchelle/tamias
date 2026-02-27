'use client'

import { useState, useEffect } from 'react'

export type BotInstanceConfig = {
	enabled: boolean
	botToken?: string
	allowedChannels?: string[]
	allowedChats?: string[]
	mode?: 'full' | 'mention-only' | 'listen-only'
}

export type BridgesConfig = {
	terminal: { enabled: boolean }
	discords: Record<string, BotInstanceConfig>
	telegrams: Record<string, BotInstanceConfig>
}

const DEFAULT_BRIDGES: BridgesConfig = {
	terminal: { enabled: true },
	discords: {},
	telegrams: {},
}

// ─── Reusable Bot Card ────────────────────────────────────────────────────────

function BotCard({
	platform,
	instanceKey,
	config,
	onChange,
	onRemove,
}: {
	platform: 'discord' | 'telegram'
	instanceKey: string
	config: BotInstanceConfig
	onChange: (updated: BotInstanceConfig) => void
	onRemove: () => void
}) {
	const isDiscord = platform === 'discord'
	const accentClass = isDiscord ? 'border-indigo-500' : 'border-sky-500'
	const iconBgClass = isDiscord ? 'bg-indigo-500/20 text-indigo-400' : 'bg-sky-500/20 text-sky-400'
	const toggleClass = isDiscord ? 'toggle-primary' : 'toggle-primary'
	const icon = isDiscord ? '🎮' : '✈️'
	const title = isDiscord ? 'Discord Gateway' : 'Telegram Gateway'
	const allowLabel = isDiscord ? 'Allowed Channels' : 'Allowed Chats'
	const allowPlaceholder = isDiscord ? '123456789012345678' : '-1001234567890'
	const allowHint = isDiscord
		? 'One strictly numeric Discord channel ID per line. Leave empty to allow everywhere the bot is.'
		: 'One numeric Telegram chat ID per line. Leave empty to allow everywhere the bot is.'
	const allowValue = isDiscord
		? (config.allowedChannels ?? []).join('\n')
		: (config.allowedChats ?? []).join('\n')
	const modeValue = config.mode ?? 'full'

	const handleAllowChange = (raw: string) => {
		const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
		if (isDiscord) {
			onChange({ ...config, allowedChannels: lines })
		} else {
			onChange({ ...config, allowedChats: lines })
		}
	}

	return (
		<div className={`card bg-base-200 border ${config.enabled ? accentClass : 'border-base-300 opacity-70'} transition-all`}>
			<div className="card-body p-6">
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-4">
						<div className={`w-12 h-12 ${iconBgClass} rounded-xl flex items-center justify-center text-3xl`}>{icon}</div>
						<div>
							<h2 className="text-xl font-bold font-sans">{title}</h2>
							<p className="text-xs text-base-content/50 uppercase tracking-widest mt-1 font-bold">
								Instance: <span className="text-base-content/70">{instanceKey}</span>
							</p>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<input
							type="checkbox"
							className={`toggle ${toggleClass}`}
							checked={config.enabled}
							onChange={e => onChange({ ...config, enabled: e.target.checked })}
						/>
						<button
							onClick={onRemove}
							className="btn btn-ghost btn-sm text-error hover:bg-error/10"
							title="Remove this instance"
						>
							🗑
						</button>
					</div>
				</div>

				<div className="space-y-4 pt-4 border-t border-base-300/50">
					<div className="flex items-center gap-4">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-32 shrink-0">Bot Token</span>
						<input
							type="password"
							placeholder={isDiscord ? 'MTI...' : '1234567890:ABC...'}
							className="input input-sm input-bordered w-full font-mono text-xs"
							value={config.botToken || ''}
							onChange={e => onChange({ ...config, botToken: e.target.value })}
						/>
					</div>
					<div className="flex items-start gap-4">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-32 shrink-0 mt-2">{allowLabel}</span>
						<div className="flex-1">
							<textarea
								placeholder={allowPlaceholder}
								className="textarea textarea-bordered textarea-sm w-full font-mono"
								value={allowValue}
								onChange={e => handleAllowChange(e.target.value)}
								rows={3}
							/>
							<p className="text-[10px] text-base-content/40 mt-1">{allowHint}</p>
						</div>
					</div>
					<div className="flex items-center gap-4">
						<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-32 shrink-0">Reply Mode</span>
						<select
							className="select select-sm select-bordered w-full"
							value={modeValue}
							onChange={e => onChange({ ...config, mode: e.target.value as BotInstanceConfig['mode'] })}
						>
							<option value="full">Reply to all</option>
							<option value="mention-only">Mentions only</option>
							<option value="listen-only">Listen only</option>
						</select>
					</div>
				</div>
			</div>
		</div>
	)
}

// ─── Add Instance Modal / Prompt ──────────────────────────────────────────────

function AddInstanceInput({ platform, existing, onAdd }: {
	platform: 'discord' | 'telegram'
	existing: string[]
	onAdd: (key: string) => void
}) {
	const [value, setValue] = useState('')
	const [error, setError] = useState('')

	const handleAdd = () => {
		const key = value.trim()
		if (!key) { setError('Name is required'); return }
		if (!/^[a-z0-9_-]+$/i.test(key)) { setError('Letters, numbers, hyphens and underscores only'); return }
		if (existing.includes(key)) { setError(`"${key}" already exists`); return }
		onAdd(key)
		setValue('')
		setError('')
	}

	return (
		<div className="flex items-start gap-2">
			<div className="flex-1">
				<input
					type="text"
					placeholder={`Name (e.g. "default", "community")`}
					className={`input input-sm input-bordered w-full font-mono ${error ? 'input-error' : ''}`}
					value={value}
					onChange={e => { setValue(e.target.value); setError('') }}
					onKeyDown={e => e.key === 'Enter' && handleAdd()}
				/>
				{error && <p className="text-[10px] text-error mt-1">{error}</p>}
			</div>
			<button onClick={handleAdd} className="btn btn-sm btn-outline btn-primary whitespace-nowrap">
				➕ Add {platform === 'discord' ? 'Discord' : 'Telegram'} Bot
			</button>
		</div>
	)
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChannelsPage() {
	const [bridges, setBridges] = useState<BridgesConfig>(DEFAULT_BRIDGES)
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		fetch('/api/channels')
			.then(r => r.json())
			.then(d => {
				const b = d.bridges || DEFAULT_BRIDGES
				const discords = Object.fromEntries(
					Object.entries(b.discords ?? {}).map(([key, cfg]) => [
						key,
						{ ...(cfg as BotInstanceConfig), mode: (cfg as BotInstanceConfig).mode ?? 'full' },
					])
				)
				const telegrams = Object.fromEntries(
					Object.entries(b.telegrams ?? {}).map(([key, cfg]) => [
						key,
						{ ...(cfg as BotInstanceConfig), mode: (cfg as BotInstanceConfig).mode ?? 'full' },
					])
				)
				setBridges({
					terminal: b.terminal ?? { enabled: true },
					discords,
					telegrams,
				})
			})
	}, [])

	const save = async () => {
		setSaving(true)
		await fetch('/api/channels', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bridges }),
		})
		setSaving(false)
		setSaved(true)
		setTimeout(() => setSaved(false), 2000)
	}

	const addDiscord = (key: string) => {
		setBridges(b => ({ ...b, discords: { ...b.discords, [key]: { enabled: true, botToken: '', allowedChannels: [], mode: 'full' } } }))
	}

	const addTelegram = (key: string) => {
		setBridges(b => ({ ...b, telegrams: { ...b.telegrams, [key]: { enabled: true, botToken: '', allowedChats: [], mode: 'full' } } }))
	}

	const removeDiscord = (key: string) => {
		setBridges(b => {
			const { [key]: _, ...rest } = b.discords
			return { ...b, discords: rest }
		})
	}

	const removeTelegram = (key: string) => {
		setBridges(b => {
			const { [key]: _, ...rest } = b.telegrams
			return { ...b, telegrams: rest }
		})
	}

	return (
		<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
			<div className="flex justify-between items-start">
				<div>
					<h1 className="text-3xl font-black text-primary uppercase tracking-tighter">COMMUNICATION CHANNELS</h1>
					<p className="text-base-content/50 text-sm mt-1">Configure where Tamias listens and responds. Multiple bots per platform are supported.</p>
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

			{/* Terminal */}
			<section>
				<h2 className="text-xs font-bold uppercase tracking-widest text-base-content/40 mb-3">Terminal</h2>
				<div className={`card bg-base-200 border ${bridges.terminal.enabled ? 'border-emerald-500' : 'border-base-300 opacity-60'} transition-all`}>
					<div className="card-body p-5 flex-row items-center justify-between">
						<div className="flex items-center gap-4">
							<div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center text-2xl">💻</div>
							<div>
								<h3 className="font-bold font-sans">Terminal / Local CLI</h3>
								<p className="text-xs text-base-content/40">Direct command-line interface</p>
							</div>
						</div>
						<input
							type="checkbox"
							className="toggle toggle-success"
							checked={bridges.terminal.enabled}
							onChange={e => setBridges(b => ({ ...b, terminal: { enabled: e.target.checked } }))}
						/>
					</div>
				</div>
			</section>

			{/* Discord */}
			<section className="space-y-4">
				<h2 className="text-xs font-bold uppercase tracking-widest text-base-content/40">Discord Bots</h2>
				{Object.entries(bridges.discords).map(([key, cfg]) => (
					<BotCard
						key={key}
						platform="discord"
						instanceKey={key}
						config={cfg}
						onChange={updated => setBridges(b => ({ ...b, discords: { ...b.discords, [key]: updated } }))}
						onRemove={() => removeDiscord(key)}
					/>
				))}
				<AddInstanceInput
					platform="discord"
					existing={Object.keys(bridges.discords)}
					onAdd={addDiscord}
				/>
			</section>

			{/* Telegram */}
			<section className="space-y-4">
				<h2 className="text-xs font-bold uppercase tracking-widest text-base-content/40">Telegram Bots</h2>
				{Object.entries(bridges.telegrams).map(([key, cfg]) => (
					<BotCard
						key={key}
						platform="telegram"
						instanceKey={key}
						config={cfg}
						onChange={updated => setBridges(b => ({ ...b, telegrams: { ...b.telegrams, [key]: updated } }))}
						onRemove={() => removeTelegram(key)}
					/>
				))}
				<AddInstanceInput
					platform="telegram"
					existing={Object.keys(bridges.telegrams)}
					onAdd={addTelegram}
				/>
			</section>
		</div>
	)
}
