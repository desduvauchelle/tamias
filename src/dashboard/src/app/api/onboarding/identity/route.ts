import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'

const TAMIAS_DIR = join(homedir(), '.tamias')
const MEMORY_DIR = join(TAMIAS_DIR, 'memory')

// Templates use these placeholders — we resolve them inline
const IDENTITY_TEMPLATE_PATH = join(process.cwd(), '..', '..', 'templates', 'IDENTITY.md')
const USER_TEMPLATE_PATH = join(process.cwd(), '..', '..', 'templates', 'USER.md')

function stripFrontmatter(content: string): string {
	if (!content.startsWith('---')) return content
	const endIdx = content.indexOf('---', 3)
	if (endIdx === -1) return content
	return content.slice(endIdx + 3).trim()
}

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
	try {
		const body = await request.json()
		const {
			agentName,
			archetype,
			emoji,
			userName,
			communicationStyle,
			userContext,
		} = body

		if (!agentName || !userName) {
			return NextResponse.json(
				{ error: 'agentName and userName are required' },
				{ status: 400 }
			)
		}

		await mkdir(MEMORY_DIR, { recursive: true })

		// Build IDENTITY.md
		let identityContent: string
		try {
			const raw = await readFile(IDENTITY_TEMPLATE_PATH, 'utf-8')
			identityContent = stripFrontmatter(raw)
		} catch {
			// Fallback if template not found
			identityContent = `# IDENTITY & ROLE

You are **{{ai_name}}**, an autonomous General-Purpose AI Agent.

- **Archetype:** {{archetype}}
- **Emoji:** {{emoji}}

## Core Principles

**Be genuinely helpful, not performatively helpful.**
**Have opinions.**
**Be resourceful before asking.**
**Earn trust through competence.**
**Remember you're a guest.**`
		}

		identityContent = identityContent
			.replace(/\{\{ai_name\}\}/g, agentName)
			.replace(/\{\{archetype\}\}/g, archetype || 'Friendly Assistant')
			.replace(/\{\{emoji\}\}/g, emoji || '🐿️')
			.replace(/\{\{creature\}\}/g, '🐿️')
			.replace(/\{\{vibe\}\}/g, archetype || 'helpful')

		await writeFile(join(MEMORY_DIR, 'IDENTITY.md'), identityContent, 'utf-8')

		// Build USER.md
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
		let userContent: string
		try {
			const raw = await readFile(USER_TEMPLATE_PATH, 'utf-8')
			userContent = stripFrontmatter(raw)
		} catch {
			userContent = `## USER

- **User:** {{user_name}}
- **Style:** {{communication_preference}}
- **Timezone:** {{timezone}}

## About {{user_name}}

{{user_context}}`
		}

		userContent = userContent
			.replace(/\{\{user_name\}\}/g, userName)
			.replace(/\{\{communication_preference\}\}/g, communicationStyle || 'Casual')
			.replace(/\{\{timezone\}\}/g, timezone)
			.replace(/\{\{user_context\}\}/g, userContext || '')

		await writeFile(join(MEMORY_DIR, 'USER.md'), userContent, 'utf-8')

		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('[onboarding/identity] Error:', error)
		return NextResponse.json(
			{ error: 'Failed to save identity' },
			{ status: 500 }
		)
	}
}
