/**
 * CLI command: tamias migrate
 *
 * Shows migration status, runs pending migrations, supports --dry-run.
 */
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { TAMIAS_DIR } from '../utils/config.ts'
import { runMigrations, getMigrationStatus } from '../utils/migrations/index.ts'

export async function runMigrateStatusCommand() {
	p.intro(pc.bgBlue(pc.white(' Tamias — Migration Status ')))

	const status = getMigrationStatus(TAMIAS_DIR)

	const lines: string[] = []

	const configIcon = status.config.pending > 0 ? pc.yellow('⚠') : pc.green('✓')
	lines.push(`${configIcon} Config: v${status.config.current} / v${status.config.latest}${status.config.pending > 0 ? ` (${status.config.pending} pending)` : ''}`)

	const layoutIcon = status.layout.pending > 0 ? pc.yellow('⚠') : pc.green('✓')
	lines.push(`${layoutIcon} Layout: v${status.layout.current} / v${status.layout.latest}${status.layout.pending > 0 ? ` (${status.layout.pending} pending)` : ''}`)

	lines.push(`${pc.green('✓')} DB: v${status.db.latest} (managed by db.ts)`)

	if (status.deferred.length > 0) {
		lines.push('')
		lines.push(pc.yellow(`${status.deferred.length} deferred migration(s):`))
		for (const d of status.deferred) {
			lines.push(`  ${pc.dim(`${d.domain} v${d.version}`)}: ${d.description}`)
		}
	}

	p.note(lines.join('\n'), 'Migration Versions')

	const totalPending = status.config.pending + status.layout.pending
	if (totalPending === 0 && status.deferred.length === 0) {
		p.outro(pc.green('All migrations are up to date.'))
	} else if (totalPending > 0) {
		p.outro(pc.yellow(`${totalPending} migration(s) pending. Run \`tamias migrate run\` to apply.`))
	} else {
		p.outro(pc.dim('Deferred migrations will run when an AI model becomes available.'))
	}
}

export async function runMigrateRunCommand(opts: { dryRun?: boolean; tenant?: string } = {}) {
	const targetDir = opts.tenant
		? `${TAMIAS_DIR}/tenants/${opts.tenant}`
		: TAMIAS_DIR

	p.intro(pc.bgBlue(pc.white(` Tamias — Running Migrations${opts.dryRun ? ' (Dry Run)' : ''} `)))

	if (opts.dryRun) {
		p.note('No changes will be written to disk.', 'Dry Run Mode')
	}

	const report = await runMigrations(targetDir, undefined, opts.dryRun)

	if (report.applied.length > 0) {
		const lines = report.applied.map(m => {
			const icon = m.result.success ? pc.green('✓') : pc.red('✗')
			return `  ${icon} ${m.domain} v${m.version}: ${m.description} — ${m.result.message}`
		})
		p.note(lines.join('\n'), 'Applied')
	}

	if (report.skipped.length > 0) {
		const lines = report.skipped.map(m =>
			`  ${pc.dim('·')} ${m.domain} v${m.version}: ${m.description} — ${pc.dim(m.reason)}`
		)
		p.note(lines.join('\n'), 'Skipped')
	}

	if (report.failed.length > 0) {
		const lines = report.failed.map(m =>
			`  ${pc.red('✗')} ${m.domain} v${m.version}: ${m.description} — ${pc.red(m.error)}`
		)
		p.note(lines.join('\n'), 'Failed')
	}

	if (report.deferred.length > 0) {
		const lines = report.deferred.map(m =>
			`  ${pc.yellow('⏳')} ${m.domain} v${m.version}: ${m.description}`
		)
		p.note(lines.join('\n'), 'Deferred (AI model not available)')
	}

	const total = report.applied.length + report.failed.length + report.deferred.length
	if (total === 0) {
		p.outro(pc.green('All migrations are up to date.'))
	} else {
		p.outro(pc.green(`${report.applied.length} applied, ${report.failed.length} failed, ${report.deferred.length} deferred.`))
	}
}
