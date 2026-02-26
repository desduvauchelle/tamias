/**
 * `tamias setup` — Interactive setup wizard.
 *
 * Walks through:
 *  1. Provider configuration (add or verify)
 *  2. Default model selection
 *  3. Channel setup (Discord, Telegram, WhatsApp)
 *  4. Workspace directory
 *  5. Identity (USER.md, IDENTITY.md)
 *  6. Health check summary
 */

import * as p from '@clack/prompts'
import pc from 'picocolors'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
	loadConfig,
	TAMIAS_DIR,
	CONFIG_PATH,
	getAllModelOptions,
	getDefaultModel,
	setDefaultModels,
	getDefaultWorkspacePath,
	setWorkspacePath,
} from '../utils/config.ts'
import { writePersonaFile, readPersonaFile, scaffoldFromTemplates } from '../utils/memory.ts'
import { runConfigCommand } from './config.ts'
import { runHealthChecks, formatHealthReport } from '../utils/health/index.ts'
import { expandHome } from '../utils/path.ts'

export const runSetupCommand = async () => {
	p.intro(pc.bgMagenta(pc.black(' Tamias — Setup Wizard ')))

	// Ensure base directory exists
	if (!existsSync(TAMIAS_DIR)) {
		mkdirSync(TAMIAS_DIR, { recursive: true })
		console.log(pc.dim(`  Created ${TAMIAS_DIR}`))
	}

	// Scaffold templates if missing
	scaffoldFromTemplates()

	const config = loadConfig()
	const connections = Object.keys(config.connections)

	// ── Step 1: Provider configuration ──────────────────────────────
	console.log()
	p.note(
		connections.length > 0
			? `You have ${connections.length} provider(s) configured: ${connections.join(', ')}`
			: 'No AI providers configured yet.',
		'Step 1: AI Providers',
	)

	if (connections.length === 0) {
		console.log(pc.yellow('  You need at least one provider to use Tamias.'))
		await runConfigCommand()
	} else {
		const addMore = await p.confirm({
			message: 'Would you like to add another provider?',
			initialValue: false,
		})
		if (addMore === true) {
			await runConfigCommand()
		}
	}

	// ── Step 2: Default model ───────────────────────────────────────
	const refreshedConfig = loadConfig()
	const allModels = getAllModelOptions()
	const currentDefault = getDefaultModel()

	console.log()
	p.note(
		currentDefault ? `Current default: ${currentDefault}` : 'No default model set.',
		'Step 2: Default Model',
	)

	if (allModels.length > 0 && !currentDefault) {
		const picked = await p.select({
			message: 'Pick a default model:',
			options: allModels.map(m => ({ value: m, label: m })),
		})
		if (!p.isCancel(picked)) {
			setDefaultModels([picked as string])
			console.log(pc.green(`  ✓ Default model set to ${picked}`))
		}
	}

	// ── Step 3: Workspace directory ─────────────────────────────────
	const currentWorkspace = getDefaultWorkspacePath()

	console.log()
	p.note(
		currentWorkspace ? `Current workspace: ${currentWorkspace}` : 'No workspace directory set.',
		'Step 3: Workspace',
	)

	const changeWorkspace = await p.confirm({
		message: currentWorkspace
			? 'Would you like to change the workspace directory?'
			: 'Would you like to set a workspace directory? (restricts file access)',
		initialValue: !currentWorkspace,
	})

	if (changeWorkspace === true) {
		const wsPath = await p.text({
			message: 'Enter the workspace directory path:',
			placeholder: '~/projects',
			defaultValue: currentWorkspace ?? '~/projects',
			validate: (v) => {
				if (!v) return 'Path is required'
				const expanded = expandHome(v)
				if (!existsSync(expanded)) return `Directory does not exist: ${expanded}`
			},
		})
		if (!p.isCancel(wsPath)) {
			setWorkspacePath(wsPath as string)
			console.log(pc.green(`  ✓ Workspace set to ${wsPath}`))
		}
	}

	// ── Step 4: Channels ────────────────────────────────────────────
	const bridges = refreshedConfig.bridges
	const hasDiscord = Object.keys(bridges?.discords ?? {}).length > 0
	const hasTelegram = Object.keys(bridges?.telegrams ?? {}).length > 0
	const hasWhatsApp = Object.keys((bridges as any)?.whatsapps ?? {}).length > 0

	console.log()
	const channelStatus = [
		hasDiscord ? '✓ Discord' : '○ Discord',
		hasTelegram ? '✓ Telegram' : '○ Telegram',
		hasWhatsApp ? '✓ WhatsApp' : '○ WhatsApp',
	].join('  ')
	p.note(channelStatus, 'Step 4: Channels')

	const setupChannels = await p.confirm({
		message: 'Would you like to configure channels? (use `tamias channels add` for detailed setup)',
		initialValue: false,
	})

	if (setupChannels === true) {
		const { runChannelsAddCommand } = await import('./channels.ts')
		await runChannelsAddCommand()
	}

	// ── Step 5: Identity ────────────────────────────────────────────
	console.log()
	const userFile = readPersonaFile('USER.md')
	const identityFile = readPersonaFile('IDENTITY.md')

	p.note(
		`USER.md: ${userFile ? 'configured' : 'empty / template'}\n` +
		`IDENTITY.md: ${identityFile ? 'configured' : 'empty / template'}`,
		'Step 5: Identity',
	)

	if (!userFile || userFile.includes('<!-- Replace this')) {
		const editUser = await p.confirm({
			message: 'Would you like to set up your user profile (USER.md)?',
			initialValue: true,
		})

		if (editUser === true) {
			const name = await p.text({ message: 'Your name:', placeholder: 'Jane' })
			const role = await p.text({ message: 'Your role or title:', placeholder: 'Developer' })
			const notes = await p.text({
				message: 'Additional notes (timezone, preferences, etc.):',
				placeholder: 'Pacific time, prefers concise responses',
			})

			if (!p.isCancel(name)) {
				const content = [
					`# User Profile`,
					``,
					`- **Name:** ${name}`,
					role && !p.isCancel(role) ? `- **Role:** ${role}` : '',
					notes && !p.isCancel(notes) ? `- **Notes:** ${notes}` : '',
					``,
					`<!-- Edit this file at ~/.tamias/memory/USER.md -->`,
				].filter(Boolean).join('\n')

				writePersonaFile('USER.md', content)
				console.log(pc.green('  ✓ USER.md saved'))
			}
		}
	}

	// ── Step 6: Health check ────────────────────────────────────────
	console.log()
	p.note('Running health checks...', 'Step 6: Health Check')

	const report = await runHealthChecks({ autoFix: true, silent: true })
	const passed = report.results.filter(r => r.status === 'ok').length
	const warned = report.results.filter(r => r.status === 'warn').length
	const failed = report.results.filter(r => r.status === 'error').length

	if (failed > 0) {
		console.log(pc.red(`  ${failed} issue(s) found:`))
		for (const r of report.results.filter(r => r.status === 'error')) {
			console.log(pc.red(`    ✗ ${r.id}: ${r.message}`))
			if (r.fix) console.log(pc.dim(`      Fix: ${r.fix.action}`))
		}
	}
	if (warned > 0) {
		for (const r of report.results.filter(r => r.status === 'warn')) {
			console.log(pc.yellow(`  ⚠ ${r.id}: ${r.message}`))
		}
	}
	if (failed === 0) {
		console.log(pc.green(`  ✓ All ${passed} checks passed${warned > 0 ? ` (${warned} warnings)` : ''}`))
	}

	// ── Done ────────────────────────────────────────────────────────
	console.log()
	p.outro(pc.green('Setup complete! Run `tamias start` to launch the daemon, or `tamias chat` for quick chat.'))
}
