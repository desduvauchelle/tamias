import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDefaultModels, setDefaultModels, getAllModelOptions, getDefaultImageModels, setDefaultImageModels, getCompactionModel, setCompactionModel } from '../utils/config.ts'

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

	const currentImage = getDefaultImageModels()
	console.log('')
	if (currentImage.length === 0) {
		console.log(pc.yellow('No default image models set. Run `tamias model set-image` to configure.'))
	} else {
		console.log(pc.cyan('Default image model priority:'))
		currentImage.forEach((m, i) => {
			console.log(`${i + 1}. ${pc.bold(pc.magenta(m))}${i === 0 ? pc.dim(' (primary)') : ''}`)
		})
	}

	const currentCompaction = getCompactionModel()
	console.log('')
	if (!currentCompaction) {
		console.log(pc.yellow('No compaction model set. Run `tamias model set-compaction` to configure.'))
		console.log(pc.dim('  (Using the default chat model for compaction — a cheaper model is recommended)'))
	} else {
		console.log(pc.cyan('Compaction model:'))
		console.log(`  ${pc.bold(pc.blue(currentCompaction))}`)
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

// ─── tamias model set-image — interactive picker ──────────────────────────────

export const runModelSetImageCommand = async () => {
	p.intro(pc.bgMagenta(pc.black(' Tamias — Set Image Model Priority ')))

	const options = getAllModelOptions()
	if (options.length === 0) {
		p.cancel(pc.yellow('No models configured. Add one with `tamias config`.'))
		process.exit(0)
	}

	// Filter common image models to show them at the top or give suggestions
	const imageKeywords = ['dall-e', 'dalle', 'stable-diffusion', 'flux', 'midjourney', 'imagen']
	const sortedOptions = [...options].sort((a, b) => {
		const aIsImage = imageKeywords.some(k => a.toLowerCase().includes(k))
		const bIsImage = imageKeywords.some(k => b.toLowerCase().includes(k))
		if (aIsImage && !bIsImage) return -1
		if (!aIsImage && bIsImage) return 1
		return 0
	})

	const selectedModels: string[] = []
	let remainingOptions = [...sortedOptions]

	while (remainingOptions.length > 0) {
		const label = selectedModels.length === 0 ? 'Select primary image model:' : `Select fallback image model #${selectedModels.length} (optional):`

		const opts = remainingOptions.map(o => {
			const isLikelyImage = imageKeywords.some(k => o.toLowerCase().includes(k))
			return {
				value: o,
				label: isLikelyImage ? `${o} ${pc.dim('(suggested)')}` : o
			}
		})

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

		if (selectedModels.length >= 3) break // Limit to 3 image models
	}

	if (selectedModels.length === 0) {
		p.cancel('No models selected.')
		process.exit(0)
	}

	const confirmed = await p.confirm({
		message: `Set image model priority to: ${pc.bold(pc.magenta(selectedModels.join(' → ')))}?`,
		initialValue: true,
	})

	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }

	setDefaultImageModels(selectedModels)
	p.outro(pc.green(`✅ Image model priority updated`))
}

// ─── tamias model set-compaction — interactive picker ─────────────────────────

export const runModelSetCompactionCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Set Compaction Model ')))

	const options = getAllModelOptions()
	if (options.length === 0) {
		p.cancel(pc.yellow('No models configured. Add one with `tamias config`.'))
		process.exit(0)
	}

	// Sort cheaper/smaller models to the top as suggestions
	const cheapKeywords = ['mini', 'flash', 'haiku', 'small', 'lite', 'nano', 'instant', 'turbo']
	const sortedOptions = [...options].sort((a, b) => {
		const aCheap = cheapKeywords.some(k => a.toLowerCase().includes(k))
		const bCheap = cheapKeywords.some(k => b.toLowerCase().includes(k))
		if (aCheap && !bCheap) return -1
		if (!aCheap && bCheap) return 1
		return 0
	})

	const selected = await p.select({
		message: 'Select the model for session compaction (cheap, fast model recommended):',
		options: sortedOptions.map(o => {
			const isCheap = cheapKeywords.some(k => o.toLowerCase().includes(k))
			return {
				value: o,
				label: isCheap ? `${o} ${pc.dim('(recommended — cheaper)')}` : o,
			}
		}),
	})

	if (p.isCancel(selected)) { p.cancel('Cancelled.'); process.exit(0) }

	const confirmed = await p.confirm({
		message: `Set compaction model to: ${pc.bold(pc.blue(selected as string))}?`,
		initialValue: true,
	})

	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }

	setCompactionModel(selected as string)
	p.outro(pc.green(`✅ Compaction model set to ${selected}`))
}
