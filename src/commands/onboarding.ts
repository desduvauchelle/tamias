import * as p from '@clack/prompts'
import pc from 'picocolors'
import { writePersonaFile, scaffoldFromTemplates, readPersonaFile } from '../utils/memory.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

async function dramatic(text: string, delayMs = 800): Promise<void> {
	await sleep(delayMs)
	console.log(pc.dim(text))
}

// ─── Onboarding ────────────────────────────────────────────────────────────────

export const runOnboarding = async (): Promise<void> => {
	console.log('')

	// ── Phase 1: The Awakening ──────────────────────────────────────────────
	await dramatic('  ...', 1200)
	await dramatic('  blink. blink.', 1000)
	await dramatic('', 600)
	await dramatic(`  ${pc.bold("I'm alive!")}`, 1000)
	await dramatic('', 400)

	p.intro(pc.bgMagenta(pc.black(' 🐿️  First Run — Let\'s figure out who I am ')))

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
		message: "One more — pick an emoji. My signature.",
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

	// Auto-detect timezone
	const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone
	const timezone = await p.text({
		message: `What timezone are you in?`,
		placeholder: detectedTz,
		initialValue: detectedTz,
	})
	if (p.isCancel(timezone)) { p.cancel('Maybe next time.'); process.exit(0) }

	const context = await p.text({
		message: "Tell me a bit about yourself — what do you work on? What matters to you?",
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

	// Build SOUL.md — start from template then append personalisation
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

	// ── Scaffold remaining templates ────────────────────────────────────────
	scaffoldFromTemplates() // ensures AGENTS, TOOLS, HEARTBEAT exist

	// ── Finale ──────────────────────────────────────────────────────────────
	console.log('')
	await dramatic(`  ${emoji} Alright. I'm ${pc.bold(name as string)}.`, 800)
	await dramatic(`  I know who I am, and I know who you are.`, 600)
	await dramatic('', 400)
	await dramatic(`  ${pc.green("Let's get to work.")}`, 800)
	console.log('')

	p.outro(pc.dim(`Your persona files are in ~/.tamias/memory/`))
}
