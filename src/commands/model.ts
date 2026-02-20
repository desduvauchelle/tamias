import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDefaultModel, setDefaultModel, getAllModelOptions } from '../utils/config.ts'

// ─── tamias model — show current default ─────────────────────────────────────

export const runModelCommand = async () => {
	const current = getDefaultModel()
	if (!current) {
		console.log(pc.yellow('No default model set. Run `tamias model set` to configure one.'))
	} else {
		console.log(`Default model: ${pc.bold(pc.green(current))}`)
	}
}

// ─── tamias model set — interactive picker ────────────────────────────────────

export const runModelSetCommand = async () => {
	p.intro(pc.bgCyan(pc.black(' Tamias — Set Default Model ')))

	const options = getAllModelOptions()
	if (options.length === 0) {
		p.cancel(pc.yellow('No models configured. Add one with `tamias config`.'))
		process.exit(0)
	}

	const current = getDefaultModel()
	const currentIndex = current ? options.indexOf(current) : -1

	const selected = await p.select({
		message: 'Select default model:',
		options: options.map((o, i) => ({
			value: o,
			label: i === currentIndex ? `${o} ${pc.dim('(current)')}` : o,
		})),
		initialValue: current && options.includes(current) ? current : options[0],
	})

	if (p.isCancel(selected)) { p.cancel('Cancelled.'); process.exit(0) }

	const confirmed = await p.confirm({
		message: `Set ${pc.bold(pc.green(selected as string))} as the default model?`,
		initialValue: true,
	})

	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }

	setDefaultModel(selected as string)
	p.outro(pc.green(`✅ Default model set to ${pc.bold(selected as string)}`))
}
