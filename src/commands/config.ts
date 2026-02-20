import * as p from '@clack/prompts'
import pc from 'picocolors'
import { addConnection, ProviderEnum } from '../utils/config.ts'
import { fetchModels } from '../utils/models.ts'
import { setEnv, generateSecureEnvKey } from '../utils/env.ts'

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
						{ value: 'ollama', label: '🦙 Ollama' },
						{ value: 'antigravity', label: '🚀 Antigravity (OAuth)' },
					],
				}),
			baseUrl: ({ results }) => {
				if (results.provider === 'ollama') {
					return p.text({
						message: 'Enter your Ollama Base URL (leave blank for default):',
						placeholder: 'http://127.0.0.1:11434',
					})
				}
				return Promise.resolve(undefined)
			},
			credentials: ({ results }) => {
				if (results.provider === 'antigravity') {
					return p.text({
						message: 'Enter your Antigravity Access Token:',
						placeholder: 'ag_...',
						validate: (v) => { if (!v) return 'Access token is required' },
					})
				}
				if (results.provider === 'ollama') {
					return p.text({
						message: 'Enter an API key if required (leave blank for none):',
						placeholder: 'ollama',
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
	const apiKey = providerType !== 'antigravity' && providerGroup.credentials ? (providerGroup.credentials as string) : undefined
	const accessToken = providerType === 'antigravity' ? (providerGroup.credentials as string) : undefined
	const baseUrl = (providerGroup as any).baseUrl as string | undefined

	// Fetch & select models (skip for antigravity)
	let selectedModels: string[] = []

	if (providerType !== 'antigravity' && (providerType === 'ollama' || apiKey)) {
		const s = p.spinner()
		s.start(`Fetching available models for ${providerType}...`)
		const fetchKey = apiKey || 'ollama'
		const models = await fetchModels(providerType, fetchKey, baseUrl)
		s.stop(models.length > 0 ? `Found ${models.length} models.` : 'Could not fetch models, you can add them later.')

		if (models.length > 0) {
			console.log(pc.dim('  ↑↓ to navigate  ·  space to toggle  ·  enter to confirm\n'))
			const picked = await p.autocompleteMultiselect({
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
		let envKeyName: string | undefined
		const secretStr = apiKey || accessToken
		if (secretStr) {
			envKeyName = generateSecureEnvKey(`${providerGroup.nickname}_${providerType}`)
			setEnv(envKeyName, secretStr)
		}

		addConnection(providerGroup.nickname, { provider: providerType, envKeyName, baseUrl, selectedModels })
		p.outro(pc.green(`✅ Connection '${pc.bold(providerGroup.nickname)}' added successfully with ${selectedModels.length} model(s).`))
	} catch (error) {
		p.cancel(pc.red(`❌ Failed to save configuration: ${error}`))
		process.exit(1)
	}
}
