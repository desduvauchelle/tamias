import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDefaultModels, setDefaultModels, getAllModelOptions } from '../utils/config.ts'

// ─── tamias model — show current default(s) ──────────────────────────────────

export const runModelCommand = async () => {
	const current = getDefaultModels()
	if (current.length === 0) {
		console.log(pc.yellow('No default models set. Run `tamias model set` to configure.'))
	} else {
		console.log(pc.cyan('Default model priority:'))
		current.forEach((m, i) => {
			console.log(`${i + 1}. ${pc.bold(pc.green(m))}${i === 0 ? pc.dim(' (primary)') : ''}`)
		})
	}
}

// ─── tamias model set — interactive picker ────────────────────────────────────

export const runModelSetCommand = async () => {
	p.intro(pc.bgCyan(pc.black(' Tamias — Set Model Priority ')))

	const options = getAllModelOptions()
	if (options.length === 0) {
		p.cancel(pc.yellow('No models configured. Add one with `tamias config`.'))
		process.exit(0)
	}

	const selectedModels: string[] = []
	let remainingOptions = [...options]

	while (remainingOptions.length > 0) {
		const label = selectedModels.length === 0 ? 'Select primary model:' : `Select fallback #${selectedModels.length} (optional):`

		const opts = remainingOptions.map(o => ({ value: o, label: o }))
		if (selectedModels.length > 0) {
			opts.unshift({ value: '__done__', label: pc.dim('Done (no more fallbacks)') } as any)
		}

		const selected = await p.select({
			message: label,
			options: opts,
		})

		if (p.isCancel(selected)) {
			if (selectedModels.length > 0) break
			p.cancel('Cancelled.')
			process.exit(0)
		}

		if (selected === '__done__') break

		selectedModels.push(selected as string)
		remainingOptions = remainingOptions.filter(o => o !== selected)

		if (selectedModels.length >= 5) break // Limit to 5 models
	}

	if (selectedModels.length === 0) {
		p.cancel('No models selected.')
		process.exit(0)
	}

	const confirmed = await p.confirm({
		message: `Set priority to: ${pc.bold(pc.green(selectedModels.join(' → ')))}?`,
		initialValue: true,
	})

	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }

	setDefaultModels(selectedModels)
	p.outro(pc.green(`✅ Model priority updated`))
}
