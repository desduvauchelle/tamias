import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
	readProjectReadme,
	writeProjectReadme,
	updateProjectFrontmatter,
	generateReadmeBody,
	updateReadmeSection,
} from './projectReadme.ts'
import type { ProjectFrontmatter } from './projectReadme.ts'

let tempDir: string

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'tamias-readme-test-'))
})

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true })
})

describe('readProjectReadme', () => {
	test('returns null when directory has no README.md', () => {
		expect(readProjectReadme(tempDir)).toBeNull()
	})

	test('returns null for non-existent directory', () => {
		expect(readProjectReadme(join(tempDir, 'nope'))).toBeNull()
	})

	test('parses all frontmatter fields', () => {
		writeFileSync(join(tempDir, 'README.md'), `---
name: My Project
description: A cool project
status: active
website: https://example.com
discordServerId: "111"
discordChannelId: "222"
techStack: "Next.js, TypeScript"
preferredModel: "openrouter/claude-3-opus"
preferredModelFallbacks:
  - openrouter/gpt-4
preferredConnections:
  - openrouter
objectives:
  - Launch MVP
  - Fix bugs
createdAt: "2026-01-01T00:00:00Z"
updatedAt: "2026-04-05T00:00:00Z"
---
# My Project

Hello world.
`, 'utf-8')

		const result = readProjectReadme(tempDir)
		expect(result).not.toBeNull()
		expect(result!.frontmatter.name).toBe('My Project')
		expect(result!.frontmatter.description).toBe('A cool project')
		expect(result!.frontmatter.status).toBe('active')
		expect(result!.frontmatter.website).toBe('https://example.com')
		expect(result!.frontmatter.discordServerId).toBe('111')
		expect(result!.frontmatter.discordChannelId).toBe('222')
		expect(result!.frontmatter.techStack).toBe('Next.js, TypeScript')
		expect(result!.frontmatter.preferredModel).toBe('openrouter/claude-3-opus')
		expect(result!.frontmatter.preferredModelFallbacks).toEqual(['openrouter/gpt-4'])
		expect(result!.frontmatter.preferredConnections).toEqual(['openrouter'])
		expect(result!.frontmatter.objectives).toEqual(['Launch MVP', 'Fix bugs'])
		expect(result!.frontmatter.createdAt).toBe('2026-01-01T00:00:00Z')
		expect(result!.frontmatter.updatedAt).toBe('2026-04-05T00:00:00Z')
		expect(result!.body).toContain('Hello world.')
	})

	test('handles README with no frontmatter', () => {
		writeFileSync(join(tempDir, 'README.md'), '# Just Markdown\n\nNo frontmatter here.\n', 'utf-8')
		const result = readProjectReadme(tempDir)
		expect(result).not.toBeNull()
		expect(result!.frontmatter.name).toBe('')
		expect(result!.body).toContain('# Just Markdown')
	})

	test('handles README with empty frontmatter', () => {
		writeFileSync(join(tempDir, 'README.md'), '---\n---\n# Empty FM\n', 'utf-8')
		const result = readProjectReadme(tempDir)
		expect(result).not.toBeNull()
		expect(result!.frontmatter.name).toBe('')
		expect(result!.body).toContain('# Empty FM')
	})

	test('does not include undefined fields for missing frontmatter keys', () => {
		writeFileSync(join(tempDir, 'README.md'), '---\nname: Minimal\n---\n# Minimal\n', 'utf-8')
		const result = readProjectReadme(tempDir)
		expect(result).not.toBeNull()
		expect(result!.frontmatter.name).toBe('Minimal')
		expect(result!.frontmatter.description).toBeUndefined()
		expect(result!.frontmatter.website).toBeUndefined()
		expect(result!.frontmatter.objectives).toBeUndefined()
	})
})

