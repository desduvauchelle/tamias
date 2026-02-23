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
import { runEmailsCommand, runEmailsListCommand, runEmailsAddCommand, runEmailsEditCommand, runEmailsDeleteCommand } from './commands/emails.ts'
import { runWorkspaceCommand } from './commands/workspace.ts'
import { runUninstallCommand, runBackupCommand, runRestoreCommand } from './commands/maintenance.ts'
import { agentsCommand } from './commands/agents.ts'
import { runReadmeCommand } from './commands/readme.ts'
import { runDoctorCommand } from './commands/doctor.ts'
import { runHistoryCommand } from './commands/history.ts'
import { runRestartCommand } from './commands/restart.ts'
import { isOnboarded } from './utils/memory.ts'
import { VERSION } from './utils/version.ts'

const program = new Command()

program
	.name('tamias')
	.description('A secure, agentic AI chat interface powered by the Vercel AI SDK')
	.version(VERSION, '-v, --version')

program.addCommand(cronCommand)
program.addCommand(agentsCommand)

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
	.option('--verbose', 'Enable verbose debug logging (sets TAMIAS_DEBUG=1, restarts daemon if running)')
	.action((opts: { daemon?: boolean; verbose?: boolean }) => runStartCommand(opts))

// ─── tamias logs ──────────────────────────────────────────────────────────────
program
	.command('history')
	.description('View and follow the daemon log (~/.tamias/daemon.log)')
	.option('-n, --lines <n>', 'Number of lines to show from the end', String(80))
	.option('--no-follow', 'Print tail and exit (do not follow)')
	.option('--clear', 'Clear the log file')
	.action((opts: { lines?: string; follow?: boolean; clear?: boolean }) => runHistoryCommand(opts))

// ─── tamias stop ──────────────────────────────────────────────────────────────
program
	.command('stop')
	.description('Stop the running Tamias daemon')
	.action(runStopCommand)

// ─── tamias restart ───────────────────────────────────────────────────────────
program
	.command('restart')
	.description('Restart the running Tamias daemon')
	.option('--verbose', 'Enable verbose debug logging')
	.action((opts: { verbose?: boolean }) => runRestartCommand(opts))

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
	.description('Manage gateway channels (Discord, Telegram, etc.)')
	.action(runChannelsCommand)

channelsCmd
	.command('list')
	.description('List configured communication channels')
	.action(runChannelsListCommand)

channelsCmd
	.command('add')
	.description('Connect a new communication channel')
	.action(runChannelsAddCommand)

channelsCmd
	.command('edit')
	.description('Edit an existing channel (tokens, allowed IDs)')
	.action(runChannelsEditCommand)

channelsCmd
	.command('remove')
	.alias('delete')
	.argument('[platform]', 'Platform to remove (discord|telegram)')
	.description('Remove a channel configuration')
	.action(runChannelsRemoveCommand)

// ─── tamias emails ────────────────────────────────────────────────────────────
const emailsCmd = program
	.command('emails')
	.description('Manage email accounts for the email MCP tool')
	.action(runEmailsCommand)

emailsCmd
	.command('list')
	.description('List configured email accounts')
	.action(runEmailsListCommand)

emailsCmd
	.command('add')
	.description('Add a new email account')
	.action(runEmailsAddCommand)

emailsCmd
	.command('edit')
	.argument('[nickname]', 'The nickname of the email account to edit')
	.description('Edit an existing email account')
	.action(runEmailsEditCommand)

emailsCmd
	.command('delete')
	.alias('remove')
	.argument('[nickname]', 'The nickname of the email account to delete')
	.description('Delete an email account')
	.action(runEmailsDeleteCommand)

// ─── tamias workspace ─────────────────────────────────────────────────────────
program
	.command('workspace')
	.argument('[path]', 'The path to the restricted workspace directory')
	.description('View or set the restricted workspace directory for the AI')
	.action(runWorkspaceCommand)

// ─── tamias maintenance ──────────────────────────────────────────────────────
program
	.command('uninstall')
	.description('Completely remove Tamias and its data')
	.action(runUninstallCommand)

program
	.command('backup')
	.description('Create a backup of Tamias configuration and logs')
	.option('-f, --file <path>', 'Custom filename or path for the backup archive')
	.action((opts: { file?: string }) => runBackupCommand(opts))

program
	.command('restore')
	.argument('<file>', 'The backup file to restore from')
	.description('Restore Tamias configuration and logs from a backup')
	.action(runRestoreCommand)

program
	.command('readme')
	.description('View the Tamias README.md with terminal formatting')
	.action(runReadmeCommand)

// ─── tamias doctor ────────────────────────────────────────────────────────────
program
	.command('doctor')
	.description('Check and fix system dependencies (himalaya, git, etc.)')
	.option('--fix', 'Automatically attempt to install missing dependencies')
	.action((opts: { fix?: boolean }) => runDoctorCommand(opts))

// First-run detection: if no subcommand given and not yet onboarded, launch chat (which triggers onboarding)
if (process.argv.length <= 2 && !isOnboarded()) {
	await runChatCommand()
	process.exit(0)
}

program.parse(process.argv)
