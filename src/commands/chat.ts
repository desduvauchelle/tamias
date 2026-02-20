import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getAllConnections, type ConnectionConfig } from '../utils/config'
import { streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { ProviderType } from '../utils/config'

const PROVIDER_DEFAULTS: Record<ProviderType, string> = {
	openai: 'gpt-4o',
	anthropic: 'claude-3-5-sonnet-20241022',
	google: 'gemini-1.5-pro-latest',
	openrouter: 'openai/gpt-4-turbo',
	antigravity: '',
}

// Main chat command logic
export const runChatCommand = async () => {
	p.intro(pc.bgMagenta(pc.black(' Tamias Chat ')))

	const connections = getAllConnections()

	if (connections.length === 0) {
		p.cancel(pc.yellow('No models found. Run `tamias config` first.'))
		process.exit(1)
	}

	// Build flat list of nickname/model options in nickname/model format
	type ModelOption = { connectionNickname: string; modelId: string; display: string }
	const modelOptions: ModelOption[] = []

	for (const c of connections) {
		const models = c.selectedModels ?? []
		for (const modelId of models) {
			modelOptions.push({
				connectionNickname: c.nickname,
				modelId,
				display: `${pc.bold(c.nickname)}${pc.dim('/')}${modelId}`,
			})
		}
	}

	if (modelOptions.length === 0) {
		p.cancel(pc.yellow('No models selected. Run `tamias models edit` to pick some models for your configuration.'))
		process.exit(1)
	}

	const selectedValue = await p.select({
		message: 'Select a model:',
		options: modelOptions.map((o, i) => ({
			value: String(i),
			label: o.display,
		})),
	})

	if (p.isCancel(selectedValue)) {
		p.cancel('Chat cancelled.')
		process.exit(0)
	}

	const chosen = modelOptions[Number(selectedValue)]!
	const connection = connections.find((c) => c.nickname === chosen.connectionNickname)!

	// Resolve the model string
	const modelId = chosen.modelId

	// Determine the model provider based on configuration
	let model: ReturnType<ReturnType<typeof createOpenAI>>

	try {
		switch (connection.provider) {
			case 'openai': {
				const openai = createOpenAI({ apiKey: connection.apiKey })
				model = openai(modelId)
				break
			}
			case 'anthropic': {
				const anthropic = createAnthropic({ apiKey: connection.apiKey })
				// @ts-ignore — anthropic model type is compatible
				model = anthropic(modelId)
				break
			}
			case 'google': {
				const google = createGoogleGenerativeAI({ apiKey: connection.apiKey })
				// @ts-ignore — google model type is compatible
				model = google(modelId)
				break
			}
			case 'openrouter': {
				const openrouter = createOpenAI({
					baseURL: 'https://openrouter.ai/api/v1',
					apiKey: connection.apiKey,
				})
				model = openrouter(modelId)
				break
			}
			case 'antigravity': {
				p.cancel(pc.red('Antigravity model support is a work in progress.'))
				process.exit(1)
			}
			default:
				p.cancel(pc.red(`Unsupported provider: ${connection.provider}`))
				process.exit(1)
		}
	} catch (error) {
		p.cancel(pc.red(`Failed to initialize provider: ${error}`))
		process.exit(1)
	}

	const label = modelId ? `${pc.bold(connection.nickname)}/${modelId}` : pc.bold(connection.nickname)
	p.outro(pc.green(`Connected via ${label}! Type 'exit' to quit.`))

	const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

	// Chat Loop
	while (true) {
		const input = await p.text({
			message: pc.cyan('You:'),
			placeholder: 'Type your message...',
			validate: (value) => {
				if (!value || !value.trim()) return 'Please enter a message'
			},
		})

		if (p.isCancel(input) || input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
			p.outro(pc.dim('Goodbye!'))
			process.exit(0)
		}

		messages.push({ role: 'user', content: input })

		const s = p.spinner()
		s.start('Thinking...')

		try {
			const result = await streamText({
				model,
				messages,
			})

			let fullResponse = ''
			let started = false

			for await (const textPart of result.textStream) {
				if (!started) {
					s.stop('AI response:')
					process.stdout.write(pc.magenta('\nAI: '))
					started = true
				}
				process.stdout.write(textPart)
				fullResponse += textPart
			}

			console.log('\n')
			messages.push({ role: 'assistant', content: fullResponse })
		} catch (error) {
			s.stop('Error occurred')
			console.error(pc.red(`\nError generating response: ${error}\n`))
		}
	}
}
