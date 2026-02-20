import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	getBridgesConfig,
	setBridgesConfig,
} from '../utils/config.ts'

// ─── List ─────────────────────────────────────────────────────────────────────

export const runChannelsListCommand = async () => {
	p.intro(pc.bgMagenta(pc.white(' Tamias — Channels ')))
	const bridges = getBridgesConfig()

	console.log(pc.bold('\n  Configured Channels:\n'))

	// Terminal
	const terminalStatus = bridges.terminal?.enabled !== false ? pc.green('enabled') : pc.red('disabled')
	console.log(`  ${pc.bold(pc.cyan('terminal'))}  [${terminalStatus}]  ${pc.dim('Local CLI interface')}`)

	// Discord
	if (bridges.discord) {
		const discordStatus = bridges.discord.enabled ? pc.green('enabled') : pc.red('disabled')
		const tokenInfo = bridges.discord.botToken ? '(Token Configured)' : '(No Token)'
		console.log(`  ${pc.bold(pc.cyan('discord'))}   [${discordStatus}]  ${pc.dim(tokenInfo)}`)
		if (bridges.discord.allowedChannels?.length) {
			console.log(`     ${pc.dim('↳')} Allowed channels: ${bridges.discord.allowedChannels.join(', ')}`)
		}
	}

	// Telegram
	if (bridges.telegram) {
		const telegramStatus = bridges.telegram.enabled ? pc.green('enabled') : pc.red('disabled')
		const tokenInfo = bridges.telegram.botToken ? '(Token Configured)' : '(No Token)'
		console.log(`  ${pc.bold(pc.cyan('telegram'))}  [${telegramStatus}]  ${pc.dim(tokenInfo)}`)
		if (bridges.telegram.allowedChats?.length) {
			console.log(`     ${pc.dim('↳')} Allowed chats: ${bridges.telegram.allowedChats.join(', ')}`)
		}
	}

	console.log('')
	p.outro(pc.dim('Run `tamias channels edit` to modify configurations.'))
}

// ─── Add/Edit Logic ────────────────────────────────────────────────────────

const AVAILABLE_CHANNELS = ['discord', 'telegram']

export const runChannelsAddCommand = async () => {
	await editChannelFlow(true)
}

export const runChannelsEditCommand = async () => {
	await editChannelFlow(false)
}

async function editChannelFlow(isAdding: boolean) {
	p.intro(pc.bgMagenta(pc.white(` Tamias — ${isAdding ? 'Configure Channel' : 'Edit Channel'} `)))
	const config = getBridgesConfig()

	const platform = await p.select({
		message: 'Which platform do you want to configure?',
		options: [
			{ value: 'discord', label: 'Discord' },
			{ value: 'telegram', label: 'Telegram' },
			{ value: 'terminal', label: 'Terminal (Local)' },
		],
	})

	if (p.isCancel(platform)) { p.cancel('Cancelled.'); process.exit(0) }

	if (platform === 'terminal') {
		const enabled = await p.confirm({
			message: 'Enable Terminal Channel?',
			initialValue: config.terminal?.enabled ?? true,
		})
		if (p.isCancel(enabled)) { p.cancel('Cancelled.'); process.exit(0) }

		config.terminal = { ...config.terminal, enabled: enabled as boolean }
		setBridgesConfig(config)
		p.outro(pc.green(`✅ Terminal channel set to ${enabled ? 'enabled' : 'disabled'}.`))
		return
	}

	// Discord / Telegram flow
	const platformName = platform as 'discord' | 'telegram'
	const currentCfg = config[platformName] || { enabled: false }

	const enableOpts = await p.confirm({
		message: `Enable ${platformName} channel?`,
		initialValue: currentCfg.enabled,
	})
	if (p.isCancel(enableOpts)) { p.cancel('Cancelled.'); process.exit(0) }

	let botToken = currentCfg.botToken
	if (enableOpts as boolean) {
		if (platformName === 'discord') {
			p.note(
				`1. Go to https://discord.com/developers/applications\n2. Create or select your application\n3. Go to the 'Bot' tab\n4. Click 'Reset Token' to copy your bot token`,
				'How to get Discord Token'
			)
		} else if (platformName === 'telegram') {
			p.note(
				`1. Message @BotFather on Telegram\n2. Create a new bot with /newbot\n3. Copy the API token provided`,
				'How to get Telegram Token'
			)
		}

		const tokenInput = await p.text({
			message: 'Bot Token:',
			placeholder: '...',
			initialValue: currentCfg.botToken ?? '',
			validate: (v) => { if (!v && !currentCfg.botToken) return 'Token is required when enabling.' },
		})
		if (p.isCancel(tokenInput)) { p.cancel('Cancelled.'); process.exit(0) }
		botToken = (tokenInput as string).trim()
	}

	let restrictArr = platform === 'discord' ? config.discord?.allowedChannels : config.telegram?.allowedChats

	const allowlistRaw = await p.text({
		message: `Comma-separated allowed ${platform === 'discord' ? 'channel' : 'chat'} IDs (leave empty to allow all):`,
		placeholder: '12345678,98765432',
		initialValue: restrictArr?.join(',') ?? '',
	})
	if (p.isCancel(allowlistRaw)) { p.cancel('Cancelled.'); process.exit(0) }

	const allowlist = (allowlistRaw as string).split(',').map(s => s.trim()).filter(Boolean)

	if (platformName === 'discord') {
		config.discord = {
			enabled: enableOpts as boolean,
			botToken: botToken,
			allowedChannels: allowlist.length ? allowlist : undefined,
		}
	} else if (platformName === 'telegram') {
		config.telegram = {
			enabled: enableOpts as boolean,
			botToken: botToken,
			allowedChats: allowlist.length ? allowlist : undefined,
		}
	}

	setBridgesConfig(config)
	p.outro(pc.green(`✅ Channel '${platformName}' updated.`))
}

// ─── Remove/Disable ────────────────────────────────────────────────────────

export const runChannelsRemoveCommand = async () => {
	p.intro(pc.bgMagenta(pc.white(' Tamias — Remove Channel ')))
	const config = getBridgesConfig()

	const platform = await p.select({
		message: 'Which channel do you want to disable/remove configuration for?',
		options: AVAILABLE_CHANNELS.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
	})

	if (p.isCancel(platform)) { p.cancel('Cancelled.'); process.exit(0) }

	const confirmed = await p.confirm({ message: `Really clear configuration for ${pc.red(platform as string)}?`, initialValue: false })
	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }

	if (platform === 'discord') {
		config.discord = undefined
	} else if (platform === 'telegram') {
		config.telegram = undefined
	}

	setBridgesConfig(config)
	p.outro(pc.green(`✅ Channel '${platform}' configuration removed.`))
}

// ─── Interactive Menu ───────────────────────────────────────────────────────

export const runChannelsCommand = async () => {
	p.intro(pc.bgMagenta(pc.white(' Tamias — Channel Manager ')))

	const action = await p.select({
		message: 'What would you like to do?',
		options: [
			{ value: 'list', label: '📋 List all channels' },
			{ value: 'add', label: '➕ Configure a new channel' },
			{ value: 'edit', label: '✏️  Edit a channel config' },
			{ value: 'remove', label: '🗑️  Reset / clear a channel' },
		],
	})
	if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0) }

	switch (action) {
		case 'list': return runChannelsListCommand()
		case 'add': return runChannelsAddCommand()
		case 'edit': return runChannelsEditCommand()
		case 'remove': return runChannelsRemoveCommand()
	}
}
