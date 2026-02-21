import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { loadAgents, addAgent, removeAgent, updateAgent } from '../utils/agentsStore.ts'

export const agentsCommand = new Command('agents')
	.description('Manage reusable agent identities (personas) for sub-agents')

agentsCommand
	.command('list')
	.description('List all registered agents')
	.action(() => {
		const agents = loadAgents()
		if (agents.length === 0) {
			p.note('No agents registered. Use `tamias agents add` to create one.')
			return
		}

		console.log(pc.bold('Registered Agents:'))
		agents.forEach(agent => {
			console.log(`${pc.cyan(agent.name)} [${pc.dim(agent.id)}]`)
			if (agent.model) console.log(`  Model: ${pc.yellow(agent.model)}`)
			console.log(`  Instructions: ${pc.dim(agent.instructions.slice(0, 100))}${agent.instructions.length > 100 ? '...' : ''}`)
			console.log('')
		})
	})

agentsCommand
	.command('add')
	.description('Register a new reusable agent')
	.option('-n, --name <name>', 'Name of the agent')
	.option('-m, --model <model>', 'Optional model override (e.g. "openai/gpt-4o")')
	.option('-i, --instructions <instructions>', 'The system instructions for this agent')
	.action(async (opts) => {
		try {
			let name = opts.name
			let model = opts.model
			let instructions = opts.instructions

			if (!name) {
				name = await p.text({
					message: 'Enter a name for the agent:',
					placeholder: 'e.g. Researcher',
					validate: (v) => !v ? 'Name is required' : undefined
				}) as string
				if (p.isCancel(name)) return
			}

			if (!instructions) {
				instructions = await p.text({
					message: 'Enter the system instructions for this agent:',
					placeholder: 'You are a research assistant focus on finding facts...',
					validate: (v) => !v ? 'Instructions are required' : undefined
				}) as string
				if (p.isCancel(instructions)) return
			}

			const agent = addAgent({ name, model, instructions })
			p.outro(pc.green(`✅ Agent registered: ${agent.name} (${agent.id})`))
		} catch (err) {
			p.log.error(`Failed to register agent: ${err}`)
		}
	})

agentsCommand
	.command('rm <id>')
	.alias('delete')
	.description('Remove an agent definition by ID')
	.action((id) => {
		try {
			removeAgent(id)
			p.outro(pc.green(`✅ Agent removed.`))
		} catch (err) {
			p.log.error(`Failed to remove agent: ${err}`)
		}
	})

agentsCommand
	.command('edit <id>')
	.description('Edit an existing agent definition')
	.option('-n, --name <name>', 'New name')
	.option('-m, --model <model>', 'New model override')
	.option('-i, --instructions <instructions>', 'New instructions')
	.action(async (id, opts) => {
		try {
			const updates: any = {}
			if (opts.name) updates.name = opts.name
			if (opts.model) updates.model = opts.model
			if (opts.instructions) updates.instructions = opts.instructions

			// If no options provided, prompt interactively for fields
			if (Object.keys(updates).length === 0) {
				const agents = loadAgents()
				const agent = agents.find(a => a.id === id)
				if (!agent) {
					p.log.error(`Agent ${id} not found`)
					return
				}

				const field = await p.select({
					message: 'What do you want to edit?',
					options: [
						{ value: 'name', label: 'Name' },
						{ value: 'model', label: 'Model override' },
						{ value: 'instructions', label: 'Instructions' }
					]
				}) as string
				if (p.isCancel(field)) return

				const newVal = await p.text({
					message: `Enter new value for ${field}:`,
					initialValue: (agent as any)[field] || ''
				}) as string
				if (p.isCancel(newVal)) return
				updates[field] = newVal
			}

			const agent = updateAgent(id, updates)
			p.outro(pc.green(`✅ Agent updated: ${agent.name}`))
		} catch (err) {
			p.log.error(`Failed to update agent: ${err}`)
		}
	})
