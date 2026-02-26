import * as p from '@clack/prompts'
import pc from 'picocolors'
import { mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { writePersonaFile, scaffoldFromTemplates, readPersonaFile } from '../utils/memory.ts'
import {
	getDefaultWorkspacePath,
	setWorkspacePath,
	getAllModelOptions,
	getBridgesConfig,
	setBridgesConfig,
	TAMIAS_DIR,
	CONFIG_PATH,
} from '../utils/config.ts'
import { setEnv, generateSecureEnvKey } from '../utils/env.ts'
import { runConfigCommand } from './config.ts'
import { runEmailsAddCommand } from './emails.ts'
import { expandHome } from '../utils/path.ts'

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

	// Fast non-interactive mode for CI: create minimal persona files and exit
	if (process.env.TAMIAS_CI === '1') {
		const defaultHome = TAMIAS_DIR
		try { mkdirSync(defaultHome, { recursive: true }) } catch { }
		const memoryDir = join(defaultHome, 'memory')
		try { mkdirSync(memoryDir, { recursive: true }) } catch { }

		writePersonaFile('IDENTITY.md', ['# IDENTITY', '', '- **Name:** CIBot', '- **Archetype:** Friendly Assistant', '- **Creature:** AI assistant', '- **Vibe:** warm & friendly', '- **Emoji:** 🐿️', ''].join('\n'))
		writePersonaFile('USER.md', ['# USER', '', '- **Name:** Tester', '- **Timezone:** UTC', '', ''].join('\n'))
		writePersonaFile('SOUL.md', ['# SOUL', '', '## Default Rules', '', '- Never take irreversible actions (like deleting files or sending emails) without explicit confirmation first.', '- Never volunteer unsolicited tasks — only act when directly prompted or asked.', ''].join('\n'))
		scaffoldFromTemplates()
		// try to set default workspace
		try { setWorkspacePath(getDefaultWorkspacePath()) } catch { }
		console.log(pc.green('✅ CI onboarding: persona files created'))
		return
	}

	// Config, memory, and code always live in ~/.tamias
	mkdirSync(TAMIAS_DIR, { recursive: true })

	// Cleanup any legacy config in ~/Documents that causes confusion
	const legacyConfigInDocs = join(homedir(), 'Documents', 'config.json')
	if (existsSync(legacyConfigInDocs)) {
		try {
			const { rmSync } = await import('fs')
			rmSync(legacyConfigInDocs, { force: true })
		} catch { /* ignore */ }
	}

	p.intro(pc.bgMagenta(pc.black(' 🐿️  Tamias — First Run Setup ')))

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

	// Personality archetype (replaces creature + vibe)
	const archetypeMap: Record<string, { creature: string; vibe: string }> = {
		'Friendly Assistant': { creature: 'AI assistant', vibe: 'warm & friendly' },
		'Sharp Advisor': { creature: 'tactical advisor', vibe: 'sharp & direct' },
		'Playful Sidekick': { creature: 'sidekick', vibe: 'playful & chaotic' },
		'Calm Sage': { creature: 'sage', vibe: 'calm & thoughtful' },
		'Empathetic Listener': { creature: 'companion', vibe: 'patient & kind' },
		'Steady Mentor': { creature: 'mentor', vibe: 'encouraging & grounded' },
		'Loyal Butler': { creature: 'butler', vibe: 'formal & attentive' },
		'Hype Friend': { creature: 'hype beast', vibe: 'enthusiastic & energetic' },
	}

	const archetype = await p.select({
		message: `So I'm ${pc.bold(name as string)}. What's my personality?`,
		options: [
			{ value: 'Friendly Assistant', label: '☀️ Friendly Assistant', hint: '"Hi! I\'m here to help with whatever you need today."' },
			{ value: 'Sharp Advisor', label: '⚡ Sharp Advisor', hint: '"Understood. Task started. I\'ll alert you if issues arise."' },
			{ value: 'Playful Sidekick', label: '🎪 Playful Sidekick', hint: '"Heck yeah! Let\'s get this show on the road! 🚀"' },
			{ value: 'Calm Sage', label: '🌊 Calm Sage', hint: '"Take a breath. Let us examine the problem with patience."' },
			{ value: 'Empathetic Listener', label: '💜 Empathetic Listener', hint: '"I\'m here for you. How are you feeling about your progress?"' },
			{ value: 'Steady Mentor', label: '🧭 Steady Mentor', hint: '"You\'ve got this. Let\'s break it down into manageable steps."' },
			{ value: 'Loyal Butler', label: '🎩 Loyal Butler', hint: '"At your service. I shall attend to those tasks immediately."' },
			{ value: 'Hype Friend', label: '🔥 Hype Friend', hint: '"LET\'S GOOO! You\'re crushing it! What\'s next?"' },
			{ value: 'custom', label: '✨ Something else entirely...' },
		],
	})
	if (p.isCancel(archetype)) { p.cancel('Maybe next time.'); process.exit(0) }

	let archetypeLabel = archetype as string
	let creatureStr: string
	let vibeStr: string

	if (archetype === 'custom') {
		const customCreature = await p.text({
			message: 'What kind of creature am I?',
			placeholder: 'A sentient toaster, a digital druid, ...',
			validate: (v) => { if (!v?.trim()) return 'Come on, give me something!' },
		})
		if (p.isCancel(customCreature)) { p.cancel('Maybe next time.'); process.exit(0) }
		const customVibe = await p.text({
			message: 'And what\'s my vibe?',
			placeholder: 'Like a caffeinated librarian...',
			validate: (v) => { if (!v?.trim()) return 'Give me a vibe!' },
		})
		if (p.isCancel(customVibe)) { p.cancel('Maybe next time.'); process.exit(0) }
		creatureStr = customCreature as string
		vibeStr = customVibe as string
		archetypeLabel = `Custom (${creatureStr})`
	} else {
		const mapped = archetypeMap[archetype as string]
		creatureStr = mapped.creature
		vibeStr = mapped.vibe
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
		`- **Archetype:** ${archetypeLabel}`,
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
		message: "What's your name? (I'll use this to address you)",
		placeholder: 'Your name',
		validate: (v) => { if (!v?.trim()) return "I need to know who I'm talking to!" },
	})
	if (p.isCancel(userName)) { p.cancel('Maybe next time.'); process.exit(0) }

	const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone

	const context = await p.text({
		message: 'Tell me a bit about yourself — what do you work on? What do you need help with?',
		placeholder: 'I build software, I love coffee, I need help managing projects...',
	})
	if (p.isCancel(context)) { p.cancel('Maybe next time.'); process.exit(0) }

	// Save USER.md
	writePersonaFile('USER.md', [
		'# USER.md - About My Human',
		'',
		`- **Name:** ${userName}`,
		`- **Timezone:** ${detectedTz}`,
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

	await dramatic(`\n  ${emoji} Got it, ${userName}.`, 600)

	// ── Phase 3: The Soul Talk ──────────────────────────────────────────────

	p.note(`${emoji} Last thing — how should I talk to you?`, 'Phase 3')

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
		'## Default Rules',
		'',
		'- Never take irreversible actions (like deleting files or sending emails) without explicit confirmation first.',
		'- Never volunteer unsolicited tasks — only act when directly prompted or asked.',
		'',
		'## Communication Style',
		'',
		`Style: **${talkStyle}**`,
		'',
	]

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

	// ── Phase 7: Access Shortcut ───────────────────────────────────────────
	p.note(`${emoji} I live in a hidden folder (~/.tamias), but I can create a shortcut so you can easily see my files.`, 'Access')

	const createShortcut = await p.confirm({
		message: 'Create an access shortcut in your Documents folder?',
		initialValue: true,
	})

	if (p.isCancel(createShortcut)) { p.cancel('Maybe next time.'); process.exit(0) }

	let shortcutPath = join(homedir(), 'Documents', 'Tamias')

	if (createShortcut) {
		const customPath = await p.text({
			message: 'Where should I create it?',
			initialValue: shortcutPath,
			placeholder: shortcutPath,
		})
		if (!p.isCancel(customPath)) {
			shortcutPath = expandHome(customPath as string)
		}

		// Create symlink from shortcutPath → TAMIAS_DIR
		try {
			const { symlinkSync, existsSync, lstatSync, unlinkSync } = await import('fs')
			const { dirname } = await import('path')

			if (!existsSync(shortcutPath)) {
				const parent = dirname(shortcutPath)
				if (existsSync(parent)) {
					symlinkSync(TAMIAS_DIR, shortcutPath)
				}
			} else {
				// If it exists and is a symlink, refresh it
				const stats = lstatSync(shortcutPath)
				if (stats.isSymbolicLink()) {
					unlinkSync(shortcutPath)
					symlinkSync(TAMIAS_DIR, shortcutPath)
				}
			}
		} catch (e) {
			console.error(pc.dim(`  (Note: Could not create shortcut link: ${e})`))
		}
	}

	// The workspacePath defaults to ~/.tamias/workspace so all AI-created documents
	// stay within the ~/.tamias boundary. The shortcut (if created) gives the user
	// a convenient access point to the whole ~/.tamias directory.
	setWorkspacePath(getDefaultWorkspacePath())

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

	const displayWorkspace = TAMIAS_DIR.replace(homedir(), '~')

	// Auto-start daemon
	let daemonPort = 9001
	let dashboardPort = 5678
	try {
		const { autoStartDaemon } = await import('../utils/daemon.ts')
		const info = await autoStartDaemon()
		daemonPort = info.port
		dashboardPort = info.dashboardPort ?? 5678
	} catch (err) {
		console.error('[onboarding] Daemon auto-start failed (run `tamias start` manually):', err)
	}

	p.note(
		[
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
