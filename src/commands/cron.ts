import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, appendFileSync } from 'fs'
import { getLogFilePath } from '../utils/logPaths.ts'
import {
	loadCronJobs, addCronJob, removeCronJob, updateCronJob,
	recordCronJobRun, isJobDue, DEFAULT_HEARTBEAT_CONFIG,
	type CronJob
} from '../utils/cronStore.ts'
import { readDaemonInfo } from '../utils/daemon.ts'

export const cronCommand = new Command('cron')
	.description('Manage recurring cron jobs and heartbeats')

export interface RunCronJobsOnceOptions {
	jobId?: string
	dryRun?: boolean
	daemonUrl: string | null
	daemonToken: string
	loadJobsFn?: () => CronJob[]
	isJobDueFn?: (job: CronJob) => boolean
	executeJobFn?: (job: CronJob, daemonUrl: string | null, token: string) => Promise<void>
	recordRunFn?: (id: string, result: { status: 'success' | 'error'; error?: string }) => CronJob | undefined
	removeJobFn?: (id: string) => void
	logFn?: (...args: unknown[]) => void
	errorFn?: (...args: unknown[]) => void
	logPrefix?: string
}

export async function runCronJobsOnce(opts: RunCronJobsOnceOptions): Promise<{ dueCount: number; executedCount: number; failedCount: number }> {
	const log = opts.logFn ?? console.log
	const error = opts.errorFn ?? console.error
	const logPrefix = opts.logPrefix ?? '[cron run]'
	const loadJobsFn = opts.loadJobsFn ?? loadCronJobs
	const isJobDueFn = opts.isJobDueFn ?? isJobDue
	const executeJobFn = opts.executeJobFn ?? executeCronJob
	const recordRunFn = opts.recordRunFn ?? recordCronJobRun
	const removeJobFn = opts.removeJobFn ?? removeCronJob

	const allJobs = loadJobsFn()
	const enabledJobs = allJobs.filter(j => j.enabled)

	let dueJobs: CronJob[]
	if (opts.jobId) {
		const job = allJobs.find(j => j.id === opts.jobId)
		if (!job) throw new Error(`Job '${opts.jobId}' not found`)
		dueJobs = [job]
	} else {
		dueJobs = enabledJobs.filter(j => isJobDueFn(j))
	}

	if (dueJobs.length === 0) {
		return { dueCount: 0, executedCount: 0, failedCount: 0 }
	}

	if (opts.dryRun) {
		log(`${logPrefix} ${dueJobs.length} job(s) due:`)
		for (const job of dueJobs) {
			const schedStr = job.runAt ? `runAt=${job.runAt}` : `schedule=${job.schedule}`
			log(`  - ${job.name} (${job.id}) ${schedStr}`)
		}
		return { dueCount: dueJobs.length, executedCount: 0, failedCount: 0 }
	}

	let executedCount = 0
	let failedCount = 0
	for (const job of dueJobs) {
		const now = new Date().toISOString()
		log(`${logPrefix} ${now} Executing job: "${job.name}" (id=${job.id}, type=${job.type ?? 'ai'})`)

		try {
			await executeJobFn(job, opts.daemonUrl, opts.daemonToken)
			recordRunFn(job.id, { status: 'success' })
			executedCount += 1
			log(`${logPrefix} ${now} ✓ Job "${job.name}" completed successfully`)
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err)
			recordRunFn(job.id, { status: 'error', error: errorMsg })
			failedCount += 1
			error(`${logPrefix} ${now} ✗ Job "${job.name}" failed: ${errorMsg}`)
		}
		// One-shot jobs auto-delete after firing (success or failure)
		if (job.runAt) {
			try { removeJobFn(job.id) } catch { /* already removed */ }
		}
	}

	return { dueCount: dueJobs.length, executedCount, failedCount }
}

