import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDependencyStatus, installDependency, type Dependency } from '../utils/dependencies.ts'
import { runHealthChecks, formatHealthReport, type HealthReport } from '../utils/health/index.ts'
import { migrateFromProjectsJson } from '../core/projects.ts'

export async function runDoctorCommand(opts: { fix?: boolean; json?: boolean }) {
	if (!opts.json) p.intro(pc.bgBlue(pc.white(' Tamias Doctor — Health Check ')))

	// Migrate old projects.json to directory-based storage
	const migrated = migrateFromProjectsJson()
	if (migrated && !opts.json) {
		p.log.success('Migrated projects.json to per-project directory storage')
	}

	// Phase 1: Health checks (filesystem, identity, providers, channels, tools)
	const healthReport = await runHealthChecks({ autoFix: opts.fix })

	if (opts.json) {
		console.log(JSON.stringify(healthReport, null, 2))
		return
	}

	if (healthReport.results.length > 0) {
		const formatted = healthReport.results.map(r => {
			let icon: string
			switch (r.status) {
				case 'ok': icon = pc.green('✓'); break
				case 'warn': icon = pc.yellow('⚠'); break
				case 'error': icon = pc.red('✗'); break
				case 'fixed': icon = pc.blue('🔧'); break
			}
			let line = `   ${icon} ${pc.bold(r.id)} — ${r.message}`
			if (r.instructions) line += `\n      ${pc.dim(r.instructions.split('\n').join('\n      '))}`
			return line
		}).join('\n')

		p.note(formatted, 'System Health')

		if (healthReport.fixedCount > 0) {
			p.log.success(`Auto-fixed ${healthReport.fixedCount} issue(s)`)
		}
	}

	// Phase 2: Legacy dependency checks
	const status = getDependencyStatus()
	const missing = status.filter(d => !d.installed)

	if (missing.length === 0 && !healthReport.hasErrors && !healthReport.hasWarnings) {
		p.note(
			status.map(d => `${pc.green('   ✓')} ${pc.bold(d.label)}`).join('\n'),
			'All dependencies found!'
		)
		p.outro(pc.green('Your environment is ready! 🐿️'))
		return
	}

	if (missing.length > 0) {
		p.note(
			status.map(d => {
				const icon = d.installed ? pc.green('✓') : pc.red('✗')
				return `   ${icon} ${pc.bold(d.label)}`
			}).join('\n'),
			'Dependency Status'
		)

		if (opts.fix) {
			for (const dep of missing) {
				await installDependency(dep.id as Dependency)
			}
		} else {
			const shouldFix = await p.confirm({
				message: `Found ${pc.red(missing.length)} missing dependenc${missing.length > 1 ? 'ies' : 'y'}. Should I try to fix them?`,
				initialValue: true,
			})

			if (shouldFix && !p.isCancel(shouldFix)) {
				for (const dep of missing) {
					await installDependency(dep.id as Dependency)
				}
			}
		}
	}

	if (healthReport.hasErrors) {
		p.outro(pc.red('Some health checks failed. Fix the errors above to ensure Tamias works correctly.'))
	} else if (healthReport.hasWarnings) {
		p.outro(pc.yellow('Some warnings found. Tamias will work but you may want to address them.'))
	} else {
		p.outro(pc.green('Health check complete. 🐿️'))
	}
}
