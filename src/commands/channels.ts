import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	getBridgesConfig,
	setBridgesConfig,
	getBotTokenForInstance,
} from '../utils/config.ts'
import { setEnv, removeEnv, generateSecureEnvKey, getEnv } from '../utils/env.ts'

// ─── Health checks ─────────────────────────────────────────────────────────────

async function testDiscordToken(token: string): Promise<void> {
	const spinner = p.spinner()
	spinner.start('Testing Discord bot token...')
	try {
		// Fetch bot info from Discord REST API
		const res = await fetch('https://discord.com/api/v10/users/@me', {
			headers: { Authorization: `Bot ${token}` },
			signal: AbortSignal.timeout(5000),
		})

		if (res.status === 401) {
			spinner.stop(pc.red('❌ Invalid token'))
			p.note(
				`The token was rejected (401 Unauthorized).\n` +
				`→ Go to https://discord.com/developers/applications\n` +
				`→ Open your app → Bot tab → Reset Token`,
				'Fix'
			)
			return
		}

		if (!res.ok) {
			spinner.stop(pc.yellow(`⚠️  Discord API responded with ${res.status}`))
			return
		}

		const bot = await res.json() as { username?: string; id?: string }
		spinner.stop(pc.green(`✅ Token valid — bot is ${pc.bold(bot.username ?? 'unknown')} (${bot.id})`))

		// Now check gateway intents
		p.note(
			`Your bot is connected!\n\n` +
			`${pc.bold('⚠️  REQUIRED: Enable privileged intents')}\n` +
			`Discord bots MUST have these enabled to read messages:\n\n` +
			`1. Go to https://discord.com/developers/applications\n` +
			`2. Select your app → Bot tab\n` +
			`3. Under "Privileged Gateway Intents" enable:\n` +
			`   ${pc.cyan('• MESSAGE CONTENT INTENT')}  ← most common cause of no response\n` +
			`   ${pc.dim('• SERVER MEMBERS INTENT')} (optional)\n` +
			`4. Save Changes\n\n` +
			`Then run: ${pc.bold('tamias stop && tamias start')}`,
			'Next Steps'
		)
	} catch (err: any) {
		spinner.stop(pc.red(`❌ Network error: ${err?.message ?? err}`))
	}
}

async function testTelegramToken(token: string): Promise<void> {
	const spinner = p.spinner()
	spinner.start('Testing Telegram bot token...')
	try {
		const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
			signal: AbortSignal.timeout(5000),
		})
		const data = await res.json() as { ok: boolean; result?: { username?: string; first_name?: string }; description?: string }

		if (!data.ok) {
			spinner.stop(pc.red(`❌ Invalid token: ${data.description}`))
			p.note(
				`→ Message @BotFather on Telegram\n` +
				`→ Use /mybots to view your bots\n` +
				`→ Use /token to get a fresh token`,
				'Fix'
			)
			return
		}

		const name = data.result?.first_name ?? data.result?.username ?? 'unknown'
		spinner.stop(pc.green(`✅ Token valid — bot is ${pc.bold(name)} (@${data.result?.username})`))
		p.note(
			`Your Telegram bot is configured!\n\n` +
			`To start chatting, open Telegram and find your bot: ${pc.cyan('@' + data.result?.username)}\n` +
			`Then restart the daemon: ${pc.bold('tamias stop && tamias start')}`,
			'Next Steps'
		)
	} catch (err: any) {
		spinner.stop(pc.red(`❌ Network error: ${err?.message ?? err}`))
	}
}


// ─── List ─────────────────────────────────────────────────────────────────────

