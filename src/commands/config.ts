import * as p from '@clack/prompts'
import pc from 'picocolors'
import { addConnection, ProviderEnum } from '../utils/config'
import { fetchModels } from '../utils/models'

export const runConfigCommand = async () => {
	p.intro(pc.bgCyan(pc.black(' Tamias — Add Model Config ')))

	const providerGroup = await p.group(
		{
			provider: () =>
				p.select({
					message: 'Pick an AI provider to configure:',
					options: [
						{ value: 'openai', label: '⚡ OpenAI' },
						{ value: 'anthropic', label: '🧠 Anthropic' },
						{ value: 'google', label: '♊ Google Gemini' },
						{ value: 'openrouter', label: '🔀 OpenRouter' },
						{ value: 'antigravity', label: '🚀 Antigravity (OAuth)' },
					],
				}),
			credentials: ({ results }) => {
				if (results.provider === 'antigravity') {
					return p.text({
						message: 'Enter your Antigravity Access Token:',
						placeholder: 'ag_...',
						validate: (v) => { if (!v) return 'Access token is required' },
					})
				}
				return p.password({
					message: `Enter your API key for ${results.provider}:`,
					validate: (v) => { if (!v) return 'API key is required' },
				})
			},
			nickname: () =>
				p.text({
					message: 'Give this connection a memorable nickname:',
					placeholder: 'my-work-bot',
					validate: (v) => {
						if (!v) return 'Nickname is required'
						if (/\s/.test(v)) return 'Nickname cannot contain spaces'
					},
				}),
		},
		{
			onCancel: () => {
				p.cancel('Configuration cancelled.')
				process.exit(0)
			},
		}
	)

	const providerType = ProviderEnum.parse(providerGroup.provider)
	const apiKey = providerType !== 'antigravity' ? (providerGroup.credentials as string) : undefined
	const accessToken = providerType === 'antigravity' ? (providerGroup.credentials as string) : undefined

	// Fetch & select models (skip for antigravity)
	let selectedModels: string[] = []

	if (providerType !== 'antigravity' && apiKey) {
		const s = p.spinner()
		s.start(`Fetching available models for ${providerType}...`)
		const models = await fetchModels(providerType, apiKey)
		s.stop(models.length > 0 ? `Found ${models.length} models.` : 'Could not fetch models, you can add them later.')

		if (models.length > 0) {
			console.log(pc.dim('  ↑↓ to navigate  ·  space to toggle  ·  enter to confirm\n'))
			const picked = await p.multiselect({
				message: 'Select the models you want to use with this connection:',
				options: models.map((m) => ({ value: m.id, label: m.name !== m.id ? `${m.id}  ${pc.dim(m.name)}` : m.id })),
				required: false,
			})

			if (p.isCancel(picked)) {
				p.cancel('Configuration cancelled.')
				process.exit(0)
			}
			selectedModels = picked as string[]
		}
	}

	try {
		addConnection(providerGroup.nickname, { provider: providerType, apiKey, accessToken, selectedModels })
		p.outro(pc.green(`✅ Connection '${pc.bold(providerGroup.nickname)}' added successfully with ${selectedModels.length} model(s).`))
	} catch (error) {
		p.cancel(pc.red(`❌ Failed to save configuration: ${error}`))
		process.exit(1)
	}
}
