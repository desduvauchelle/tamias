import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDependencyStatus, installDependency, type Dependency } from '../utils/dependencies.ts'

export async function runDoctorCommand(opts: { fix?: boolean }) {
	p.intro(pc.bgBlue(pc.white(' Tamias Doctor — Health Check ')))

	const status = getDependencyStatus()
	const missing = status.filter(d => !d.installed)

	if (missing.length === 0) {
		p.note(
			status.map(d => `${pc.green('   ✓')} ${pc.bold(d.label)}`).join('\n'),
			'All dependencies found!'
		)
		p.outro(pc.green('Your environment is ready! 🐿️'))
		return
	}

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
		p.outro(pc.green('Health check complete.'))
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

		p.outro(pc.dim('Run `tamias doctor --fix` to auto-install missing tools next time.'))
	}
}
