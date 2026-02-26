import { Command } from 'commander'
import { runConfigCommand, runConfigShowCommand, runConfigPathCommand } from './commands/config.ts'
import { runChatCommand } from './commands/chat.ts'
import { runModelsCommand, runModelsListCommand, runModelsDeleteCommand, runModelsEditCommand } from './commands/models.ts'
import { runToolsCommand, runToolsListCommand, runToolsAddMcpCommand, runToolsEnableCommand, runToolsDisableCommand, runToolsEditCommand, runToolsRemoveMcpCommand } from './commands/tools.ts'
import { runChannelsCommand, runChannelsListCommand, runChannelsAddCommand, runChannelsEditCommand, runChannelsRemoveCommand } from './commands/channels.ts'
import { runStartCommand } from './commands/start.ts'
import { runStopCommand } from './commands/stop.ts'
import { runStatusCommand } from './commands/status.ts'
import { runModelCommand, runModelSetCommand, runModelSetImageCommand } from './commands/model.ts'
import { runOnboarding } from './commands/onboarding.ts'
import { runSetupCommand } from './commands/setup.ts'
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
import { runDebugCommand } from './commands/debug.ts'
import { runBrowserCommand } from './commands/browser.ts'
import { runDocsGenerateCommand } from './commands/docs.ts'
import { skillsCommand } from './commands/skills.ts'
import { runMigrateStatusCommand, runMigrateRunCommand } from './commands/migrate.ts'
import { runProjectCommand, runProjectListCommand, runProjectCreateCommand, runProjectShowCommand, runProjectArchiveCommand } from './commands/projects.ts'
import { runTenantCommand, runTenantListCommand, runTenantCreateCommand, runTenantDeleteCommand, runTenantSwitchCommand } from './commands/tenant.ts'
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
const configCmd = program
	.command('config')
	.description('Manage configuration (add provider, show, path)')
	.action(runConfigCommand)

configCmd
	.command('show')
	.description('Display current configuration summary')
	.option('--json', 'Output as JSON')
	.action((opts: { json?: boolean }) => runConfigShowCommand(opts))

configCmd
	.command('path')
	.description('Print the config file path')
	.action(runConfigPathCommand)

// ─── tamias setup ─────────────────────────────────────────────────────────────
program
	.command('setup')
	.description('Interactive setup wizard (providers, model, channels, identity)')
	.action(runSetupCommand)

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

modelCmd
	.command('set-image')
	.description('Interactively set the default image model priority')
	.action(runModelSetImageCommand)

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

// ─── tamias debug ─────────────────────────────────────────────────────────────
program
	.command('debug')
	.description('Toggle debug mode (adds metadata to messages and shows tool calls in CLI)')
	.action(runDebugCommand)

// ─── tamias skills ────────────────────────────────────────────────────────────
program.addCommand(skillsCommand)

// ─── tamias browser ───────────────────────────────────────────────────────────
program
	.command('browser')
	.description('Open a visible browser window for manual login (persists to ~/.tamias/browser-data)')
	.action(runBrowserCommand)

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
	.description('Check and fix system dependencies, health checks, and configuration')
	.option('--fix', 'Automatically attempt to fix all issues')
	.option('--json', 'Output results as JSON')
	.action((opts: { fix?: boolean; json?: boolean }) => runDoctorCommand(opts))

// ─── tamias docs ──────────────────────────────────────────────────────────────
program
	.command('docs')
	.description('Generate documentation files')
	.option('-o, --output <dir>', 'Output directory (default: ~/.tamias/docs)')
	.action((opts: { output?: string }) => runDocsGenerateCommand(opts))

// ─── tamias migrate ───────────────────────────────────────────────────────────
const migrateCmd = program
	.command('migrate')
	.description('Manage schema and filesystem migrations')
	.action(runMigrateStatusCommand)

migrateCmd
	.command('status')
	.description('Show current migration state')
	.action(runMigrateStatusCommand)

migrateCmd
	.command('run')
	.description('Apply pending migrations')
	.option('--dry-run', 'Preview changes without writing')
	.option('--tenant <id>', 'Run for a specific tenant')
	.action((opts: { dryRun?: boolean; tenant?: string }) => runMigrateRunCommand(opts))

// ─── tamias project ───────────────────────────────────────────────────────────
const projectCmd = program
	.command('project')
	.description('Manage project memory and context')
	.action(runProjectCommand)

projectCmd
	.command('list')
	.description('List all projects')
	.action(runProjectListCommand)

projectCmd
	.command('create')
	.argument('[name]', 'Project name')
	.description('Create a new project')
	.action(runProjectCreateCommand)

projectCmd
	.command('show')
	.argument('[slug]', 'Project slug')
	.description('Show project details')
	.action(runProjectShowCommand)

projectCmd
	.command('archive')
	.argument('[slug]', 'Project slug to archive')
	.description('Archive a project')
	.action(runProjectArchiveCommand)

// ─── tamias tenant ────────────────────────────────────────────────────────────
const tenantCmd = program
	.command('tenant')
	.description('Manage multi-tenant environments')
	.action(runTenantCommand)

tenantCmd
	.command('list')
	.description('List all tenants')
	.action(runTenantListCommand)

tenantCmd
	.command('create')
	.argument('[name]', 'Tenant name')
	.description('Create a new tenant')
	.action(runTenantCreateCommand)

tenantCmd
	.command('delete')
	.argument('[id]', 'Tenant ID to delete')
	.description('Delete a tenant')
	.action(runTenantDeleteCommand)

tenantCmd
	.command('switch')
	.argument('[id]', 'Tenant ID to switch to')
	.description('Switch active tenant')
	.action(runTenantSwitchCommand)

// First-run detection: if no subcommand given and not yet onboarded, launch chat (which triggers onboarding)
if (process.argv.length <= 2 && !isOnboarded()) {
	await runChatCommand()
	process.exit(0)
}

program.parse(process.argv)

program
	.command('token')
	.description('Show the dashboard authentication token and URL. The token persists across restarts.')
	.option('--reset', 'Generate a new token (takes effect after tamias restart)')
	.action((opts: { reset?: boolean }) => import('./commands/token.ts').then(m => m.runTokenCommand(opts)))