export const runChannelsListCommand = async () => {
	p.intro(pc.bgMagenta(pc.white(' Tamias — Channels ')))
	const bridges = getBridgesConfig()

	console.log(pc.bold('\n  Configured Channels:\n'))

	// Terminal
	const terminalStatus = bridges.terminal?.enabled !== false ? pc.green('enabled') : pc.red('disabled')
	console.log(`  ${pc.bold(pc.cyan('terminal'))}  [${terminalStatus}]  ${pc.dim('Local CLI interface')}`)

	// Discord instances
	const discords = bridges.discords ?? {}
	if (Object.keys(discords).length === 0) {
		console.log(`  ${pc.bold(pc.cyan('discord'))}   ${pc.dim('(none configured)')}`)
	} else {
		for (const [key, cfg] of Object.entries(discords)) {
			const status = cfg.enabled ? pc.green('enabled') : pc.red('disabled')
			const tokenInfo = getBotTokenForInstance('discords', key) ? '(Token Configured)' : '(No Token)'
			console.log(`  ${pc.bold(pc.cyan('discord'))}:${pc.bold(key)}  [${status}]  ${pc.dim(tokenInfo)}`)
			if (cfg.allowedChannels?.length) {
				console.log(`     ${pc.dim('↳')} Allowed channels: ${cfg.allowedChannels.join(', ')}`)
			}
		}
	}

	// Telegram instances
	const telegrams = bridges.telegrams ?? {}
	if (Object.keys(telegrams).length === 0) {
		console.log(`  ${pc.bold(pc.cyan('telegram'))}  ${pc.dim('(none configured)')}`)
	} else {
		for (const [key, cfg] of Object.entries(telegrams)) {
			const status = cfg.enabled ? pc.green('enabled') : pc.red('disabled')
			const tokenInfo = getBotTokenForInstance('telegrams', key) ? '(Token Configured)' : '(No Token)'
			console.log(`  ${pc.bold(pc.cyan('telegram'))}:${pc.bold(key)}  [${status}]  ${pc.dim(tokenInfo)}`)
			if (cfg.allowedChats?.length) {
				console.log(`     ${pc.dim('↳')} Allowed chats: ${cfg.allowedChats.join(', ')}`)
			}
		}
	}

	console.log('')
	p.outro(pc.dim('Run `tamias channels edit` to modify configurations.'))
}

// ─── Add/Edit Logic ────────────────────────────────────────────────────────

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

	const platformName = platform as 'discord' | 'telegram'
	const instancesKey = platformName === 'discord' ? 'discords' : 'telegrams'
	const existingInstances = config[instancesKey] ?? {}
	const existingKeys = Object.keys(existingInstances)

	// Pick or create an instance key
	let instanceKey: string

	if (isAdding || existingKeys.length === 0) {
		// Adding new instance — ask for a name
		const keyInput = await p.text({
			message: `Name for this ${platformName} bot (e.g. "default", "work", "community"):`,
			placeholder: existingKeys.length === 0 ? 'default' : 'myserver',
			validate: (v) => {
				if (!v?.trim()) return 'Name is required.'
				if (!/^[a-z0-9_-]+$/i.test(v.trim())) return 'Only letters, numbers, hyphens and underscores allowed.'
				if (isAdding && existingKeys.includes(v.trim())) return `Instance "${v.trim()}" already exists.`
			},
		})
		if (p.isCancel(keyInput)) { p.cancel('Cancelled.'); process.exit(0) }
		instanceKey = (keyInput as string).trim()
	} else {
		// Editing — let user pick from existing instances or add a new one
		const selection = await p.select({
			message: `Which ${platformName} instance do you want to edit?`,
			options: [
				...existingKeys.map(k => ({ value: k, label: k })),
				{ value: '__new__', label: '➕ Add a new instance' },
			],
		})
		if (p.isCancel(selection)) { p.cancel('Cancelled.'); process.exit(0) }

		if (selection === '__new__') {
			const keyInput = await p.text({
				message: `Name for this new ${platformName} bot:`,
				placeholder: 'myserver',
				validate: (v) => {
					if (!v?.trim()) return 'Name is required.'
					if (!/^[a-z0-9_-]+$/i.test(v.trim())) return 'Only letters, numbers, hyphens and underscores allowed.'
					if (existingKeys.includes(v.trim())) return `Instance "${v.trim()}" already exists.`
				},
			})
			if (p.isCancel(keyInput)) { p.cancel('Cancelled.'); process.exit(0) }
			instanceKey = (keyInput as string).trim()
		} else {
			instanceKey = selection as string
		}
	}

	const currentCfg = existingInstances[instanceKey] ?? { enabled: false }
	const currentToken = currentCfg.envKeyName ? getEnv(currentCfg.envKeyName) : undefined

	const enableOpts = await p.confirm({
		message: `Enable ${platformName}:${instanceKey}?`,
		initialValue: currentCfg.enabled,
	})
	if (p.isCancel(enableOpts)) { p.cancel('Cancelled.'); process.exit(0) }

	let botToken = currentToken
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
			placeholder: currentToken ? '(press Enter to keep existing)' : '...',
			initialValue: '',
			validate: (v) => { if (!v && !currentToken) return 'Token is required when enabling.' },
		})
		if (p.isCancel(tokenInput)) { p.cancel('Cancelled.'); process.exit(0) }
		const raw = (tokenInput as string).trim()
		if (raw) botToken = raw
	}

	const instanceCfg = existingInstances[instanceKey]
	const restrictArr = platformName === 'discord'
		? (instanceCfg as { allowedChannels?: string[] } | undefined)?.allowedChannels
		: (instanceCfg as { allowedChats?: string[] } | undefined)?.allowedChats

	const allowlistRaw = await p.text({
		message: `Comma-separated allowed ${platformName === 'discord' ? 'channel' : 'chat'} IDs (leave empty to allow all):`,
		placeholder: '12345678,98765432',
		initialValue: restrictArr?.join(',') ?? '',
	})
	if (p.isCancel(allowlistRaw)) { p.cancel('Cancelled.'); process.exit(0) }

	const allowlist = (allowlistRaw as string).split(',').map(s => s.trim()).filter(Boolean)

	let envKeyName = currentCfg.envKeyName
	if (botToken && botToken !== currentToken) {
		if (!envKeyName) {
			envKeyName = generateSecureEnvKey(`${platformName.toUpperCase()}_${instanceKey.toUpperCase()}`)
		}
		setEnv(envKeyName, botToken)
	}

	if (!config.discords) config.discords = {}
	if (!config.telegrams) config.telegrams = {}

	if (platformName === 'discord') {
		config.discords[instanceKey] = {
			enabled: enableOpts as boolean,
			envKeyName,
			allowedChannels: allowlist.length ? allowlist : undefined,
		}
	} else if (platformName === 'telegram') {
		config.telegrams[instanceKey] = {
			enabled: enableOpts as boolean,
			envKeyName,
			allowedChats: allowlist.length ? allowlist : undefined,
		}
	}

	setBridgesConfig(config)
	p.outro(pc.green(`✅ Channel '${platformName}:${instanceKey}' updated.`))

	// Run health test if token was provided and channel is enabled
	if (enableOpts && botToken) {
		if (platformName === 'discord') await testDiscordToken(botToken)
		else if (platformName === 'telegram') await testTelegramToken(botToken)
	}
}