// ─── tamias cron list ─────────────────────────────────────────────────────────

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
			const scheduleDisplay = job.runAt
				? `One-time: ${pc.yellow(job.runAt)}`
				: `Recurring: ${pc.yellow(job.schedule ?? '(none)')}`
			console.log(`  Schedule:    ${scheduleDisplay}`)
			console.log(`  Type:        ${pc.magenta(job.type || 'ai')}`)
			console.log(`  Status:      ${status}`)
			if (job.skills?.length) console.log(`  Skills:      ${pc.blue(job.skills.join(', '))}`)
			if (job.sessionKey) console.log(`  Session Key: ${pc.dim(job.sessionKey)}`)
			if (job.context) console.log(`  Context:     ${pc.dim(job.context.slice(0, 60))}${job.context.length > 60 ? '…' : ''}`)
			if (job.delivery) {
				const parts = [`platform=${job.delivery.platform}`, `channel=${job.delivery.channelId}`]
				if (job.delivery.emailTo) parts.push(`email=${job.delivery.emailTo}`)
				if (job.delivery.filePath) parts.push(`file=${job.delivery.filePath}`)
				console.log(`  Delivery:    ${pc.dim(parts.join(', '))}`)
			} else if (job.target) {
				console.log(`  Target:      ${pc.dim(job.target)}`)
			}
			if (job.lastRun) {
				const statusIcon = job.lastStatus === 'success' ? pc.green('✓') : pc.red('✗')
				console.log(`  Last Run:    ${pc.dim(job.lastRun)} ${statusIcon}`)
			}
			if (job.lastError) console.log(`  Last Error:  ${pc.red(job.lastError)}`)
			console.log('')
		})
	})

// ─── tamias cron add ──────────────────────────────────────────────────────────

cronCommand
	.command('add')
	.description('Add a new cron job')
	.option('-n, --name <name>', 'Name of the job')
	.option('-s, --schedule <schedule>', 'Recurring schedule (cron expression or interval like "30m", "1h")')
	.option('--run-at <datetime>', 'One-shot: ISO datetime or natural language like "tomorrow at 9am"')
	.option('-p, --prompt <prompt>', 'Prompt for the agent (or message text)')
	.option('-T, --type <type>', 'Job type: "ai" or "message"', 'ai')
	.option('--skills <skills>', 'Comma-separated skill slugs (e.g. "researcher,writer")')
	.option('--session-key <key>', 'Stable session key for interactive/stateful workflows')
	.option('--context <context>', 'Extra context injected before the prompt')
	.option('--target-channel <target>', 'Delivery: "platform:channelId" (e.g. "discord:12345")')
	.option('--target-email <email>', 'Delivery: email address to send response to')
	.option('--target-file <path>', 'Delivery: file path to append response to')
	.option('-t, --target <target>', 'Legacy target string (e.g. "last", "discord:id")', 'last')
	.option('--heartbeat', 'Add the default 30m heartbeat job')
	.action(async (opts) => {
		try {
			let name = opts.name
			let schedule = opts.schedule
			let runAt: string | undefined = opts.runAt
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

			if (!schedule && !runAt) {
				const mode = await p.select({
					message: 'Schedule type:',
					options: [
						{ value: 'recurring', label: 'Recurring (interval or cron expression)' },
						{ value: 'once', label: 'One-time (run at a specific date/time)' },
					],
				}) as string
				if (p.isCancel(mode)) return

				if (mode === 'once') {
					runAt = await p.text({
						message: 'Enter date/time for the reminder (ISO datetime or "tomorrow at 9am"):',
						placeholder: '2026-04-06T09:00:00.000Z',
						validate: (v) => !v ? 'Date/time is required' : undefined
					}) as string
					if (p.isCancel(runAt)) return
				} else {
					schedule = await p.text({
						message: 'Enter the schedule (cron expression like "0 9 * * 1-5" or interval like "30m"):',
						placeholder: '0 9 * * 1-5',
						validate: (v) => !v ? 'Schedule is required' : undefined
					}) as string
					if (p.isCancel(schedule)) return
				}
			}

			if (!prompt) {
				prompt = await p.text({
					message: 'Enter the prompt for the agent:',
					placeholder: 'Check my emails and summarize urgent ones.',
					validate: (v) => !v ? 'Prompt is required' : undefined
				}) as string
				if (p.isCancel(prompt)) return
			}

			// Build delivery from target flags
			let delivery: CronJob['delivery'] | undefined
			if (opts.targetChannel || opts.targetEmail || opts.targetFile) {
				const channelParts = opts.targetChannel?.split(':') ?? []
				delivery = {
					platform: channelParts[0] || 'none',
					channelId: channelParts.slice(1).join(':') || '',
					emailTo: opts.targetEmail,
					emailSubject: opts.targetEmail ? `Tamias Cron: ${name}` : undefined,
					filePath: opts.targetFile,
				}
			}

			const skills = opts.skills ? opts.skills.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined

			const job = addCronJob({
				name,
				...(runAt ? { runAt } : { schedule }),
				type: opts.type as 'ai' | 'message',
				prompt,
				skills,
				sessionKey: opts.sessionKey,
				context: opts.context,
				delivery,
				target: target || 'last',
			})
			const schedDesc = job.runAt ? `one-time at ${job.runAt}` : `recurring ${job.schedule}`
			p.outro(pc.green(`✅ Cron job added: ${job.name} (${job.id}) — ${schedDesc}`))
			p.note('If the daemon is running, this cron will run automatically every minute. `tamias cron install` remains available as an external fallback.', 'Tip')
		} catch (err) {
			p.log.error(`Failed to add cron job: ${err}`)
		}
	})

