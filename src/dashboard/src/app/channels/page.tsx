'use client'

import { useState, useEffect } from 'react'

export type DiscordConfig = {
	enabled: boolean
	botToken?: string
	allowedChannels?: string[]
}

export type TelegramConfig = {
	enabled: boolean
	botToken?: string
	allowedChats?: string[]
}

export type BridgesConfig = {
	terminal: { enabled: boolean }
	discord?: DiscordConfig
	telegram?: TelegramConfig
}

export default function ChannelsPage() {
	const [bridges, setBridges] = useState<BridgesConfig>({ terminal: { enabled: true } })
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		fetch('/api/channels')
			.then(r => r.json())
			.then(d => {
				setBridges(d.bridges || { terminal: { enabled: true } })
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

	const enableDiscord = () => {
		setBridges({ ...bridges, discord: { enabled: true, botToken: '', allowedChannels: [] } })
	}

	const enableTelegram = () => {
		setBridges({ ...bridges, telegram: { enabled: true, botToken: '', allowedChats: [] } })
	}

	return (
		<div className="p-6 max-w-4xl max-h-screen overflow-y-auto space-y-12 font-mono pb-24 mx-auto">
			<div className="flex justify-between items-start">
				<div>
					<h1 className="text-3xl font-black text-primary uppercase tracking-tighter">COMMUNICATION CHANNELS</h1>
					<p className="text-base-content/50 text-sm mt-1">Configure where Tamias listens and responds.</p>
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
				{/* Discord Card */}
				<div className={`card bg-base-200 border ${bridges.discord?.enabled ? 'border-indigo-500' : 'border-base-300 opacity-60'} transition-all`}>
					<div className="card-body p-6">
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-4">
								<div className="w-12 h-12 bg-indigo-500/20 text-indigo-400 rounded-xl flex items-center justify-center text-3xl">🎮</div>
								<div>
									<h2 className="text-xl font-bold font-sans">Discord Gateway</h2>
									<p className="text-xs text-base-content/50 uppercase tracking-widest mt-1 font-bold">Bot Integration</p>
								</div>
							</div>
							{bridges.discord ? (
								<input
									type="checkbox"
									className="toggle toggle-primary"
									checked={bridges.discord.enabled}
									onChange={e => setBridges({ ...bridges, discord: { ...bridges.discord!, enabled: e.target.checked } })}
								/>
							) : (
								<button onClick={enableDiscord} className="btn btn-sm btn-outline btn-primary">Enable Option</button>
							)}
						</div>

						{bridges.discord && (
							<div className="space-y-4 pt-4 border-t border-base-300/50">
								<div className="flex items-center gap-4">
									<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-32 shrink-0">Bot Token</span>
									<input
										type="password"
										placeholder="MTI..."
										className="input input-sm input-bordered w-full font-mono text-xs"
										value={bridges.discord.botToken || ''}
										onChange={e => setBridges({ ...bridges, discord: { ...bridges.discord!, botToken: e.target.value } })}
									/>
								</div>
								<div className="flex items-start gap-4">
									<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-32 shrink-0 mt-2">Allowed Channels</span>
									<div className="flex-1">
										<textarea
											placeholder="123456789012345678"
											className="textarea textarea-bordered textarea-sm w-full font-mono"
											value={bridges.discord.allowedChannels?.join('\n') || ''}
											onChange={e => {
												const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean)
												setBridges({ ...bridges, discord: { ...bridges.discord!, allowedChannels: lines } })
											}}
											rows={3}
										/>
										<p className="text-[10px] text-base-content/40 mt-1">One strictly numeric Discord channel ID per line. Leave empty to allow everywhere the bot is.</p>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Telegram Card */}
				<div className={`card bg-base-200 border ${bridges.telegram?.enabled ? 'border-sky-500' : 'border-base-300 opacity-60'} transition-all`}>
					<div className="card-body p-6">
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-4">
								<div className="w-12 h-12 bg-sky-500/20 text-sky-400 rounded-xl flex items-center justify-center text-3xl">✈️</div>
								<div>
									<h2 className="text-xl font-bold font-sans">Telegram Gateway</h2>
									<p className="text-xs text-base-content/50 uppercase tracking-widest mt-1 font-bold">Bot Integration</p>
								</div>
							</div>
							{bridges.telegram ? (
								<input
									type="checkbox"
									className="toggle toggle-primary"
									checked={bridges.telegram.enabled}
									onChange={e => setBridges({ ...bridges, telegram: { ...bridges.telegram!, enabled: e.target.checked } })}
								/>
							) : (
								<button onClick={enableTelegram} className="btn btn-sm btn-outline btn-primary">Enable Option</button>
							)}
						</div>

						{bridges.telegram && (
							<div className="space-y-4 pt-4 border-t border-base-300/50">
								<div className="flex items-center gap-4">
									<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-32 shrink-0">Bot Token</span>
									<input
										type="password"
										placeholder="1234567890:ABC..."
										className="input input-sm input-bordered w-full font-mono text-xs"
										value={bridges.telegram.botToken || ''}
										onChange={e => setBridges({ ...bridges, telegram: { ...bridges.telegram!, botToken: e.target.value } })}
									/>
								</div>
								<div className="flex items-start gap-4">
									<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-32 shrink-0 mt-2">Allowed Chats</span>
									<div className="flex-1">
										<textarea
											placeholder="-1001234567890"
											className="textarea textarea-bordered textarea-sm w-full font-mono"
											value={bridges.telegram.allowedChats?.join('\n') || ''}
											onChange={e => {
												const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean)
												setBridges({ ...bridges, telegram: { ...bridges.telegram!, allowedChats: lines } })
											}}
											rows={3}
										/>
										<p className="text-[10px] text-base-content/40 mt-1">One numeric Telegram chat ID per line. Leave empty to allow everywhere the bot is.</p>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</section>
		</div>
	)
}
