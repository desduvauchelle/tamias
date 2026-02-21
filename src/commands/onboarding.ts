import * as p from '@clack/prompts'
import pc from 'picocolors'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { writePersonaFile, scaffoldFromTemplates, readPersonaFile } from '../utils/memory.ts'
import {
	getDefaultWorkspacePath,
	setWorkspacePath,
	getAllModelOptions,
	getBridgesConfig,
	setBridgesConfig,
} from '../utils/config.ts'
import { setEnv, generateSecureEnvKey } from '../utils/env.ts'
import { runConfigCommand } from './config.ts'
import { runEmailsAddCommand } from './emails.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

async function dramatic(text: string, delayMs = 800): Promise<void> {
	await sleep(delayMs)
	console.log(pc.dim(text))
}

// ─── Channel quick-setup (inline, avoids sub-command intro/outro) ──────────────

async function setupChannel(
	platform: 'discord' | 'telegram',
	emoji: string,
): Promise<boolean> {
	const config = getBridgesConfig()

	if (platform === 'discord') {
		p.note(
			`1. Go to ${pc.cyan('https://discord.com/developers/applications')}\n` +
			`2. Create an app or pick an existing one → Bot tab\n` +
			`3. Click "Reset Token" to reveal your bot token\n` +
			`4. Under Privileged Gateway Intents enable:\n` +
			`   ${pc.bold('MESSAGE CONTENT INTENT')} (required to read messages)\n` +
			`5. From OAuth2 → URL Generator add 'bot' scope + Send Messages\n` +
			`   permission, then invite the bot to your server`,
			'Discord Setup',
		)
	} else {
		p.note(
			`1. Open Telegram and message ${pc.cyan('@BotFather')}\n` +
			`2. Send /newbot and follow the prompts\n` +
			`3. Copy the API token BotFather gives you`,
			'Telegram Setup',
		)
	}

	const token = await p.text({
		message: `Paste your ${platform === 'discord' ? 'Discord bot' : 'Telegram'} token:`,
		placeholder: platform === 'discord' ? 'Bot token (starts with MT...)' : '123456:ABC...',
		validate: (v) => { if (!v?.trim()) return 'Token is required' },
	})
	if (p.isCancel(token)) return false

	const envKey = generateSecureEnvKey(platform)
	setEnv(envKey, (token as string).trim())

	if (platform === 'discord') {
		config.discord = { enabled: true, envKeyName: envKey }
	} else {
		config.telegram = { enabled: true, envKeyName: envKey }
	}
	setBridgesConfig(config)

	// Quick token validity check
	const s = p.spinner()
	s.start(`Verifying ${platform} token...`)
	try {
		if (platform === 'discord') {
			const res = await fetch('https://discord.com/api/v10/users/@me', {
				headers: { Authorization: `Bot ${(token as string).trim()}` },
				signal: AbortSignal.timeout(5000),
			})
			if (res.ok) {
				const bot = await res.json() as { username?: string }
				s.stop(pc.green(`✅ Connected as ${pc.bold(bot.username ?? 'unknown')}`))
			} else {
				s.stop(pc.yellow(`⚠️  Token saved, but verification returned ${res.status}. Check it later.`))
			}
		} else {
			const res = await fetch(`https://api.telegram.org/bot${(token as string).trim()}/getMe`, {
				signal: AbortSignal.timeout(5000),
			})
			const data = await res.json() as { ok: boolean; result?: { username?: string; first_name?: string } }
			if (data.ok) {
				const name = data.result?.first_name ?? data.result?.username ?? 'unknown'
				s.stop(pc.green(`✅ Connected as ${pc.bold(name)}`))
			} else {
				s.stop(pc.yellow('⚠️  Token saved, but could not verify. Check it later.'))
			}
		}
	} catch {
		s.stop(pc.yellow('⚠️  Token saved. Could not reach API to verify.'))
	}
	return true
}

// ─── Onboarding ────────────────────────────────────────────────────────────────