// ─── tamias cron rm ───────────────────────────────────────────────────────────

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

// ─── tamias cron edit ─────────────────────────────────────────────────────────

cronCommand
	.command('edit <id>')
	.description('Edit an existing cron job')
	.option('-n, --name <name>', 'New name')
	.option('-s, --schedule <schedule>', 'New schedule')
	.option('-p, --prompt <prompt>', 'New prompt')
	.option('-T, --type <type>', 'New type: "ai" or "message"')
	.option('--skills <skills>', 'New comma-separated skill slugs')
	.option('--session-key <key>', 'New session key')
	.option('--context <context>', 'New context')
	.option('-t, --target <target>', 'New target')
	.option('--disable', 'Disable the job')
	.option('--enable', 'Enable the job')
	.action((id, opts) => {
		try {
			const updates: Partial<Omit<CronJob, 'id' | 'createdAt'>> = {}
			if (opts.name) updates.name = opts.name
			if (opts.schedule) updates.schedule = opts.schedule
			if (opts.prompt) updates.prompt = opts.prompt
			if (opts.type) updates.type = opts.type
			if (opts.skills) updates.skills = opts.skills.split(',').map((s: string) => s.trim()).filter(Boolean)
			if (opts.sessionKey) updates.sessionKey = opts.sessionKey
			if (opts.context) updates.context = opts.context
			if (opts.target) updates.target = opts.target
			if (opts.disable) updates.enabled = false
			if (opts.enable) updates.enabled = true

			const job = updateCronJob(id, updates)
			p.outro(pc.green(`✅ Cron job updated: ${job.name}`))
		} catch (err) {
			p.log.error(`Failed to update cron job: ${err}`)
		}
	})

// ─── tamias cron run ──────────────────────────────────────────────────────────
// Stateless runner — called from system crontab every minute.
// Checks which jobs are due, fires them, exits.