// ─── Remove/Disable ────────────────────────────────────────────────────────

export const runChannelsRemoveCommand = async (platformArg?: string) => {
	p.intro(pc.bgMagenta(pc.white(' Tamias — Remove Channel ')))
	const config = getBridgesConfig()

	// Build a flat list of all removable instances
	const options: { value: string; label: string }[] = []
	for (const key of Object.keys(config.discords ?? {})) {
		options.push({ value: `discord:${key}`, label: `Discord — ${key}` })
	}
	for (const key of Object.keys(config.telegrams ?? {})) {
		options.push({ value: `telegram:${key}`, label: `Telegram — ${key}` })
	}

	if (options.length === 0) {
		p.outro(pc.yellow('No Discord or Telegram channels are configured.'))
		return
	}

	let target: string
	if (platformArg) {
		const exact = options.find(o => o.value === platformArg)
		const prefix = options.find(o => o.value.startsWith(platformArg.toLowerCase() + ':'))
		target = (exact ?? prefix)?.value ?? ''
	} else {
		target = ''
	}

	if (!target) {
		const selection = await p.select({
			message: 'Which instance do you want to remove?',
			options,
		})
		if (p.isCancel(selection)) { p.cancel('Cancelled.'); process.exit(0) }
		target = selection as string
	}

	const [plat, instanceKey] = target.split(':', 2)

	const confirmed = await p.confirm({
		message: `Really clear configuration for ${pc.red(`${plat}:${instanceKey}`)}?`,
		initialValue: false,
	})
	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }

	if (plat === 'discord' && config.discords?.[instanceKey]) {
		const envKey = config.discords[instanceKey].envKeyName
		if (envKey) removeEnv(envKey)
		delete config.discords[instanceKey]
	} else if (plat === 'telegram' && config.telegrams?.[instanceKey]) {
		const envKey = config.telegrams[instanceKey].envKeyName
		if (envKey) removeEnv(envKey)
		delete config.telegrams[instanceKey]
	}

	setBridgesConfig(config)
	p.outro(pc.green(`✅ Channel '${plat}:${instanceKey}' configuration removed.`))
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
