import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { loadCronJobs, addCronJob, removeCronJob, updateCronJob, DEFAULT_HEARTBEAT_CONFIG } from '../utils/cronStore'

export const cronCommand = new Command('cron')
	.description('Manage recurring cron jobs and heartbeats')

cronCommand
	.command('list')
	.description('List all configured cron jobs')
	.action(() => {
		const jobs = loadCronJobs()
		if (jobs.length === 0) {
			p.note('No cron jobs configured.')
			return
		}

		console.log(pc.bold('Active Cron Jobs:'))
		jobs.forEach(job => {
			const status = job.enabled ? pc.green('enabled') : pc.red('disabled')
			console.log(`${pc.cyan(job.name)} [${pc.dim(job.id)}]`)
			console.log(`  Schedule: ${pc.yellow(job.schedule)}`)
			console.log(`  Target:   ${pc.magenta(job.target || 'last')}`)
			console.log(`  Status:   ${status}`)
			if (job.lastRun) console.log(`  Last Run: ${pc.dim(job.lastRun)}`)
			console.log('')
		})
	})

cronCommand
	.command('add')
	.description('Add a new cron job')
	.option('-n, --name <name>', 'Name of the job')
	.option('-s, --schedule <schedule>', 'Schedule (e.g. "30m", "1h", or cron expression)')
	.option('-p, --prompt <prompt>', 'Prompt for the agent')
	.option('-t, --target <target>', 'Output target (e.g. "discord:channel-id", "last")', 'last')
	.option('--heartbeat', 'Add the default 30m heartbeat job')
	.action(async (opts) => {
		try {
			let name = opts.name
			let schedule = opts.schedule
			let prompt = opts.prompt
			let target = opts.target

			if (opts.heartbeat) {
				name = name || DEFAULT_HEARTBEAT_CONFIG.name
				schedule = schedule || DEFAULT_HEARTBEAT_CONFIG.schedule
				prompt = prompt || DEFAULT_HEARTBEAT_CONFIG.prompt
				target = target || DEFAULT_HEARTBEAT_CONFIG.target
			}

			if (!name) {
				name = await p.text({
					message: 'Enter a name for the cron job:',
					placeholder: 'e.g. Morning Briefing',
					validate: (v) => !v ? 'Name is required' : undefined
				}) as string
				if (p.isCancel(name)) return
			}

			if (!schedule) {
				schedule = await p.text({
					message: 'Enter the schedule (e.g. "30m", "1h", or "* * * * *"):',
					placeholder: '30m',
					validate: (v) => !v ? 'Schedule is required' : undefined
				}) as string
				if (p.isCancel(schedule)) return
			}

			if (!prompt) {
				prompt = await p.text({
					message: 'Enter the prompt for the agent:',
					placeholder: 'Check my emails and summarize urgent ones.',
					validate: (v) => !v ? 'Prompt is required' : undefined
				}) as string
				if (p.isCancel(prompt)) return
			}

			const job = addCronJob({
				name,
				schedule,
				type: 'ai',
				prompt,
				target: target || 'last',
			})
			p.outro(pc.green(`✅ Cron job added: ${job.name} (${job.id})`))
		} catch (err) {
			p.log.error(`Failed to add cron job: ${err}`)
		}
	})

cronCommand
	.command('rm <id>')
	.description('Remove a cron job by ID')
	.action((id) => {
		try {
			removeCronJob(id)
			p.outro(pc.green(`✅ Cron job removed.`))
		} catch (err) {
			p.log.error(`Failed to remove cron job: ${err}`)
		}
	})

cronCommand
	.command('edit <id>')
	.description('Edit an existing cron job')
	.option('-n, --name <name>', 'New name')
	.option('-s, --schedule <schedule>', 'New schedule')
	.option('-p, --prompt <prompt>', 'New prompt')
	.option('-t, --target <target>', 'New target')
	.option('--disable', 'Disable the job')
	.option('--enable', 'Enable the job')
	.action((id, opts) => {
		try {
			const updates: any = {}
			if (opts.name) updates.name = opts.name
			if (opts.schedule) updates.schedule = opts.schedule
			if (opts.prompt) updates.prompt = opts.prompt
			if (opts.target) updates.target = opts.target
			if (opts.disable) updates.enabled = false
			if (opts.enable) updates.enabled = true

			const job = updateCronJob(id, updates)
			p.outro(pc.green(`✅ Cron job updated: ${job.name}`))
		} catch (err) {
			p.log.error(`Failed to update cron job: ${err}`)
		}
	})
