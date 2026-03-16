'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'ollama'

const PROVIDERS: Record<ProviderType, { label: string; icon: string; keyPlaceholder: string }> = {
	openai: { label: 'OpenAI', icon: '🧠', keyPlaceholder: 'sk-...' },
	anthropic: { label: 'Anthropic', icon: '💡', keyPlaceholder: 'sk-ant-...' },
	google: { label: 'Google (Gemini)', icon: '🤖', keyPlaceholder: 'AIza...' },
	openrouter: { label: 'OpenRouter', icon: '🔀', keyPlaceholder: 'sk-or-...' },
	ollama: { label: 'Ollama (Local)', icon: '🦙', keyPlaceholder: 'No key needed' },
}

const ARCHETYPES = [
	{ id: 'friendly', label: 'Friendly Assistant', icon: '☀️', vibe: 'Warm, approachable, encouraging' },
	{ id: 'sharp', label: 'Sharp Advisor', icon: '⚡', vibe: 'Direct, analytical, efficient' },
	{ id: 'playful', label: 'Playful Sidekick', icon: '🎪', vibe: 'Fun, creative, witty' },
	{ id: 'calm', label: 'Calm Sage', icon: '🌊', vibe: 'Patient, thoughtful, measured' },
	{ id: 'empathetic', label: 'Empathetic Listener', icon: '💜', vibe: 'Understanding, supportive, caring' },
	{ id: 'mentor', label: 'Steady Mentor', icon: '🧭', vibe: 'Guiding, structured, educational' },
	{ id: 'butler', label: 'Loyal Butler', icon: '🎩', vibe: 'Formal, reliable, discreet' },
	{ id: 'hype', label: 'Hype Friend', icon: '🔥', vibe: 'Energetic, motivating, bold' },
]

const COMM_STYLES = [
	{ id: 'casual', label: 'Casual', icon: '💬' },
	{ id: 'direct', label: 'Direct', icon: '⚡' },
	{ id: 'professional', label: 'Professional', icon: '👔' },
	{ id: 'mirror', label: 'Mirror (match me)', icon: '🪞' },
	{ id: 'minimal', label: 'Minimal', icon: '📏' },
]

type Step = 'welcome' | 'model' | 'agent' | 'user' | 'channels' | 'complete'
const STEPS: Step[] = ['welcome', 'model', 'agent', 'user', 'channels', 'complete']

function ModelTierSelector({
	label,
	description,
	icon,
	selectedModels,
	availableModels,
	onAdd,
	onRemove,
}: {
	label: string
	description: string
	icon: string
	selectedModels: string[]
	availableModels: { id: string; name: string }[]
	onAdd: (modelId: string) => void
	onRemove: (modelId: string) => void
}) {
	const unselected = availableModels.filter(m => !selectedModels.includes(m.id))

	return (
		<div className="p-4 bg-base-200 border border-base-300 rounded-xl space-y-3">
			<div className="flex items-center gap-2">
				<span className="text-xl">{icon}</span>
				<div>
					<div className="font-semibold text-sm">{label}</div>
					<div className="text-xs text-base-content/50">{description}</div>
				</div>
			</div>

			{/* Selected models */}
			{selectedModels.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{selectedModels.map((modelId, i) => (
						<div key={modelId} className="badge badge-primary gap-1 py-3 px-3">
							<span className="text-xs opacity-50">{i + 1}.</span>
							<span className="text-xs font-mono">{modelId}</span>
							<button
								className="ml-1 hover:text-error"
								onClick={() => onRemove(modelId)}
							>✕</button>
						</div>
					))}
				</div>
			)}

			{/* Add model dropdown */}
			{availableModels.length > 0 ? (
				<select
					className="select select-bordered select-sm w-full font-mono text-xs"
					value=""
					onChange={e => {
						if (e.target.value) onAdd(e.target.value)
					}}
				>
					<option value="">+ Add a model...</option>
					{unselected.map(m => (
						<option key={m.id} value={m.id}>
							{m.name !== m.id ? `${m.name} (${m.id})` : m.id}
						</option>
					))}
				</select>
			) : (
				<input
					type="text"
					className="input input-bordered input-sm w-full font-mono text-xs"
					placeholder="Type a model ID and press Enter"
					onKeyDown={e => {
						if (e.key === 'Enter') {
							const val = (e.target as HTMLInputElement).value.trim()
							if (val && !selectedModels.includes(val)) {
								onAdd(val)
									; (e.target as HTMLInputElement).value = ''
							}
						}
					}}
				/>
			)}
		</div>
	)
}

