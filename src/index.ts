import { Command } from 'commander'
import { runConfigCommand } from './commands/config.ts'
import { runChatCommand } from './commands/chat.ts'
import { runModelsCommand, runModelsListCommand, runModelsDeleteCommand, runModelsEditCommand } from './commands/models.ts'
import { runToolsCommand, runToolsListCommand, runToolsAddMcpCommand, runToolsEnableCommand, runToolsDisableCommand, runToolsEditCommand, runToolsRemoveMcpCommand } from './commands/tools.ts'
import { runChannelsCommand, runChannelsListCommand, runChannelsAddCommand, runChannelsEditCommand, runChannelsRemoveCommand } from './commands/channels.ts'
import { runStartCommand } from './commands/start.ts'
import { runStopCommand } from './commands/stop.ts'
import { runStatusCommand } from './commands/status.ts'
import { runModelCommand, runModelSetCommand } from './commands/model.ts'
import { runOnboarding } from './commands/onboarding.ts'
import { runUsageCommand } from './commands/usage.ts'
import { runUpdateCommand } from './commands/update.ts'
import { cronCommand } from './commands/cron.ts'

const program = new Command()

program
	.name('tamias')
	.description('A secure, agentic AI chat interface powered by the Vercel AI SDK')
	.version('1.0.0')

program.addCommand(cronCommand)

// ─── tamias config ────────────────────────────────────────────────────────────
program
	.command('config')
	.description('Add a new model configuration (API key and model selection)')
	.action(runConfigCommand)

// ─── tamias chat ──────────────────────────────────────────────────────────────
program
	.command('chat')
	.description('Launch an interactive AI chat session (connects to daemon, auto-starts if needed)')
	.action(runChatCommand)

// ─── tamias start ─────────────────────────────────────────────────────────────
program
	.command('start')
	.description('Start the Tamias daemon (central AI brain)')
	.option('--daemon', 'Run in background/daemon mode (no interactive output)')
	.action((opts: { daemon?: boolean }) => runStartCommand(opts))

// ─── tamias stop ──────────────────────────────────────────────────────────────
program
	.command('stop')
	.description('Stop the running Tamias daemon')
	.action(runStopCommand)

// ─── tamias status ────────────────────────────────────────────────────────────
program
	.command('status')
	.description('Show daemon status and active sessions')
	.action(runStatusCommand)

// ─── tamias usage ─────────────────────────────────────────────────────────────
program
	.command('usage')
	.argument('[period]', 'Time period: today, yesterday, week, month, all', 'all')
	.description('Display aggregated AI request usage and stats')
	.action(runUsageCommand)

// ─── tamias model ─────────────────────────────────────────────────────────────
const modelCmd = program
	.command('model')
	.description('View or set the default AI model')
	.action(runModelCommand)

modelCmd
	.command('set')
	.description('Interactively set the default model')
	.action(runModelSetCommand)

// ─── tamias onboarding ────────────────────────────────────────────────────────
program
	.command('onboarding')
	.description('Re-run the first-run onboarding (reset identity and persona)')
	.action(runOnboarding)

// ─── tamias update ────────────────────────────────────────────────────────────
program
	.command('update')
	.description('Check for and install updates for Tamias')
	.action(runUpdateCommand)

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
	.alias('remove')
	.argument('[nickname]', 'The nickname of the model configuration to delete')
	.description('Delete a model config')
	.action(runModelsDeleteCommand)

// ─── tamias tools ─────────────────────────────────────────────────────────────
const toolsCmd = program
	.command('tools')
	.description('Manage internal tools and external MCP servers')
	.action(runToolsCommand)

toolsCmd
	.command('list')
	.description('List all tools and external MCPs with their status')
	.action(runToolsListCommand)

toolsCmd
	.command('add-mcp')
	.description('Add an external MCP server connection')
	.action(runToolsAddMcpCommand)

toolsCmd
	.command('enable')
	.argument('[name]', 'Tool or MCP name (e.g. terminal or mcp:gdrive)')
	.description('Enable a tool or MCP')
	.action(runToolsEnableCommand)

toolsCmd
	.command('disable')
	.argument('[name]', 'Tool or MCP name')
	.description('Disable a tool or MCP')
	.action(runToolsDisableCommand)

toolsCmd
	.command('edit')
	.argument('[name]', 'Tool or MCP name')
	.description('Configure functions and allowlists for a tool or MCP')
	.action(runToolsEditCommand)

toolsCmd
	.command('remove-mcp')
	.argument('[name]', 'MCP server name to remove')
	.description('Remove an external MCP server')
	.action(runToolsRemoveMcpCommand)

// ─── tamias channels ────────────────────────────────────────────────────────
const channelsCmd = program
	.command('channels')
	.description('Manage translator gateway channels (Discord, Telegram, etc.)')
	.action(runChannelsCommand)

channelsCmd
	.command('list')
	.description('List configured channels')
	.action(runChannelsListCommand)

channelsCmd
	.command('add')
	.description('Configure a new channel')
	.action(runChannelsAddCommand)

channelsCmd
	.command('edit')
	.description('Edit an existing channel configuration')
	.action(runChannelsEditCommand)

channelsCmd
	.command('remove')
	.alias('delete')
	.argument('[platform]', 'The channel platform to remove (e.g. discord or telegram)')
	.description('Remove a channel configuration')
	.action(runChannelsRemoveCommand)

program.parse(process.argv)
