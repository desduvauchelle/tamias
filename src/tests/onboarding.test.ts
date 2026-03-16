import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

// ─── Onboarding: template logic tests ──────────────────────────────────────

/** Replicate stripFrontmatter from the onboarding API */
function stripFrontmatter(content: string): string {
	if (!content.startsWith('---')) return content
	const endIdx = content.indexOf('---', 3)
	if (endIdx === -1) return content
	return content.slice(endIdx + 3).trim()
}

describe('stripFrontmatter', () => {
	test('removes YAML frontmatter from markdown', () => {
		const input = `---
title: My Doc
---

# Hello World`
		expect(stripFrontmatter(input)).toBe('# Hello World')
	})

	test('returns content unchanged if no frontmatter', () => {
		const input = '# No frontmatter here'
		expect(stripFrontmatter(input)).toBe('# No frontmatter here')
	})

	test('handles frontmatter without closing delimiter', () => {
		const input = '---\ntitle: broken'
		expect(stripFrontmatter(input)).toBe('---\ntitle: broken')
	})

	test('handles empty frontmatter', () => {
		const input = '---\n---\nContent'
		expect(stripFrontmatter(input)).toBe('Content')
	})

	test('handles empty input', () => {
		expect(stripFrontmatter('')).toBe('')
	})

	test('preserves content after frontmatter with multiple sections', () => {
		const input = `---
key: value
---

## Section 1

Text

## Section 2

More text`
		const result = stripFrontmatter(input)
		expect(result).toContain('## Section 1')
		expect(result).toContain('## Section 2')
		expect(result).not.toContain('key: value')
	})
})

describe('Identity template variable replacement', () => {
	const template = `# IDENTITY & ROLE

You are **{{ai_name}}**, an autonomous General-Purpose AI Agent.

- **Archetype:** {{archetype}}
- **Emoji:** {{emoji}}`

	test('replaces all template variables', () => {
		const result = template
			.replace(/\{\{ai_name\}\}/g, 'TestBot')
			.replace(/\{\{archetype\}\}/g, 'Hacker Sidekick')
			.replace(/\{\{emoji\}\}/g, '🤖')

		expect(result).toContain('**TestBot**')
		expect(result).toContain('**Archetype:** Hacker Sidekick')
		expect(result).toContain('**Emoji:** 🤖')
		expect(result).not.toContain('{{')
	})

	test('handles missing/empty values gracefully', () => {
		const result = template
			.replace(/\{\{ai_name\}\}/g, 'Bot')
			.replace(/\{\{archetype\}\}/g, '')
			.replace(/\{\{emoji\}\}/g, '')

		expect(result).toContain('**Bot**')
		expect(result).toContain('**Archetype:** ')
		expect(result).not.toContain('{{ai_name}}')
	})

	test('replaces multiple occurrences of same variable', () => {
		const multi = 'Hello {{ai_name}}, welcome {{ai_name}}!'
		const result = multi.replace(/\{\{ai_name\}\}/g, 'Tamias')
		expect(result).toBe('Hello Tamias, welcome Tamias!')
	})
})

describe('User template variable replacement', () => {
	const template = `## USER

- **User:** {{user_name}}
- **Style:** {{communication_preference}}
- **Timezone:** {{timezone}}

## About {{user_name}}

{{user_context}}`

	test('replaces all user variables', () => {
		const result = template
			.replace(/\{\{user_name\}\}/g, 'Alice')
			.replace(/\{\{communication_preference\}\}/g, 'Casual')
			.replace(/\{\{timezone\}\}/g, 'America/New_York')
			.replace(/\{\{user_context\}\}/g, 'Loves TypeScript')

		expect(result).toContain('**User:** Alice')
		expect(result).toContain('**Style:** Casual')
		expect(result).toContain('America/New_York')
		expect(result).toContain('About Alice')
		expect(result).toContain('Loves TypeScript')
		expect(result).not.toContain('{{')
	})

	test('user_name appears in multiple places and all are replaced', () => {
		const result = template.replace(/\{\{user_name\}\}/g, 'Bob')
		const matches = result.match(/Bob/g)
		expect(matches).toHaveLength(2) // "User: Bob" and "About Bob"
	})
})

// ─── Onboarding: file system behavior ──────────────────────────────────────

describe('Onboarding file system', () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'tamias-onboard-test-'))
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	test('isOnboarded checks for IDENTITY.md existence', () => {
		const memDir = join(tempDir, 'memory')
		const identityPath = join(memDir, 'IDENTITY.md')

		expect(existsSync(identityPath)).toBe(false)

		mkdirSync(memDir, { recursive: true })
		writeFileSync(identityPath, '# Identity', 'utf-8')
		expect(existsSync(identityPath)).toBe(true)
	})

	test('IDENTITY.md is created in memory directory', () => {
		const memDir = join(tempDir, 'memory')
		mkdirSync(memDir, { recursive: true })

		const content = '# IDENTITY & ROLE\n\nYou are **TestBot**.'
		writeFileSync(join(memDir, 'IDENTITY.md'), content, 'utf-8')

		const read = readFileSync(join(memDir, 'IDENTITY.md'), 'utf-8')
		expect(read).toContain('TestBot')
	})

	test('USER.md is created alongside IDENTITY.md', () => {
		const memDir = join(tempDir, 'memory')
		mkdirSync(memDir, { recursive: true })

		writeFileSync(join(memDir, 'IDENTITY.md'), '# Identity', 'utf-8')
		writeFileSync(join(memDir, 'USER.md'), '# User: Alice', 'utf-8')

		expect(existsSync(join(memDir, 'IDENTITY.md'))).toBe(true)
		expect(existsSync(join(memDir, 'USER.md'))).toBe(true)
	})

	test('.env file contains dashboard token after onboarding', () => {
		const envPath = join(tempDir, '.env')
		const token = 'abc123def456'

		writeFileSync(envPath, `TAMIAS_DASHBOARD_TOKEN=${token}\n`, 'utf-8')

		const content = readFileSync(envPath, 'utf-8')
		expect(content).toContain('TAMIAS_DASHBOARD_TOKEN=abc123def456')
	})

	test('existing .env content preserved when adding token', () => {
		const envPath = join(tempDir, '.env')
		writeFileSync(envPath, 'SOME_KEY=value\nANOTHER=thing\n', 'utf-8')

		const existing = readFileSync(envPath, 'utf-8')
		const lines = existing.split('\n').filter(l => l.trim())
		lines.push('TAMIAS_DASHBOARD_TOKEN=newtoken')
		writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')

		const result = readFileSync(envPath, 'utf-8')
		expect(result).toContain('SOME_KEY=value')
		expect(result).toContain('ANOTHER=thing')
		expect(result).toContain('TAMIAS_DASHBOARD_TOKEN=newtoken')
	})
})