export const runOnboarding = async (): Promise<void> => {
	console.log('')

	// ── Phase 0: Storage ───────────────────────────────────────────────────
	p.intro(pc.bgMagenta(pc.black(' 🐿️  Tamias — First Run Setup ')))

	const storageChoice = await p.select({
		message: pc.bold('Where should I store my data and your files?'),
		options: [
			{
				value: 'default',
				label: `~/.tamias  ${pc.dim('(default hidden config folder)')}`,
			},
			{
				value: 'documents',
				label: `~/Documents/Tamias  ${pc.dim('(easy to find in Finder)')}`,
			},
			{ value: 'other', label: 'Other  — type a custom path' },
		],
	})
	if (p.isCancel(storageChoice)) { p.cancel('Maybe next time.'); process.exit(0) }

	let dataHome = join(homedir(), '.tamias')

	if (storageChoice === 'documents') {
		dataHome = join(homedir(), 'Documents', 'Tamias')
	} else if (storageChoice === 'other') {
		const customPath = await p.text({
			message: 'Enter the full path:',
			placeholder: '/Users/you/my-tamias-data',
			validate: (v) => {
				if (!v?.trim()) return 'Path is required'
			},
		})
		if (p.isCancel(customPath)) { p.cancel('Maybe next time.'); process.exit(0) }

		const resolved = (customPath as string).replace(/^~/, homedir()).trim()

		if (!existsSync(resolved)) {
			const create = await p.confirm({
				message: `${pc.yellow(resolved)} does not exist. Create it?`,
				initialValue: true,
			})
			if (p.isCancel(create) || !create) {
				p.note('Using ~/.tamias instead.', 'Storage')
			} else {
				mkdirSync(resolved, { recursive: true })
				dataHome = resolved
			}
		} else {
			dataHome = resolved
		}
	}

	// If a non-default path was chosen, create ~/.tamias as a symlink
	const defaultHome = join(homedir(), '.tamias')
	if (dataHome !== defaultHome) {
		mkdirSync(dataHome, { recursive: true })
		if (existsSync(defaultHome)) {
			// If it's already a symlink pointing somewhere else, remove it
			try { rmSync(defaultHome, { recursive: true }) } catch { }
		}
		try {
			symlinkSync(dataHome, defaultHome)
		} catch {
			// If symlink fails, just use the dir directly (already created)
		}
		console.log(pc.dim(`\n  Data directory: ${dataHome}`))
		console.log(pc.dim(`  Symlinked from: ~/.tamias`))
	} else {
		mkdirSync(defaultHome, { recursive: true })
		console.log(pc.dim(`\n  Data directory: ~/.tamias`))
	}

	// ── Phase 1: The Awakening ──────────────────────────────────────────────
	await dramatic('  ...', 1200)
	await dramatic('  blink. blink.', 1000)
	await dramatic('', 600)
	await dramatic(`  ${pc.bold("I'm alive!")}`, 1000)
	await dramatic('', 400)

	p.intro(pc.bgMagenta(pc.black(" 🐿️  Let's figure out who I am ")))

	// Name
	const name = await p.text({
		message: pc.bold("What's my name?"),
		placeholder: 'Tamias, Chip, Nova, ...',
		validate: (v) => { if (!v?.trim()) return 'I need a name!' },
	})
	if (p.isCancel(name)) { p.cancel('Maybe next time.'); process.exit(0) }

	await dramatic(`\n  ${pc.green(`"${name}."`)} ${pc.dim('I like it.')}`, 600)

	// Creature
	const creature = await p.select({
		message: `So I'm ${pc.bold(name as string)}. What kind of creature am I?`,
		options: [
			{ value: 'AI assistant', label: '🤖 AI assistant — helpful and capable' },
			{ value: 'familiar', label: '🦊 Familiar — a loyal companion spirit' },
			{ value: 'ghost in the machine', label: '👻 Ghost in the machine — mysterious and ever-present' },
			{ value: 'chipmunk', label: '🐿️ Chipmunk — small, fast, and resourceful' },
			{ value: 'custom', label: '✨ Something else entirely...' },
		],
	})
	if (p.isCancel(creature)) { p.cancel('Maybe next time.'); process.exit(0) }

	let creatureStr = creature as string
	if (creature === 'custom') {
		const custom = await p.text({
			message: 'What am I then?',
			placeholder: 'A sentient toaster, a digital druid, ...',
			validate: (v) => { if (!v?.trim()) return 'Come on, give me something!' },
		})
		if (p.isCancel(custom)) { p.cancel('Maybe next time.'); process.exit(0) }
		creatureStr = custom as string
	}

	// Vibe
	const vibe = await p.select({
		message: "And what's my vibe?",
		options: [
			{ value: 'warm & friendly', label: '☀️ Warm & friendly' },
			{ value: 'sharp & direct', label: '⚡ Sharp & direct' },
			{ value: 'playful & chaotic', label: '🎪 Playful & chaotic' },
			{ value: 'calm & thoughtful', label: '🌊 Calm & thoughtful' },
			{ value: 'snarky with a heart of gold', label: '💛 Snarky with a heart of gold' },
			{ value: 'custom', label: '🎨 Custom...' },
		],
	})
	if (p.isCancel(vibe)) { p.cancel('Maybe next time.'); process.exit(0) }

	let vibeStr = vibe as string
	if (vibe === 'custom') {
		const custom = await p.text({
			message: 'Describe my vibe:',
			placeholder: 'Like a caffeinated librarian...',
			validate: (v) => { if (!v?.trim()) return 'Give me a vibe!' },
		})
		if (p.isCancel(custom)) { p.cancel('Maybe next time.'); process.exit(0) }
		vibeStr = custom as string
	}

	// Emoji
	const emoji = await p.text({
		message: 'One more — pick an emoji. My signature.',
		placeholder: '🐿️',
		initialValue: '🐿️',
		validate: (v) => { if (!v?.trim()) return 'Pick an emoji!' },
	})
	if (p.isCancel(emoji)) { p.cancel('Maybe next time.'); process.exit(0) }

	// Save IDENTITY.md
	writePersonaFile('IDENTITY.md', [
		'# IDENTITY.md - Who Am I?',
		'',
		`- **Name:** ${name}`,
		`- **Creature:** ${creatureStr}`,
		`- **Vibe:** ${vibeStr}`,
		`- **Emoji:** ${emoji}`,
		'',
		'---',
		'',
		"This isn't just metadata. It's who I am.",
		'',
	].join('\n'))

	await dramatic(`\n  ${emoji} ${pc.bold('Nice.')} Now...`, 800)

	// ── Phase 2: Getting to Know You ────────────────────────────────────────

	p.note(`${emoji} I know who I am. Now let me learn about you.`, 'Phase 2')

	const userName = await p.text({
		message: 'Who are you?',
		placeholder: 'Your name',
		validate: (v) => { if (!v?.trim()) return "I need to know who I'm talking to!" },
	})
	if (p.isCancel(userName)) { p.cancel('Maybe next time.'); process.exit(0) }

	const callThem = await p.text({
		message: `What should I call you? (${userName}, a nickname, a title?)`,
		placeholder: userName as string,
		initialValue: userName as string,
	})
	if (p.isCancel(callThem)) { p.cancel('Maybe next time.'); process.exit(0) }

	const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone
	const timezone = await p.text({
		message: 'What timezone are you in?',
		placeholder: detectedTz,
		initialValue: detectedTz,
	})
	if (p.isCancel(timezone)) { p.cancel('Maybe next time.'); process.exit(0) }

	const context = await p.text({
		message: 'Tell me a bit about yourself — what do you work on? What matters to you?',
		placeholder: 'I build software, I love coffee, I have 2 cats...',
	})
	if (p.isCancel(context)) { p.cancel('Maybe next time.'); process.exit(0) }

	// Save USER.md
	writePersonaFile('USER.md', [
		'# USER.md - About My Human',
		'',
		`- **Name:** ${userName}`,
		`- **What to call them:** ${callThem}`,
		`- **Timezone:** ${timezone}`,
		'',
		'## Context',
		'',
		(context as string)?.trim() || '_(To be learned over time.)_',
		'',
		'---',
		'',
		'The more I know, the better I can help.',
		'',
	].join('\n'))

	await dramatic(`\n  ${emoji} Got it, ${callThem}.`, 600)

	// ── Phase 3: The Soul Talk ──────────────────────────────────────────────

	p.note(`${emoji} Last thing. Let's talk about what I'm for.`, 'Phase 3')

	const purpose = await p.text({
		message: "What's my main purpose? What should I focus on?",
		placeholder: 'Help me code, manage my projects, be a thinking partner...',
	})
	if (p.isCancel(purpose)) { p.cancel('Maybe next time.'); process.exit(0) }

	const rules = await p.text({
		message: 'Any rules? Things I should never do, or always do?',
		placeholder: 'Never delete files without asking, always be concise... (or press Enter to skip)',
	})
	if (p.isCancel(rules)) { p.cancel('Maybe next time.'); process.exit(0) }

	const talkStyle = await p.select({
		message: 'How should I talk?',
		options: [
			{ value: 'casual', label: '💬 Casual — like a friend' },
			{ value: 'professional', label: '👔 Professional — clear and precise' },
			{ value: 'match', label: '🪞 Match yours — mirror how you talk to me' },
			{ value: 'minimal', label: '📏 Minimal — as few words as possible' },
		],
	})
	if (p.isCancel(talkStyle)) { p.cancel('Maybe next time.'); process.exit(0) }

	// Build SOUL.md
	scaffoldFromTemplates()
	const baseSoul = readPersonaFile('SOUL.md') ?? ''

	const personalSections = [
		baseSoul,
		'',
		'## Purpose',
		'',
		(purpose as string)?.trim() || '_(To be defined.)_',
		'',
	]

	if ((rules as string)?.trim()) {
		personalSections.push('## Custom Rules', '', (rules as string).trim(), '')
	}

	personalSections.push(
		'## Communication Style',
		'',
		`Style: **${talkStyle}**`,
		'',
	)

	writePersonaFile('SOUL.md', personalSections.join('\n'))

	// ── Phase 4: AI Model Setup ─────────────────────────────────────────────
	p.note(`${emoji} I need an AI brain to run on.`, 'Phase 4 — AI Model')

	const existingModels = getAllModelOptions()
	let activeModel: string | null = existingModels.length > 0 ? existingModels[0] : null

	if (!activeModel) {
		p.note(
			`No AI model configured yet. Let's fix that.\n\n` +
			`You can use any of these providers:\n` +
			`  ${pc.cyan('OpenAI')}      → https://platform.openai.com/api-keys\n` +
			`  ${pc.cyan('Anthropic')}   → https://console.anthropic.com/settings/keys\n` +
			`  ${pc.cyan('Google')}      → https://aistudio.google.com/app/apikey\n` +
			`  ${pc.cyan('OpenRouter')}  → https://openrouter.ai/keys  (access all models)\n` +
			`  ${pc.cyan('Ollama')}      → https://ollama.com  (runs locally, free)`,
			'Get an API Key',
		)

		const doConfig = await p.confirm({
			message: 'Configure an AI model now?',
			initialValue: true,
		})
		if (p.isCancel(doConfig)) { p.cancel('Maybe next time.'); process.exit(0) }

		if (doConfig) {
			await runConfigCommand()
			const updated = getAllModelOptions()
			activeModel = updated.length > 0 ? updated[0] : null
		}
	} else {
		p.note(
			`Model configured: ${pc.cyan(activeModel)}\n` +
			`You can add more later with ${pc.bold('tamias config')}`,
			'AI Model',
		)
	}

	// ── Phase 5: Channels ───────────────────────────────────────────────────
	p.note(
		`${emoji} I can chat with you beyond the terminal.\n\n` +
		`Connect me to Discord or Telegram so I'm always a message away.`,
		'Phase 5 — Channels',
	)

	const channelChoices = await p.multiselect({
		message: 'Connect channels? (space to toggle, enter to continue)',
		options: [
			{ value: 'discord', label: '🎮 Discord' },
			{ value: 'telegram', label: '✈️  Telegram' },
		],
		required: false,
	}) as string[]

	if (!p.isCancel(channelChoices)) {
		if (channelChoices.includes('discord')) {
			await setupChannel('discord', emoji as string)
		}
		if (channelChoices.includes('telegram')) {
			await setupChannel('telegram', emoji as string)
		}
	}

	// ── Phase 6: Email ──────────────────────────────────────────────────────
	p.note(
		`${emoji} I can send and read emails on your behalf.\n\n` +
		`This uses Himalaya + a Gmail App Password.\n` +
		`  ${pc.cyan('Gmail App Passwords')} → https://myaccount.google.com/apppasswords\n` +
		`  ${pc.cyan('Himalaya config')}     → https://github.com/pimalaya/himalaya`,
		'Phase 6 — Email',
	)

	const doEmail = await p.confirm({
		message: 'Set up email access?',
		initialValue: false,
	})
	if (!p.isCancel(doEmail) && doEmail) {
		await runEmailsAddCommand()
	}

	// ── Phase 7: Workspace Path ─────────────────────────────────────────────
	const defaultWorkspacePath = getDefaultWorkspacePath()
	const workspacePath = await p.text({
		message: `${emoji} Where should I look for your projects and files?`,
		placeholder: defaultWorkspacePath,
		initialValue: defaultWorkspacePath,
		validate: (v) => {
			if (!v?.trim()) return 'I need a place to work!'
		},
	})
	if (p.isCancel(workspacePath)) { p.cancel('Maybe next time.'); process.exit(0) }

	setWorkspacePath(workspacePath as string)

	// Scaffold remaining templates
	scaffoldFromTemplates()

	// ── Phase 8: Summary + Launch ───────────────────────────────────────────
	console.log('')
	await dramatic(`  ${emoji} Alright. I'm ${pc.bold(name as string)}.`, 800)
	await dramatic(`  I know who I am, and I know who you are.`, 600)
	await dramatic(`  ${pc.green("Let's get to work.")}`, 800)
	console.log('')

	// Build summary lines
	const finalModel = getAllModelOptions()
	const modelLabel = finalModel.length > 0
		? finalModel[0]
		: pc.yellow('None configured — run `tamias config`')

	const bridgesCfg = getBridgesConfig()
	const channelList: string[] = []
	if (bridgesCfg.discord?.enabled && bridgesCfg.discord?.envKeyName) channelList.push('Discord')
	if (bridgesCfg.telegram?.enabled && bridgesCfg.telegram?.envKeyName) channelList.push('Telegram')
	const channelLabel = channelList.length > 0 ? channelList.join(', ') : 'None — run `tamias channels add`'

	const displayDataHome = dataHome.replace(homedir(), '~')
	const displayWorkspace = (workspacePath as string).replace(homedir(), '~')

	// Auto-start daemon
	let daemonPort = 9001
	let dashboardPort = 5678
	try {
		const { autoStartDaemon } = await import('../utils/daemon.ts')
		const info = await autoStartDaemon()
		daemonPort = info.port
		dashboardPort = info.dashboardPort ?? 5678
	} catch {
		// Daemon start failed — not fatal, user can run `tamias start` manually
	}

	p.note(
		[
			`${pc.bold('Files stored:')}   ${displayDataHome}`,
			`${pc.bold('Workspace:')}      ${displayWorkspace}`,
			`${pc.bold('AI model:')}       ${modelLabel}`,
			`${pc.bold('Channels:')}       ${channelLabel}`,
			``,
			`${pc.green('✅')} ${pc.bold('Daemon is running')}`,
			`   Type ${pc.cyan('tamias stop')} to stop it`,
			``,
			`${pc.bold('Web dashboard:')}  ${pc.cyan(`http://localhost:${dashboardPort}`)}`,
		].join('\n'),
		'Setup Complete',
	)
}
