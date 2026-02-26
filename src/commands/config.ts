import * as p from '@clack/prompts'
import pc from 'picocolors'
import { addConnection, ProviderEnum, loadConfig, getAllModelOptions, getDefaultModel, CONFIG_PATH } from '../utils/config.ts'
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

/**
 * `tamias config show` — Display current configuration summary.
 */
export const runConfigShowCommand = async (opts: { json?: boolean } = {}) => {
	const config = loadConfig()

	if (opts.json) {
		// Strip env key names from output for safety
		const safe = { ...config }
		for (const [k, c] of Object.entries(safe.connections)) {
			safe.connections[k] = { ...c, envKeyName: c.envKeyName ? '***' : undefined }
		}
		console.log(JSON.stringify(safe, null, 2))
		return
	}

	p.intro(pc.bgCyan(pc.black(' Tamias — Configuration ')))

	// Connections
	const connections = Object.entries(config.connections)
	if (connections.length === 0) {
		console.log(pc.yellow('  No connections configured. Run `tamias config` to add one.'))
	} else {
		console.log(pc.bold('\n  Connections:'))
		for (const [nick, conn] of connections) {
			const models = conn.selectedModels?.length ?? 0
			console.log(`    ${pc.cyan(nick)} — ${conn.provider} (${models} model${models !== 1 ? 's' : ''})`)
		}
	}

	// Default model
	const defaultModel = getDefaultModel()
	console.log(`\n  ${pc.bold('Default model:')} ${defaultModel ?? pc.dim('not set')}`)

	// All models
	const allModels = getAllModelOptions()
	console.log(`  ${pc.bold('Available models:')} ${allModels.length}`)

	// Bridges
	const bridges = config.bridges
	const discordCount = Object.keys(bridges?.discords ?? {}).length
	const telegramCount = Object.keys(bridges?.telegrams ?? {}).length
	const whatsappCount = Object.keys((bridges as any)?.whatsapps ?? {}).length
	console.log(`\n  ${pc.bold('Channels:')}`)
	console.log(`    Discord: ${discordCount} instance(s)`)
	console.log(`    Telegram: ${telegramCount} instance(s)`)
	console.log(`    WhatsApp: ${whatsappCount} instance(s)`)

	// Tools
	const tools = config.internalTools
	const enabledTools = Object.entries(tools ?? {}).filter(([, t]) => (t as any)?.enabled !== false)
	const mcpServers = Object.keys(config.mcpServers ?? {}).length
	console.log(`\n  ${pc.bold('Tools:')} ${enabledTools.length} enabled, ${mcpServers} MCP server(s)`)

	// Config path
	console.log(`\n  ${pc.dim(`Config: ${CONFIG_PATH}`)}`)

	p.outro('')
}

/**
 * `tamias config path` — Print config file path.
 */
export const runConfigPathCommand = async () => {
	console.log(CONFIG_PATH)
}
