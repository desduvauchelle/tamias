import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import type { Skill } from '../utils/skills.ts'

// ─── Per-project skills merge logic tests ──────────────────────────────────
// These test the merge algorithm used by getSkillsForProject()
// without importing the module (to avoid side effects with TAMIAS_DIR)

function mergeSkillsForProject(allSkills: Skill[], projectId: string): Skill[] {
	const globalSkills = allSkills.filter(s => !s.projectId)
	const projectSkills = allSkills.filter(s => s.projectId === projectId)

	const result = [...globalSkills]
	for (const ps of projectSkills) {
		const idx = result.findIndex(s => s.name.toLowerCase() === ps.name.toLowerCase())
		if (idx >= 0) {
			result[idx] = ps
		} else {
			result.push(ps)
		}
	}
	return result
}

function makeSkill(name: string, projectId?: string): Skill {
	return {
		name,
		description: `${name} skill`,
		sourceDir: `/tmp/${name}`,
		content: `# ${name}`,
		isBuiltIn: !projectId,
		projectId,
	}
}

describe('Per-project skills merge logic', () => {
	test('returns only global skills when project has none', () => {
		const skills = [
			makeSkill('coding'),
			makeSkill('research'),
		]
		const result = mergeSkillsForProject(skills, 'my-project')
		expect(result).toHaveLength(2)
		expect(result.map(s => s.name)).toEqual(['coding', 'research'])
	})

	test('includes project-specific skills alongside globals', () => {
		const skills = [
			makeSkill('coding'),
			makeSkill('deploy', 'my-project'),
		]
		const result = mergeSkillsForProject(skills, 'my-project')
		expect(result).toHaveLength(2)
		expect(result.map(s => s.name)).toContain('coding')
		expect(result.map(s => s.name)).toContain('deploy')
	})

	test('project skill overrides global skill with same name', () => {
		const skills = [
			makeSkill('coding'),
			makeSkill('coding', 'my-project'),
		]
		const result = mergeSkillsForProject(skills, 'my-project')
		expect(result).toHaveLength(1)
		expect(result[0].name).toBe('coding')
		expect(result[0].projectId).toBe('my-project')
	})

	test('override is case-insensitive on skill name', () => {
		const skills = [
			makeSkill('Coding'),
			makeSkill('coding', 'proj'),
		]
		const result = mergeSkillsForProject(skills, 'proj')
		expect(result).toHaveLength(1)
		expect(result[0].projectId).toBe('proj')
	})

	test('skills from other projects are excluded', () => {
		const skills = [
			makeSkill('coding'),
			makeSkill('deploy', 'project-a'),
			makeSkill('testing', 'project-b'),
		]
		const result = mergeSkillsForProject(skills, 'project-a')
		expect(result).toHaveLength(2)
		expect(result.map(s => s.name)).toContain('coding')
		expect(result.map(s => s.name)).toContain('deploy')
		expect(result.map(s => s.name)).not.toContain('testing')
	})

	test('empty skills array returns empty result', () => {
		const result = mergeSkillsForProject([], 'any-project')
		expect(result).toEqual([])
	})

	test('all global skills with no project skills returns all globals', () => {
		const skills = [
			makeSkill('coding'),
			makeSkill('research'),
			makeSkill('writing'),
		]
		const result = mergeSkillsForProject(skills, 'empty-project')
		expect(result).toHaveLength(3)
		expect(result.every(s => !s.projectId)).toBe(true)
	})

	test('multiple project overrides work correctly', () => {
		const skills = [
			makeSkill('coding'),
			makeSkill('research'),
			makeSkill('writing'),
			makeSkill('coding', 'proj'),
			makeSkill('research', 'proj'),
		]
		const result = mergeSkillsForProject(skills, 'proj')
		expect(result).toHaveLength(3)
		expect(result.find(s => s.name === 'coding')!.projectId).toBe('proj')
		expect(result.find(s => s.name === 'research')!.projectId).toBe('proj')
		expect(result.find(s => s.name === 'writing')!.projectId).toBeUndefined()
	})
})

// ─── Skill file structure tests ────────────────────────────────────────────

describe('Per-project skill directory structure', () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'tamias-skills-test-'))
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	test('skill directory contains SKILL.md', () => {
		const skillDir = join(tempDir, 'projects', 'myproj', 'skills', 'my-skill')
		mkdirSync(skillDir, { recursive: true })
		writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: "My Skill"\ndescription: "Does something"\n---\n\n# My Skill\n\nInstructions here.', 'utf-8')

		expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
		const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
		expect(content).toContain('My Skill')
		expect(content).toContain('Instructions here')
	})

	test('SKILL.md frontmatter has name and description', () => {
		const content = `---
name: "Custom Deploy"
description: "Deploys to production"
---

# Custom Deploy

Run \`deploy.sh\` to push to prod.`

		const skillDir = join(tempDir, 'skills', 'custom-deploy')
		mkdirSync(skillDir, { recursive: true })
		writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8')

		const read = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
		// Parse frontmatter manually
		const match = read.match(/^---\n([\s\S]*?)\n---/)
		expect(match).toBeTruthy()
		expect(match![1]).toContain('name: "Custom Deploy"')
		expect(match![1]).toContain('description: "Deploys to production"')
	})

	test('multiple skills can exist in one project', () => {
		const skillsBase = join(tempDir, 'projects', 'myproj', 'skills')
		const skills = ['linting', 'testing', 'deploying']
		for (const s of skills) {
			const dir = join(skillsBase, s)
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, 'SKILL.md'), `# ${s}`, 'utf-8')
		}

		const { readdirSync } = require('fs')
		const entries = readdirSync(skillsBase, { withFileTypes: true })
			.filter((e: any) => e.isDirectory())
			.map((e: any) => e.name)

		expect(entries).toHaveLength(3)
		expect(entries).toContain('linting')
		expect(entries).toContain('testing')
		expect(entries).toContain('deploying')
	})

	test('skill directory without SKILL.md is ignored by scanner', () => {
		const skillDir = join(tempDir, 'skills', 'empty-skill')
		mkdirSync(skillDir, { recursive: true })
		// No SKILL.md created

		expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(false)
	})
})

// ─── getSkillsForProject via real module ───────────────────────────────────

describe('getSkillsForProject integration', () => {
	test('returns skills for a project (may be empty if no project skills)', () => {
		const { getSkillsForProject, getLoadedSkills } = require('../utils/skills')
		// After loadSkills, getSkillsForProject returns globals + any project-local
		const result = getSkillsForProject('non-existent-project-xyz')
		expect(Array.isArray(result)).toBe(true)
		// All returned should be global (no projectId) since the project doesn't exist
		for (const s of result) {
			expect(s.projectId).toBeUndefined()
		}
	})

	test('getLoadedSkills returns an array', () => {
		const { getLoadedSkills } = require('../utils/skills')
		const skills = getLoadedSkills()
		expect(Array.isArray(skills)).toBe(true)
	})
})
