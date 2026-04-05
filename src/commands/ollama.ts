import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { fetchOllamaModels, pullOllamaModel } from '../utils/models.ts'
import { loadConfig } from '../utils/config.ts'

function resolveOllamaBaseUrl(connectionName?: string): string {
	if (connectionName) {
		const config = loadConfig()
		const conn = config.connections[connectionName]
		if (!conn) {
			p.log.error(`Connection '${connectionName}' not found.`)
			process.exit(1)
		}
		if (conn.provider !== 'ollama') {
			p.log.error(`Connection '${connectionName}' is not an Ollama connection (provider: ${conn.provider}).`)
			process.exit(1)
		}
		return conn.baseUrl || 'http://127.0.0.1:11434'
	}

	// Try to find an Ollama connection in config
	const config = loadConfig()
	for (const conn of Object.values(config.connections)) {
		if (conn.provider === 'ollama') {
			return conn.baseUrl || 'http://127.0.0.1:11434'
		}
	}

	return 'http://127.0.0.1:11434'
}

export const ollamaCommand = new Command('ollama')
	.description('Manage local Ollama models')

ollamaCommand
	.command('list')
	.alias('ls')
	.description('List locally available Ollama models')
	.option('-c, --connection <name>', 'Use a specific Ollama connection from config')
	.action(async (opts: { connection?: string }) => {
		p.intro(pc.bold('Ollama Models'))

		const baseUrl = resolveOllamaBaseUrl(opts.connection)

		const spinner = p.spinner()
		spinner.start(`Fetching models from ${baseUrl}`)

		try {
			const models = await fetchOllamaModels(baseUrl)
			spinner.stop('Models fetched')

			if (models.length === 0) {
				p.log.warn('No models installed. Use `tamias ollama pull <model>` to download one.')
			} else {
				p.log.info(`${pc.bold(String(models.length))} model${models.length !== 1 ? 's' : ''} available:`)
				for (const m of models) {
					p.log.message(`  ${pc.cyan(m.id)}`)
				}
			}
		} catch (err) {
			spinner.stop('Failed')
			p.log.error(`Could not connect to Ollama at ${baseUrl}. Is it running?`)
			p.log.message(`  ${pc.dim(String(err))}`)
		}

		p.outro('')
	})

ollamaCommand
	.command('pull <model>')
	.description('Pull (download) an Ollama model')
	.option('-c, --connection <name>', 'Use a specific Ollama connection from config')
	.action(async (model: string, opts: { connection?: string }) => {
		p.intro(pc.bold(`Pulling ${pc.cyan(model)}`))

		const baseUrl = resolveOllamaBaseUrl(opts.connection)

		const spinner = p.spinner()
		spinner.start(`Pulling ${model} from ${baseUrl}`)

		try {
			let lastStatus = ''
			for await (const progress of pullOllamaModel(model, baseUrl)) {
				if (progress.status === 'error') {
					spinner.stop('Error')
					p.log.error(String((progress as unknown as Record<string, unknown>).error || progress.status))
					p.outro('')
					return
				}

				if (progress.total && progress.completed) {
					const pct = Math.round((progress.completed / progress.total) * 100)
					spinner.message(`${progress.status}: ${pct}%`)
				} else if (progress.status !== lastStatus) {
					spinner.message(progress.status)
				}
				lastStatus = progress.status
			}

			spinner.stop('Pull complete')
			p.log.success(`Model ${pc.cyan(model)} is ready to use.`)
		} catch (err) {
			spinner.stop('Failed')
			p.log.error(`Failed to pull ${model}: ${String(err)}`)
		}

		p.outro('')
	})