export default function OnboardingPage() {
	const router = useRouter()
	const [step, setStep] = useState<Step>('welcome')
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')

	// Model step
	const [provider, setProvider] = useState<ProviderType | ''>('')
	const [apiKey, setApiKey] = useState('')
	const [nickname, setNickname] = useState('')
	const [modelConnected, setModelConnected] = useState(false)

	// Model selection step (after connection)
	const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([])
	const [loadingModels, setLoadingModels] = useState(false)
	const [normalModels, setNormalModels] = useState<string[]>([])
	const [smartModels, setSmartModels] = useState<string[]>([])

	// Agent step
	const [agentName, setAgentName] = useState('')
	const [archetype, setArchetype] = useState('friendly')
	const [emoji, setEmoji] = useState('🐿️')

	// User step
	const [userName, setUserName] = useState('')
	const [userContext, setUserContext] = useState('')
	const [commStyle, setCommStyle] = useState('casual')

	// Channels step
	const [discordToken, setDiscordToken] = useState('')
	const [telegramToken, setTelegramToken] = useState('')

	// Complete step
	const [dashboardToken, setDashboardToken] = useState('')

	const stepIndex = STEPS.indexOf(step)
	const progress = Math.round(((stepIndex) / (STEPS.length - 1)) * 100)

	const next = () => {
		const idx = STEPS.indexOf(step)
		if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
	}
	const prev = () => {
		const idx = STEPS.indexOf(step)
		if (idx > 0) setStep(STEPS[idx - 1])
	}

	const saveModel = async () => {
		if (!provider || !nickname) return
		setSaving(true)
		setError('')
		try {
			const conn: Record<string, unknown> = { nickname, provider }
			if (provider !== 'ollama' && apiKey) {
				conn.apiKey = apiKey
			}
			const res = await fetch('/api/models', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					connections: [conn],
					defaultModels: [],
					defaultConnection: nickname,
				}),
			})
			if (!res.ok) throw new Error(await res.text())
			setModelConnected(true)

			// Fetch available models from this provider
			setLoadingModels(true)
			try {
				const modelsRes = await fetch('/api/models/available', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ provider, apiKey, nickname }),
				})
				if (modelsRes.ok) {
					const { models } = await modelsRes.json()
					setAvailableModels(models || [])
				}
			} catch {
				// Non-fatal — user can still type models manually
			} finally {
				setLoadingModels(false)
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to save connection')
		} finally {
			setSaving(false)
		}
	}

	const saveModelSelections = async () => {
		if (normalModels.length === 0 && smartModels.length === 0) {
			next()
			return
		}
		setSaving(true)
		setError('')
		try {
			const selectedModels = [...new Set([...normalModels, ...smartModels])]
			const conn: Record<string, unknown> = { nickname, provider, selectedModels }
			if (provider !== 'ollama' && apiKey) {
				conn.apiKey = apiKey
			}
			const defaultModelsFormatted = normalModels.map(m => `${nickname}/${m}`)
			const smartModelsFormatted = smartModels.map(m => `${nickname}/${m}`)

			const res = await fetch('/api/models', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					connections: [conn],
					defaultModels: defaultModelsFormatted,
					smartModels: smartModelsFormatted,
					defaultConnection: nickname,
				}),
			})
			if (!res.ok) throw new Error(await res.text())
			next()
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to save model selections')
		} finally {
			setSaving(false)
		}
	}

	const saveIdentity = async () => {
		if (!agentName || !userName) return
		setSaving(true)
		setError('')
		try {
			const res = await fetch('/api/onboarding/identity', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					agentName,
					archetype: ARCHETYPES.find(a => a.id === archetype)?.label || archetype,
					emoji,
					userName,
					communicationStyle: COMM_STYLES.find(s => s.id === commStyle)?.label || commStyle,
					userContext,
				}),
			})
			if (!res.ok) throw new Error(await res.text())
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to save identity')
			setSaving(false)
			return
		}
		setSaving(false)
	}

	const saveChannels = async () => {
		setSaving(true)
		setError('')
		try {
			if (discordToken || telegramToken) {
				const config = await fetch('/api/channels').then(r => r.json())
				const bridges = config.bridges || {}

				if (discordToken) {
					bridges.discord = bridges.discord || {}
					bridges.discord.default = {
						...(bridges.discord.default || {}),
						enabled: true,
						token: discordToken,
					}
				}
				if (telegramToken) {
					bridges.telegram = bridges.telegram || {}
					bridges.telegram.default = {
						...(bridges.telegram.default || {}),
						enabled: true,
						token: telegramToken,
					}
				}

				await fetch('/api/channels', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ bridges }),
				})
			}
		} catch (e) {
			// Non-fatal — channels are optional
			console.error('Channel save error:', e)
		}
		setSaving(false)
	}

	const completeOnboarding = async () => {
		setSaving(true)
		setError('')
		try {
			const res = await fetch('/api/onboarding/complete', { method: 'POST' })
			if (!res.ok) throw new Error(await res.text())
			const data = await res.json()
			setDashboardToken(data.token || '')
			setStep('complete')
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to complete onboarding')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="min-h-screen flex flex-col items-center justify-center bg-base-100 p-4">
			<div className="w-full max-w-2xl">
				{/* Progress bar */}
				{step !== 'welcome' && step !== 'complete' && (
					<div className="mb-8">
						<progress className="progress progress-primary w-full" value={progress} max="100" />
						<div className="flex justify-between text-xs text-base-content/50 mt-1">
							{STEPS.filter(s => s !== 'welcome' && s !== 'complete').map(s => (
								<span key={s} className={step === s ? 'text-primary font-bold' : ''}>
									{s.charAt(0).toUpperCase() + s.slice(1)}
								</span>
							))}
						</div>
					</div>
				)}

				{error && (
					<div className="alert alert-error mb-4">
						<span>{error}</span>
						<button className="btn btn-ghost btn-xs" onClick={() => setError('')}>✕</button>
					</div>
				)}

				{/* WELCOME */}
				{step === 'welcome' && (
					<div className="text-center space-y-6">
						<div className="text-6xl">🐿️</div>
						<h1 className="text-4xl font-bold">Welcome to Tamias</h1>
						<p className="text-lg text-base-content/70 max-w-md mx-auto">
							Your autonomous AI assistant. Let&apos;s get you set up in a few quick steps.
						</p>
						<button className="btn btn-primary btn-lg" onClick={next}>
							Get Started →
						</button>
					</div>
				)}

				{/* MODEL CONNECTION */}
				{step === 'model' && (
					<div className="space-y-6">
						<div>
							<h2 className="text-2xl font-bold">
								{modelConnected ? 'Select Your Models' : 'Connect an AI Model'}
							</h2>
							<p className="text-base-content/60 mt-1">
								{modelConnected
									? 'Choose which models to use for everyday tasks and complex work'
									: 'Choose a provider and enter your API key'}
							</p>
						</div>

						{!modelConnected ? (
							<>
								{/* Provider selector */}
								<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
									{(Object.entries(PROVIDERS) as [ProviderType, typeof PROVIDERS[ProviderType]][]).map(([key, p]) => (
										<button
											key={key}
											className={`card p-3 text-center cursor-pointer transition-all border-2 ${provider === key
												? 'border-primary bg-primary/10'
												: 'border-base-300 hover:border-primary/50'
												}`}
											onClick={() => {
												setProvider(key)
												if (!nickname) setNickname(key)
											}}
										>
											<span className="text-2xl">{p.icon}</span>
											<span className="text-sm font-medium mt-1">{p.label}</span>
										</button>
									))}
								</div>

								{provider && (
									<div className="space-y-4 animate-in fade-in">
										<div className="form-control">
											<label className="label"><span className="label-text">Connection Nickname</span></label>
											<input
												type="text"
												className="input input-bordered w-full"
												placeholder="e.g. my-openai"
												value={nickname}
												onChange={e => setNickname(e.target.value.replace(/\s/g, '-'))}
											/>
										</div>

										{provider !== 'ollama' && (
											<div className="form-control">
												<label className="label"><span className="label-text">API Key</span></label>
												<input
													type="password"
													className="input input-bordered w-full font-mono"
													placeholder={PROVIDERS[provider].keyPlaceholder}
													value={apiKey}
													onChange={e => setApiKey(e.target.value)}
												/>
											</div>
										)}

										<button
											className="btn btn-primary w-full"
											disabled={!nickname || (provider !== 'ollama' && !apiKey) || saving}
											onClick={saveModel}
										>
											{saving ? <span className="loading loading-spinner loading-sm" /> : 'Connect & Fetch Models'}
										</button>
									</div>
								)}
							</>
						) : (
							<div className="space-y-6 animate-in fade-in">
								{/* Connection summary */}
								<div className="flex items-center gap-3 p-3 bg-success/10 border border-success/30 rounded-lg">
									<span className="text-xl">{PROVIDERS[provider as ProviderType]?.icon}</span>
									<div>
										<div className="font-medium text-sm">{PROVIDERS[provider as ProviderType]?.label}</div>
										<div className="text-xs text-base-content/50">Connected as &quot;{nickname}&quot;</div>
									</div>
									<span className="text-success ml-auto">✓</span>
								</div>

								{loadingModels ? (
									<div className="flex items-center justify-center gap-2 p-8">
										<span className="loading loading-spinner loading-md" />
										<span className="text-base-content/60">Fetching available models...</span>
									</div>
								) : (
									<>
										{/* Normal Models */}
										<ModelTierSelector
											label="Normal Models"
											description="For everyday tasks — chat, summaries, quick answers"
											icon="💬"
											selectedModels={normalModels}
											availableModels={availableModels}
											onAdd={(modelId) => setNormalModels([...normalModels, modelId])}
											onRemove={(modelId) => setNormalModels(normalModels.filter(m => m !== modelId))}
										/>

										{/* Smart Models */}
										<ModelTierSelector
											label="Smart Models"
											description="For complex tasks — coding, deep analysis, prolonged thinking"
											icon="🧠"
											selectedModels={smartModels}
											availableModels={availableModels}
											onAdd={(modelId) => setSmartModels([...smartModels, modelId])}
											onRemove={(modelId) => setSmartModels(smartModels.filter(m => m !== modelId))}
										/>

										<button
											className="btn btn-primary w-full"
											disabled={saving}
											onClick={saveModelSelections}
										>
											{saving ? <span className="loading loading-spinner loading-sm" /> : 'Save & Continue →'}
										</button>
									</>
								)}

								<button
									className="btn btn-ghost btn-sm"
									onClick={() => {
										setModelConnected(false)
										setAvailableModels([])
										setNormalModels([])
										setSmartModels([])
									}}
								>
									← Change provider
								</button>
							</div>
						)}

						<div className="flex justify-between pt-4">
							<button className="btn btn-ghost" onClick={prev}>← Back</button>
							{modelConnected && (
								<button className="btn btn-ghost" onClick={next}>
									Skip model selection →
								</button>
							)}
						</div>
					</div>
				)}

				{/* AGENT IDENTITY */}
				{step === 'agent' && (
					<div className="space-y-6">
						<div>
							<h2 className="text-2xl font-bold">Name Your Agent</h2>
							<p className="text-base-content/60 mt-1">Give your AI a name and personality</p>
						</div>

						<div className="form-control">
							<label className="label"><span className="label-text">Agent Name</span></label>
							<div className="flex gap-2">
								<input
									type="text"
									className="input input-bordered flex-1"
									placeholder="e.g. Nova, Chip, Atlas..."
									value={agentName}
									onChange={e => setAgentName(e.target.value)}
								/>
								<input
									type="text"
									className="input input-bordered w-16 text-center text-2xl"
									value={emoji}
									onChange={e => setEmoji(e.target.value)}
									maxLength={4}
									title="Agent emoji"
								/>
							</div>
						</div>

						<div>
							<label className="label"><span className="label-text">Personality</span></label>
							<div className="grid grid-cols-2 gap-2">
								{ARCHETYPES.map(a => (
									<button
										key={a.id}
										className={`p-3 rounded-lg text-left transition-all border-2 ${archetype === a.id
											? 'border-primary bg-primary/10'
											: 'border-base-300 hover:border-primary/50'
											}`}
										onClick={() => setArchetype(a.id)}
									>
										<div className="flex items-center gap-2">
											<span className="text-xl">{a.icon}</span>
											<span className="font-medium text-sm">{a.label}</span>
										</div>
										<p className="text-xs text-base-content/50 mt-1">{a.vibe}</p>
									</button>
								))}
							</div>
						</div>

						<div className="flex justify-between pt-4">
							<button className="btn btn-ghost" onClick={prev}>← Back</button>
							<button
								className="btn btn-primary"
								disabled={!agentName}
								onClick={next}
							>
								Continue →
							</button>
						</div>
					</div>
				)}

				{/* USER PROFILE */}
				{step === 'user' && (
					<div className="space-y-6">
						<div>
							<h2 className="text-2xl font-bold">About You</h2>
							<p className="text-base-content/60 mt-1">Help your agent understand how to communicate with you</p>
						</div>

						<div className="form-control">
							<label className="label"><span className="label-text">Your Name</span></label>
							<input
								type="text"
								className="input input-bordered w-full"
								placeholder="What should the agent call you?"
								value={userName}
								onChange={e => setUserName(e.target.value)}
							/>
						</div>

						<div className="form-control">
							<label className="label"><span className="label-text">About You (optional)</span></label>
							<textarea
								className="textarea textarea-bordered w-full h-24"
								placeholder="e.g. I'm a developer working on SaaS products. I prefer concise answers..."
								value={userContext}
								onChange={e => setUserContext(e.target.value)}
							/>
						</div>

						<div>
							<label className="label"><span className="label-text">Communication Style</span></label>
							<div className="flex flex-wrap gap-2">
								{COMM_STYLES.map(s => (
									<button
										key={s.id}
										className={`btn btn-sm ${commStyle === s.id ? 'btn-primary' : 'btn-outline'}`}
										onClick={() => setCommStyle(s.id)}
									>
										{s.icon} {s.label}
									</button>
								))}
							</div>
						</div>

						<div className="flex justify-between pt-4">
							<button className="btn btn-ghost" onClick={prev}>← Back</button>
							<button
								className="btn btn-primary"
								disabled={!userName || saving}
								onClick={async () => {
									await saveIdentity()
									next()
								}}
							>
								{saving ? <span className="loading loading-spinner loading-sm" /> : 'Continue →'}
							</button>
						</div>
					</div>
				)}

				{/* CHANNELS */}
				{step === 'channels' && (
					<div className="space-y-6">
						<div>
							<h2 className="text-2xl font-bold">Connect Channels</h2>
							<p className="text-base-content/60 mt-1">
								Optional — add Discord or Telegram bot tokens. You can always do this later from the dashboard.
							</p>
						</div>

						<div className="space-y-4">
							<div className="collapse collapse-arrow bg-base-200 border border-base-300">
								<input type="checkbox" />
								<div className="collapse-title font-medium flex items-center gap-2">
									🎮 Discord Bot
								</div>
								<div className="collapse-content">
									<div className="form-control">
										<label className="label"><span className="label-text">Bot Token</span></label>
										<input
											type="password"
											className="input input-bordered w-full font-mono"
											placeholder="Paste your Discord bot token"
											value={discordToken}
											onChange={e => setDiscordToken(e.target.value)}
										/>
										<label className="label">
											<span className="label-text-alt text-base-content/50">
												Get one from <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="link link-primary">discord.com/developers</a>
											</span>
										</label>
									</div>
								</div>
							</div>

							<div className="collapse collapse-arrow bg-base-200 border border-base-300">
								<input type="checkbox" />
								<div className="collapse-title font-medium flex items-center gap-2">
									✈️ Telegram Bot
								</div>
								<div className="collapse-content">
									<div className="form-control">
										<label className="label"><span className="label-text">Bot Token</span></label>
										<input
											type="password"
											className="input input-bordered w-full font-mono"
											placeholder="Paste your Telegram bot token"
											value={telegramToken}
											onChange={e => setTelegramToken(e.target.value)}
										/>
										<label className="label">
											<span className="label-text-alt text-base-content/50">
												Get one from <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="link link-primary">@BotFather</a>
											</span>
										</label>
									</div>
								</div>
							</div>
						</div>

						<div className="flex justify-between pt-4">
							<button className="btn btn-ghost" onClick={prev}>← Back</button>
							<div className="flex gap-2">
								<button
									className="btn btn-ghost"
									onClick={async () => {
										await completeOnboarding()
									}}
								>
									Skip for now
								</button>
								<button
									className="btn btn-primary"
									disabled={saving}
									onClick={async () => {
										await saveChannels()
										await completeOnboarding()
									}}
								>
									{saving ? <span className="loading loading-spinner loading-sm" /> : 'Complete Setup'}
								</button>
							</div>
						</div>
					</div>
				)}

				{/* COMPLETE */}
				{step === 'complete' && (
					<div className="text-center space-y-6">
						<div className="text-6xl">{emoji}</div>
						<h2 className="text-3xl font-bold">You&apos;re All Set!</h2>
						<p className="text-lg text-base-content/70">
							<strong>{agentName}</strong> is ready to help you.
						</p>

						{dashboardToken && (
							<div className="alert bg-base-200 text-left">
								<div>
									<div className="text-sm font-bold mb-1">🔑 Dashboard Token</div>
									<code className="text-xs break-all select-all">{dashboardToken}</code>
									<p className="text-xs text-base-content/50 mt-1">
										Save this token — you&apos;ll need it to access the dashboard later.
									</p>
								</div>
							</div>
						)}

						<button
							className="btn btn-primary btn-lg"
							onClick={() => {
								window.location.href = dashboardToken ? `/?token=${dashboardToken}` : '/'
							}}
						>
							Open Dashboard →
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
