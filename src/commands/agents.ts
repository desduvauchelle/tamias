import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { loadAgents, addAgent, removeAgent, updateAgent, findAgent, getAgentDir, slugify, AGENTS_PERSONAS_DIR } from '../utils/agentsStore.ts'
import { runChatCommand } from './chat.ts'

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
			const status = agent.enabled ? pc.green('enabled') : pc.red('disabled')
			console.log(`${pc.cyan(agent.name)} ${pc.dim(`[${agent.id}]`)} ${pc.dim(`slug:${agent.slug}`)} (${status})`)
			if (agent.model) console.log(`  Model: ${pc.yellow(agent.model)}`)
			if (agent.channels?.length) console.log(`  Channels: ${agent.channels.join(', ')}`)
			if (agent.extraSkills?.length) console.log(`  Extra skills: ${agent.extraSkills.join(', ')}`)
			console.log(`  Instructions: ${pc.dim(agent.instructions.slice(0, 100))}${agent.instructions.length > 100 ? '...' : ''}`)
			console.log('')
		})
	})

agentsCommand
	.command('add')
	.description('Register a new reusable agent')
	.option('-n, --name <name>', 'Name of the agent')
	.option('-s, --slug <slug>', 'URL-friendly slug (auto-derived from name if not set)')
	.option('-m, --model <model>', 'Optional model override (e.g. "openai/gpt-4o")')
	.option('-i, --instructions <instructions>', 'The system instructions for this agent')
	.option('-c, --channels <channels>', 'Comma-separated channel IDs to bind this agent to')
	.option('-x, --extra-skills <skills>', 'Comma-separated skill names to give this agent extra access to')
	.action(async (opts) => {
		try {
			let name = opts.name
			let model = opts.model
			let instructions = opts.instructions
			const channels = opts.channels ? opts.channels.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
			const extraSkills = opts.extraSkills ? opts.extraSkills.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
			const slug = opts.slug || undefined

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

			const agent = addAgent({ name, slug, model, instructions, channels, extraSkills })
			p.outro(pc.green(`✅ Agent registered: ${agent.name} (slug: ${agent.slug}, id: ${agent.id})\nPersona dir: ${getAgentDir(agent.slug)}`))
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

agentsCommand
	.command('show <query>')
	.description('Show details and persona dir for an agent (by id, slug, or name)')
	.action((query) => {
		const agent = findAgent(query)
		if (!agent) {
			p.log.error(`Agent "${query}" not found`)
			return
		}
		const dir = getAgentDir(agent.slug)
		console.log(pc.bold(`${agent.name}`))
		console.log(`  ID:           ${pc.dim(agent.id)}`)
		console.log(`  Slug:         ${pc.cyan(agent.slug)}`)
		console.log(`  Status:       ${agent.enabled ? pc.green('enabled') : pc.red('disabled')}`)
		if (agent.model) console.log(`  Model:        ${pc.yellow(agent.model)}`)
		if (agent.channels?.length) console.log(`  Channels:     ${agent.channels.join(', ')}`)
		if (agent.extraSkills?.length) console.log(`  Extra skills: ${agent.extraSkills.join(', ')}`)
		console.log(`  Persona dir:  ${pc.dim(dir)}`)
		console.log(`  Instructions: ${agent.instructions}`)
	})

agentsCommand
	.command('chat <query>')
	.description('Chat interactively with a named agent (by id, slug, or name)')
	.action(async (query) => {
		const agent = findAgent(query)
		if (!agent) {
			p.log.error(`Agent "${query}" not found`)
			process.exit(1)
		}
		if (!agent.enabled) {
			p.log.warn(`Agent "${agent.name}" is disabled. Proceeding anyway.`)
		}
		await runChatCommand({ agentId: agent.id, agentName: agent.name })
	})