describe('writeProjectReadme', () => {
	test('creates README.md with frontmatter and body', () => {
		const fm: ProjectFrontmatter = {
			name: 'Test Project',
			description: 'A test',
			status: 'active',
		}
		writeProjectReadme(tempDir, fm, '# Test Project\n\nContent here.\n')

		const raw = readFileSync(join(tempDir, 'README.md'), 'utf-8')
		expect(raw).toContain('name: Test Project')
		expect(raw).toContain('description: A test')
		expect(raw).toContain('status: active')
		expect(raw).toContain('# Test Project')
		expect(raw).toContain('Content here.')
	})

	test('skips undefined and empty string fields in frontmatter, keeps empty arrays', () => {
		const fm: ProjectFrontmatter = {
			name: 'Clean',
			description: undefined,
			website: '',
			objectives: [],
		}
		writeProjectReadme(tempDir, fm, '# Clean\n')

		const raw = readFileSync(join(tempDir, 'README.md'), 'utf-8')
		expect(raw).toContain('name: Clean')
		expect(raw).not.toContain('description')
		expect(raw).not.toContain('website')
		// Empty arrays are preserved so they round-trip correctly
		expect(raw).toContain('objectives')
	})

	test('round-trips: write then read returns equivalent data', () => {
		const fm: ProjectFrontmatter = {
			name: 'RoundTrip',
			description: 'Desc here',
			status: 'paused',
			website: 'https://rt.com',
			discordChannelId: '12345',
			techStack: 'Bun, TypeScript',
			preferredModel: 'openai/gpt-4',
			preferredModelFallbacks: ['openai/gpt-3.5'],
			preferredConnections: ['openai'],
			objectives: ['Ship v1', 'Get feedback'],
			createdAt: '2026-01-01',
			updatedAt: '2026-04-01',
		}
		const body = '# RoundTrip\n\nSome content.\n'

		writeProjectReadme(tempDir, fm, body)
		const result = readProjectReadme(tempDir)

		expect(result).not.toBeNull()
		expect(result!.frontmatter.name).toBe('RoundTrip')
		expect(result!.frontmatter.description).toBe('Desc here')
		expect(result!.frontmatter.status).toBe('paused')
		expect(result!.frontmatter.website).toBe('https://rt.com')
		expect(result!.frontmatter.discordChannelId).toBe('12345')
		expect(result!.frontmatter.techStack).toBe('Bun, TypeScript')
		expect(result!.frontmatter.preferredModel).toBe('openai/gpt-4')
		expect(result!.frontmatter.preferredModelFallbacks).toEqual(['openai/gpt-3.5'])
		expect(result!.frontmatter.preferredConnections).toEqual(['openai'])
		expect(result!.frontmatter.objectives).toEqual(['Ship v1', 'Get feedback'])
		expect(result!.body).toContain('Some content.')
	})
})

describe('updateProjectFrontmatter', () => {
	test('updates specific fields, preserves others and body', () => {
		const fm: ProjectFrontmatter = {
			name: 'Original',
			description: 'Original desc',
			status: 'active',
		}
		writeProjectReadme(tempDir, fm, '# Original\n\nDo not touch this body.\n')

		updateProjectFrontmatter(tempDir, { description: 'Updated desc', website: 'https://new.com' })

		const result = readProjectReadme(tempDir)
		expect(result).not.toBeNull()
		expect(result!.frontmatter.name).toBe('Original')
		expect(result!.frontmatter.description).toBe('Updated desc')
		expect(result!.frontmatter.website).toBe('https://new.com')
		expect(result!.frontmatter.status).toBe('active')
		expect(result!.body).toContain('Do not touch this body.')
	})

	test('creates README.md if it does not exist', () => {
		updateProjectFrontmatter(tempDir, { name: 'Created', description: 'From scratch' })

		const result = readProjectReadme(tempDir)
		expect(result).not.toBeNull()
		expect(result!.frontmatter.name).toBe('Created')
		expect(result!.frontmatter.description).toBe('From scratch')
	})
})

describe('generateReadmeBody', () => {
	test('generates template with name and description', () => {
		const body = generateReadmeBody('Cool Project', 'Does cool things')
		expect(body).toContain('# Cool Project')
		expect(body).toContain('Does cool things')
		expect(body).toContain('## Objectives')
		expect(body).toContain('## Memos')
		expect(body).toContain('## Todo')
		expect(body).toContain('## Notes')
	})

	test('uses default description when none provided', () => {
		const body = generateReadmeBody('Bare Project')
		expect(body).toContain('# Bare Project')
		expect(body).toContain('A Tamias project.')
	})
})

describe('updateReadmeSection', () => {
	const body = `# Project

## Overview

Some overview text.

## Notes

Old notes here.

## Todo

- [ ] Task 1
`

	test('replaces content of an existing section', () => {
		const updated = updateReadmeSection(body, 'Notes', 'Brand new notes.')
		expect(updated).toContain('## Notes')
		expect(updated).toContain('Brand new notes.')
		expect(updated).not.toContain('Old notes here.')
		// Other sections preserved
		expect(updated).toContain('Some overview text.')
		expect(updated).toContain('- [ ] Task 1')
	})

	test('appends a new section if it does not exist', () => {
		const updated = updateReadmeSection(body, 'Architecture', 'Microservices pattern.')
		expect(updated).toContain('## Architecture')
		expect(updated).toContain('Microservices pattern.')
		// Original sections preserved
		expect(updated).toContain('## Notes')
		expect(updated).toContain('Old notes here.')
	})

	test('handles body with no sections', () => {
		const simpleBody = '# Just a title\n\nSome text.\n'
		const updated = updateReadmeSection(simpleBody, 'Notes', 'First note.')
		expect(updated).toContain('## Notes')
		expect(updated).toContain('First note.')
		expect(updated).toContain('# Just a title')
	})
})
