import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	getAllConnections,
	getConnection,
	deleteConnection,
	renameConnection,
	updateConnection,
	type ConnectionConfig,
} from '../utils/config.ts'
import { fetchModels } from '../utils/models.ts'

// ─── Display helpers ──────────────────────────────────────────────────────────

const printModels = (connections: ConnectionConfig[]) => {
	if (connections.length === 0) {
		console.log(pc.yellow('  No model configurations found. Run `tamias config` to add one.'))
		return
	}
	console.log('')
	for (const c of connections) {
		const models = c.selectedModels ?? []
		if (models.length === 0) {
			console.log(`  ${pc.bold(pc.cyan(c.nickname))}  ${pc.red('(no models selected)')}`)
		} else {
			for (const m of models) {
				console.log(`  ${pc.bold(pc.cyan(c.nickname))}${pc.dim('/')}${pc.green(m)}`)
			}
		}
	}
	console.log('')
}

// ─── Subcommand: list ─────────────────────────────────────────────────────────

export const runModelsListCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Models ')))
	const connections = getAllConnections()
	const totalModels = connections.reduce((acc, c) => acc + (c.selectedModels?.length ?? 0), 0)

	console.log(pc.bold(`\n  Found ${pc.cyan(connections.length)} configuration(s) and ${pc.green(totalModels)} selected model(s):`))
	printModels(connections)
	p.outro(pc.dim(`Config stored at: ~/.tamias/config.json`))
}

// ─── Subcommand: delete ───────────────────────────────────────────────────────

export const runModelsDeleteCommand = async (nickname?: string) => {
	p.intro(pc.bgRed(pc.white(' Tamias — Delete Model ')))
	const connections = getAllConnections()

	if (connections.length === 0) {
		p.cancel(pc.yellow('No models to delete.'))
		process.exit(0)
	}

	let chosen = nickname

	if (!chosen) {
		const result = await p.select({
			message: 'Which model config do you want to delete?',
			options: connections.map((c) => ({
				value: c.nickname,
				label: `${pc.bold(c.nickname)}  ${pc.dim(c.provider)}`,
			})),
		})
		if (p.isCancel(result)) {
			p.cancel('Cancelled.')
			process.exit(0)
		}
		chosen = result as string
	}

	const connection = connections.find((c) => c.nickname === chosen)
	if (!connection) {
		p.cancel(pc.red(`Model config '${chosen}' not found.`))
		process.exit(1)
	}

	const confirmed = await p.confirm({
		message: `Are you sure you want to delete ${pc.bold(pc.red(chosen))}?`,
		initialValue: false,
	})

	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.')
		process.exit(0)
	}

	try {
		deleteConnection(chosen)
		p.outro(pc.green(`✅ Model config '${chosen}' deleted.`))
	} catch (err) {
		p.cancel(pc.red(`❌ ${err}`))
		process.exit(1)
	}
}

// ─── Subcommand: edit ─────────────────────────────────────────────────────────

export const runModelsEditCommand = async (nickname?: string) => {
	p.intro(pc.bgYellow(pc.black(' Tamias — Edit Model ')))
	const connections = getAllConnections()

	if (connections.length === 0) {
		p.cancel(pc.yellow('No models to edit.'))
		process.exit(0)
	}

	let chosen = nickname

	if (!chosen) {
		const result = await p.select({
			message: 'Which model config do you want to edit?',
			options: connections.map((c) => ({
				value: c.nickname,
				label: `${pc.bold(c.nickname)}  ${pc.dim(c.provider)}`,
			})),
		})
		if (p.isCancel(result)) {
			p.cancel('Cancelled.')
			process.exit(0)
		}
		chosen = result as string
	}

	const connection = getConnection(chosen)
	if (!connection) {
		p.cancel(pc.red(`Model config '${chosen}' not found.`))
		process.exit(1)
	}

	const action = await p.select({
		message: `Editing ${pc.bold(chosen)}. What do you want to change?`,
		options: [
			{ value: 'nickname', label: '✏️  Rename nickname' },
			{ value: 'models', label: '🤖 Update selected models' },
		],
	})

	if (p.isCancel(action)) {
		p.cancel('Cancelled.')
		process.exit(0)
	}

	if (action === 'nickname') {
		const newNickname = await p.text({
			message: 'Enter a new nickname:',
			placeholder: connection.nickname,
			validate: (v) => {
				if (!v) return 'Nickname is required'
				if (/\s/.test(v)) return 'Nickname cannot contain spaces'
			},
		})
		if (p.isCancel(newNickname)) {
			p.cancel('Cancelled.')
			process.exit(0)
		}
		try {
			renameConnection(chosen, newNickname as string)
			p.outro(pc.green(`✅ Renamed '${chosen}' → '${newNickname}'.`))
		} catch (err) {
			p.cancel(pc.red(`❌ ${err}`))
			process.exit(1)
		}
	}

	if (action === 'models') {
		const apiKey = connection.apiKey
		if (!apiKey) {
			p.cancel(pc.yellow('This config uses OAuth and does not support model listing.'))
			process.exit(0)
		}

		const s = p.spinner()
		s.start(`Fetching available models for ${connection.provider}...`)
		const models = await fetchModels(connection.provider, apiKey)
		s.stop(models.length > 0 ? `Found ${models.length} models.` : 'Could not fetch models.')

		if (models.length === 0) {
			p.outro(pc.yellow('No models found for this provider.'))
			process.exit(0)
		}

		console.log(pc.dim('\n  ↑↓ to navigate  ·  space to toggle  ·  enter to confirm\n'))

		const currentModels = new Set(connection.selectedModels ?? [])
		const picked = await p.autocompleteMultiselect({
			message: 'Select models for this configuration:',
			options: models.map((m) => ({
				value: m.id,
				label: m.name !== m.id ? `${m.id}  ${pc.dim(m.name)}` : m.id,
			})),
			initialValues: [...currentModels],
			required: false,
		})

		if (p.isCancel(picked)) {
			p.cancel('Cancelled.')
			process.exit(0)
		}

		try {
			updateConnection(chosen, { selectedModels: picked as string[] })
			p.outro(pc.green(`✅ Updated ${(picked as string[]).length} model(s) for '${chosen}'.`))
		} catch (err) {
			p.cancel(pc.red(`❌ ${err}`))
			process.exit(1)
		}
	}
}

// ─── Main models command (interactive menu) ──────────────────────────────

export const runModelsCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Model Manager ')))

	const action = await p.select({
		message: 'What would you like to do?',
		options: [
			{ value: 'list', label: '📋 List all model configs' },
			{ value: 'add', label: '➕ Add a new model config' },
			{ value: 'edit', label: '✏️  Edit a model config' },
			{ value: 'delete', label: '🗑️  Delete a model config' },
		],
	})

	if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0) }

	// Import config command lazily to avoid circular deps
	const { runConfigCommand } = await import('./config')

	switch (action) {
		case 'list': return runModelsListCommand()
		case 'add': return runConfigCommand()
		case 'edit': return runModelsEditCommand()
		case 'delete': return runModelsDeleteCommand()
	}
}