cronCommand
	.command('run')
	.description('Run all due cron jobs once (manual or external scheduler)')
	.option('--job <id>', 'Run a specific job by ID regardless of schedule')
	.option('--dry-run', 'Check which jobs would run without executing them')
	.action(async (opts) => {
		const daemonInfo = readDaemonInfo()
		const daemonUrl = daemonInfo ? `http://127.0.0.1:${daemonInfo.port}` : null
		const daemonToken = daemonInfo?.token ?? ''
		try {
			await runCronJobsOnce({
				jobId: opts.job,
				dryRun: opts.dryRun,
				daemonUrl,
				daemonToken,
			})
		} catch (err) {
			console.error(`[cron run] ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	})

// ─── Job execution ────────────────────────────────────────────────────────────

async function executeCronJob(job: CronJob, daemonUrl: string | null, token: string): Promise<void> {
	if (job.type === 'message') {
		await executeMessageJob(job, daemonUrl, token)
	} else {
		await executeAiJob(job, daemonUrl, token)
	}
}

function authHeaders(token: string): Record<string, string> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (token) headers['Authorization'] = `Bearer ${token}`
	return headers
}

/** type=message — send the prompt text directly to the channel, no AI. */
async function executeMessageJob(job: CronJob, daemonUrl: string | null, token: string): Promise<void> {
	if (!daemonUrl) throw new Error('Daemon is not running — cannot deliver message. Start it with `tamias start`.')

	const sessionId = await resolveSession(job, daemonUrl, token)
	const res = await fetch(`${daemonUrl}/message`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			sessionId,
			content: job.prompt,
			metadata: { source: 'from-cron', cronJobId: job.id },
		}),
	})
	if (!res.ok) throw new Error(`Daemon /message returned ${res.status}: ${await res.text()}`)

	if (job.delivery?.filePath) {
		appendToFile(job.delivery.filePath, job.prompt)
	}
}

/** type=ai — send prompt to AI via daemon, then handle extra delivery (email, file). */
async function executeAiJob(job: CronJob, daemonUrl: string | null, token: string): Promise<void> {
	if (!daemonUrl) throw new Error('Daemon is not running — cannot run AI job. Start it with `tamias start`.')

	const fullPrompt = buildPrompt(job)
	const sessionId = await resolveSession(job, daemonUrl, token)

	const res = await fetch(`${daemonUrl}/message`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			sessionId,
			content: fullPrompt,
			metadata: {
				source: 'from-cron',
				cronJobId: job.id,
				skills: job.skills,
			},
		}),
	})
	if (!res.ok) throw new Error(`Daemon /message returned ${res.status}: ${await res.text()}`)

	if (job.delivery?.emailTo || job.delivery?.filePath) {
		const response = await waitForAiResponse(sessionId, daemonUrl, token)

		if (job.delivery.filePath) {
			appendToFile(job.delivery.filePath, response)
		}

		if (job.delivery.emailTo) {
			await deliverByEmail(job, response, daemonUrl, token)
		}
	}
}

export function buildPrompt(job: CronJob): string {
	const parts: string[] = []
	if (job.context) {
		parts.push(`[Context]\n${job.context}\n`)
	}
	if (job.skills?.length) {
		parts.push(`[Active Skills: ${job.skills.join(', ')}]\n`)
	}
	parts.push(job.prompt)
	return parts.join('\n')
}

async function resolveSession(job: CronJob, daemonUrl: string, token: string): Promise<string> {
	const channelId = job.delivery
		? `${job.delivery.platform}:${job.delivery.channelId}`
		: (job.target && job.target !== 'last' ? job.target : undefined)

	const channelUserId = job.sessionKey || `cron:${job.id}`

	if (channelId) {
		const sessionsRes = await fetch(`${daemonUrl}/sessions`, { headers: authHeaders(token) })
		if (sessionsRes.ok) {
			const sessions = await sessionsRes.json() as Array<{ id: string; channelId: string; channelUserId: string }>
			const existing = sessions.find(s =>
				s.channelId === channelId && s.channelUserId === channelUserId
			)
			if (existing) {
				console.log(`[cron run] Reusing session ${existing.id} for job "${job.name}"`)
				return existing.id
			}
		}
	}

	const createRes = await fetch(`${daemonUrl}/session`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			channelId: channelId || undefined,
			channelUserId,
		}),
	})
	if (!createRes.ok) throw new Error(`Failed to create session: ${createRes.status}`)
	const { sessionId } = await createRes.json() as { sessionId: string }
	console.log(`[cron run] Created session ${sessionId} for job "${job.name}"`)
	return sessionId
}

async function waitForAiResponse(sessionId: string, daemonUrl: string, token: string, timeoutMs = 120_000): Promise<string> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const headers: Record<string, string> = {}
		if (token) headers['Authorization'] = `Bearer ${token}`
		const res = await fetch(`${daemonUrl}/session/${sessionId}/stream`, {
			headers,
			signal: controller.signal,
		})
		if (!res.ok || !res.body) throw new Error(`SSE stream failed: ${res.status}`)

		let response = ''
		const reader = res.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split('\n')
			buffer = lines.pop() || ''

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					try {
						const evt = JSON.parse(line.slice(6)) as { type: string; text?: string }
						if (evt.type === 'chunk' && evt.text) {
							response += evt.text
						}
						if (evt.type === 'done') {
							return response
						}
					} catch { /* ignore parse errors */ }
				}
			}
		}
		return response
	} finally {
		clearTimeout(timeout)
	}
}

function appendToFile(filePath: string, content: string): void {
	const resolved = filePath.startsWith('~')
		? join(homedir(), filePath.slice(1))
		: filePath
	try {
		const { mkdirSync, existsSync: fsExists } = require('fs')
		const { dirname } = require('path')
		const dir = dirname(resolved)
		if (!fsExists(dir)) mkdirSync(dir, { recursive: true })
		appendFileSync(resolved, `\n---\n${new Date().toISOString()}\n\n${content}\n`, 'utf-8')
		console.log(`[cron run] Appended response to ${resolved}`)
	} catch (err) {
		console.error(`[cron run] Failed to write to ${resolved}:`, err)
	}
}

async function deliverByEmail(job: CronJob, response: string, daemonUrl: string, token: string): Promise<void> {
	if (!job.delivery?.emailTo) return

	const createRes = await fetch(`${daemonUrl}/session`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({}),
	})
	if (!createRes.ok) throw new Error(`Failed to create email session: ${createRes.status}`)
	const { sessionId } = await createRes.json() as { sessionId: string }

	const subject = job.delivery.emailSubject || `Tamias Cron: ${job.name}`
	const emailPrompt = `Send an email to ${job.delivery.emailTo} with subject "${subject}" and the following content:\n\n${response}`

	const res = await fetch(`${daemonUrl}/message`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			sessionId,
			content: emailPrompt,
			metadata: { source: 'from-cron', cronJobId: job.id },
		}),
	})
	if (!res.ok) {
		console.error(`[cron run] Email delivery failed: ${res.status}`)
	} else {
		console.log(`[cron run] Email delivery queued to ${job.delivery.emailTo}`)
	}
}

// ─── tamias cron install ──────────────────────────────────────────────────────

cronCommand
	.command('install')
	.description('Install the system crontab entry to run cron jobs every minute')
	.action(async () => {
		try {
			const { execSync } = await import('child_process')
			const tamiasPath = process.execPath

			const isCompiled = !existsSync(import.meta.dir || '')
			const cronLogPath = getLogFilePath('cron.log')
			let cronLine: string
			if (isCompiled) {
				cronLine = `* * * * * ${tamiasPath} cron run >> ${cronLogPath} 2>&1`
			} else {
				const bunPath = process.argv[0]
				const indexPath = join(import.meta.dir, '..', 'index.ts')
				cronLine = `* * * * * ${bunPath} ${indexPath} cron run >> ${cronLogPath} 2>&1`
			}

			let existing = ''
			try {
				existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
			} catch { /* no crontab yet */ }

			if (existing.includes('tamias cron run') || existing.includes('cron run')) {
				p.outro(pc.yellow('⚠️  Tamias cron entry already exists in crontab.'))
				console.log(pc.dim('Current entry:'))
				const lines = existing.split('\n').filter(l => l.includes('cron run'))
				lines.forEach(l => console.log(`  ${l}`))
				return
			}

			const newCrontab = existing.trimEnd() + '\n' + cronLine + '\n'
			execSync(`echo ${JSON.stringify(newCrontab)} | crontab -`)

			p.outro(pc.green('✅ Crontab entry installed! Tamias cron will run every minute.'))
			console.log(pc.dim(`Entry: ${cronLine}`))
			console.log(pc.dim(`Logs:  ${cronLogPath}`))
		} catch (err) {
			p.log.error(`Failed to install crontab: ${err}`)
		}
	})

// ─── tamias cron uninstall ────────────────────────────────────────────────────

cronCommand
	.command('uninstall')
	.description('Remove the system crontab entry')
	.action(async () => {
		try {
			const { execSync } = await import('child_process')
			let existing = ''
			try {
				existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
			} catch {
				p.outro(pc.yellow('No crontab found — nothing to remove.'))
				return
			}

			const filtered = existing
				.split('\n')
				.filter(l => !l.includes('tamias') || !l.includes('cron run'))
				.join('\n')

			if (filtered.trim() === existing.trim()) {
				p.outro(pc.yellow('No Tamias cron entry found in crontab.'))
				return
			}

			if (filtered.trim() === '') {
				execSync('crontab -r 2>/dev/null')
			} else {
				execSync(`echo ${JSON.stringify(filtered)} | crontab -`)
			}
			p.outro(pc.green('✅ Tamias cron entry removed from crontab.'))
		} catch (err) {
			p.log.error(`Failed to uninstall crontab: ${err}`)
		}
	})
