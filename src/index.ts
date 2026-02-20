import { Command } from 'commander'
import { runConfigCommand } from './commands/config'
import { runChatCommand } from './commands/chat'
import { runModelsCommand, runModelsListCommand, runModelsDeleteCommand, runModelsEditCommand } from './commands/models'

const program = new Command()

program
	.name('tamias')
	.description('A secure terminal AI chat interface powered by the Vercel AI SDK')
	.version('1.0.0')

// ─── tamias config ────────────────────────────────────────────────────────────
program
	.command('config')
	.description('Add a new model configuration (API key and model selection)')
	.action(runConfigCommand)

// ─── tamias chat ──────────────────────────────────────────────────────────────
program
	.command('chat')
	.description('Launch an interactive AI chat session (pick configuration on start)')
	.action(runChatCommand)

// ─── tamias models ────────────────────────────────────────────────────────────
const modelsCmd = program
	.command('models')
	.description('Manage model configurations (list, add, edit, delete)')
	.action(runModelsCommand)

modelsCmd
	.command('list')
	.description('List all configured models')
	.action(runModelsListCommand)

modelsCmd
	.command('add')
	.description('Add a new model config (alias for `tamias config`)')
	.action(runConfigCommand)

modelsCmd
	.command('edit')
	.argument('[nickname]', 'The nickname of the model configuration to edit')
	.description('Edit an existing model config (nickname or models)')
	.action(runModelsEditCommand)

modelsCmd
	.command('delete')
	.argument('[nickname]', 'The nickname of the model configuration to delete')
	.description('Delete a model config')
	.action(runModelsDeleteCommand)

program.parse(process.argv)
