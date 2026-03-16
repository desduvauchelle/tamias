import { Command } from 'commander'
import { runStartCommand } from './commands/start.ts'
import { runStopCommand } from './commands/stop.ts'
import { runStatusCommand } from './commands/status.ts'
import { runDoctorCommand } from './commands/doctor.ts'
import { VERSION } from './utils/version.ts'

export const program = new Command()

program
	.name('tamias')
	.description('A secure, agentic AI chat interface powered by the Vercel AI SDK')
	.version(VERSION, '-v, --version')

// ─── tamias start ─────────────────────────────────────────────────────────────
program
	.command('start')
	.description('Start the Tamias daemon (central AI brain)')
	.option('--daemon', 'Run in background/daemon mode (no interactive output)')
	.option('--verbose', 'Enable verbose debug logging (sets TAMIAS_DEBUG=1, restarts daemon if running)')
	.action((opts: { daemon?: boolean; verbose?: boolean }) => runStartCommand(opts))

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

// ─── tamias doctor ────────────────────────────────────────────────────────────
program
	.command('doctor')
	.description('Check and fix system dependencies, health checks, and configuration')
	.option('--fix', 'Automatically attempt to fix all issues')
	.option('--json', 'Output results as JSON')
	.action((opts: { fix?: boolean; json?: boolean }) => runDoctorCommand(opts))

// Only execute when run directly (not when imported by scripts)
if (import.meta.main) {
	program.parse(process.argv)
}
