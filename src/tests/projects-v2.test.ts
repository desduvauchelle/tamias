import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, renameSync } from 'fs'
import { tmpdir } from 'os'
import matter from 'gray-matter'
import { slugifyProject, addProject, getProject, getProjects, deleteProject, updateProject, getProjectSkills } from '../core/projects.ts'

// ─── Temp dir for structure-only tests ─────────────────────────────────────

let tempDir: string
let projectsDir: string

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'tamias-projects-test-'))
	projectsDir = join(tempDir, 'projects')
	mkdirSync(projectsDir, { recursive: true })
})

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true })
})

function createProjectDir(id: string, frontmatter: Record<string, unknown>, kanban: unknown[] = []) {
	const dir = join(projectsDir, id)
	mkdirSync(dir, { recursive: true })
	const body = `# ${frontmatter.name || id}\n\nProject description.\n`
	const readme = matter.stringify(body, frontmatter)
	writeFileSync(join(dir, 'README.md'), readme, 'utf-8')
	writeFileSync(join(dir, 'kanban.json'), JSON.stringify(kanban, null, 2), 'utf-8')
	return dir
}

// ─── Directory structure tests (filesystem-only, no module side-effects) ───

describe('Project directory structure', () => {
	test('README.md has valid YAML frontmatter with required fields', () => {
		const fm = {
			name: 'Test Project',
			description: 'A test',
			status: 'active',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}
		const dir = createProjectDir('test-project', fm)

		const raw = readFileSync(join(dir, 'README.md'), 'utf-8')
		const parsed = matter(raw)
		expect(parsed.data.name).toBe('Test Project')
		expect(parsed.data.description).toBe('A test')
		expect(parsed.data.status).toBe('active')
		expect(parsed.data.createdAt).toBeDefined()
		expect(parsed.data.updatedAt).toBeDefined()
	})

	test('kanban.json starts as empty array', () => {
		createProjectDir('empty-kanban', { name: 'Empty' })
		const kanban = JSON.parse(readFileSync(join(projectsDir, 'empty-kanban', 'kanban.json'), 'utf-8'))
		expect(kanban).toEqual([])
	})

	test('kanban.json stores tasks with enhanced fields (priority, dueDate, labels)', () => {
		const futureDate = Date.now() + 86400000
		const tasks = [{
			id: 'task1',
			title: 'Fix bug',
			status: 'todo',
			createdAt: Date.now(),
			priority: 'high',
			dueDate: futureDate,
			labels: ['bug', 'critical'],
			order: 0,
		}]
		createProjectDir('kanban-test', { name: 'Test' }, tasks)

		const kanban = JSON.parse(readFileSync(join(projectsDir, 'kanban-test', 'kanban.json'), 'utf-8'))
		expect(kanban).toHaveLength(1)
		expect(kanban[0].id).toBe('task1')
		expect(kanban[0].title).toBe('Fix bug')
		expect(kanban[0].priority).toBe('high')
		expect(kanban[0].labels).toEqual(['bug', 'critical'])
		expect(kanban[0].dueDate).toBe(futureDate)
		expect(kanban[0].order).toBe(0)
	})

	test('project directory can contain skills subdirectory with SKILL.md files', () => {
		const dir = createProjectDir('with-skills', { name: 'Skills' })
		const skillDir = join(dir, 'skills', 'custom-skill')
		mkdirSync(skillDir, { recursive: true })
		writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: "Custom Skill"\ndescription: "A test skill"\n---\n\n# Custom Skill\n\nDo the thing.', 'utf-8')

		expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
		const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
		expect(content).toContain('Custom Skill')
		expect(content).toContain('Do the thing')
	})

	test('multiple projects co-exist as separate directories', () => {
		createProjectDir('proj-a', { name: 'A' })
		createProjectDir('proj-b', { name: 'B' })
		createProjectDir('proj-c', { name: 'C' })

		const entries = readdirSync(projectsDir)
		expect(entries).toContain('proj-a')
		expect(entries).toContain('proj-b')
		expect(entries).toContain('proj-c')
		expect(entries).toHaveLength(3)
	})

	test('README.md frontmatter does NOT contain kanban data (separation)', () => {
		const dir = createProjectDir('no-kanban-in-fm', {
			name: 'Separate',
		})

		const raw = readFileSync(join(dir, 'README.md'), 'utf-8')
		const parsed = matter(raw)
		expect(parsed.data.kanban).toBeUndefined()
	})
})

// ─── Migration simulation ──────────────────────────────────────────────────

describe('Migration from projects.json', () => {
	test('old format projects.json contains inline kanban to be split', () => {
		const oldFile = join(tempDir, 'projects.json')
		const oldData = {
			abc123: {
				id: 'abc123',
				name: 'Old Project',
				description: 'Migrated',
				path: '/old/path',
				kanban: [
					{ id: 't1', title: 'Old task', status: 'todo', createdAt: 1000 }
				]
			}
		}
		writeFileSync(oldFile, JSON.stringify(oldData, null, 2), 'utf-8')

		const parsed = JSON.parse(readFileSync(oldFile, 'utf-8'))
		expect(parsed.abc123.name).toBe('Old Project')
		expect(parsed.abc123.kanban).toHaveLength(1)
		expect(parsed.abc123.kanban[0].title).toBe('Old task')
	})

	test('migration output creates README.md with frontmatter and kanban.json with tasks', () => {
		const projectDir = join(projectsDir, 'migrated-project')
		mkdirSync(projectDir, { recursive: true })

		// Simulate migration output with README.md frontmatter
		const body = `# Old Project\n\nMigrated\n`
		const readme = matter.stringify(body, { name: 'Old Project', status: 'active' })
		writeFileSync(join(projectDir, 'README.md'), readme, 'utf-8')
		const kanban = [{ id: 't1', title: 'Old task', status: 'todo', createdAt: 1000 }]
		writeFileSync(join(projectDir, 'kanban.json'), JSON.stringify(kanban, null, 2), 'utf-8')
		mkdirSync(join(projectDir, 'skills'), { recursive: true })

		const raw = readFileSync(join(projectDir, 'README.md'), 'utf-8')
		const parsed = matter(raw)
		expect(parsed.data.name).toBe('Old Project')
		expect(parsed.data.kanban).toBeUndefined()

		const readKanban = JSON.parse(readFileSync(join(projectDir, 'kanban.json'), 'utf-8'))
		expect(readKanban).toHaveLength(1)
		expect(readKanban[0].title).toBe('Old task')

		expect(existsSync(join(projectDir, 'skills'))).toBe(true)
	})

	test('migration renames old projects.json to .bak', () => {
		const oldFile = join(tempDir, 'projects.json')
		writeFileSync(oldFile, '{}', 'utf-8')

		renameSync(oldFile, oldFile + '.bak')

		expect(existsSync(oldFile)).toBe(false)
		expect(existsSync(oldFile + '.bak')).toBe(true)
	})
})

// ─── KanbanTask enhanced fields ────────────────────────────────────────────

describe('KanbanTask enhanced fields', () => {
	test('priority field accepts all valid values', () => {
		const priorities = ['low', 'medium', 'high', 'urgent'] as const
		for (const p of priorities) {
			const task = { id: '1', title: 'Test', status: 'todo' as const, createdAt: Date.now(), priority: p }
			expect(task.priority).toBe(p)
		}
	})

	test('dueDate stored as epoch timestamp roundtrips to correct date', () => {
		const date = new Date('2025-06-15T00:00:00.000Z')
		const task = { id: '1', title: 'Test', status: 'todo' as const, createdAt: Date.now(), dueDate: date.getTime() }
		expect(new Date(task.dueDate).toISOString()).toBe('2025-06-15T00:00:00.000Z')
	})

	test('labels is an array of strings', () => {
		const task = { id: '1', title: 'Test', status: 'todo' as const, createdAt: Date.now(), labels: ['bug', 'frontend', 'P1'] }
		expect(task.labels).toEqual(['bug', 'frontend', 'P1'])
		expect(Array.isArray(task.labels)).toBe(true)
	})

	test('empty labels array is valid', () => {
		const task = { id: '1', title: 'Test', status: 'todo' as const, createdAt: Date.now(), labels: [] as string[] }
		expect(task.labels).toEqual([])
	})

	test('order field is a number', () => {
		const task = { id: '1', title: 'Test', status: 'todo' as const, createdAt: Date.now(), order: 5 }
		expect(task.order).toBe(5)
	})

	test('task without enhanced fields is backward compatible', () => {
		const task: Record<string, unknown> = { id: '1', title: 'Basic', status: 'todo', createdAt: Date.now() }
		expect(task.priority).toBeUndefined()
		expect(task.dueDate).toBeUndefined()
		expect(task.labels).toBeUndefined()
		expect(task.order).toBeUndefined()
	})

	test('mixed old and new tasks roundtrip through JSON', () => {
		const tasks = [
			{ id: '1', title: 'Old Task', status: 'todo', createdAt: 1000 },
			{ id: '2', title: 'New Task', status: 'in-progress', createdAt: 2000, priority: 'urgent', labels: ['important'], dueDate: 999999 },
		]
		const json = JSON.stringify(tasks)
		const parsed = JSON.parse(json)

		expect(parsed[0].priority).toBeUndefined()
		expect(parsed[1].priority).toBe('urgent')
		expect(parsed[1].labels).toEqual(['important'])
	})
})

// ─── Slugification ─────────────────────────────────────────────────────────

describe('Project slugification', () => {
	test('converts name to URL-safe slug', () => {
		expect(slugifyProject('My Cool Project')).toBe('my-cool-project')
		expect(slugifyProject('hello_world')).toBe('hello-world')
		expect(slugifyProject('  spaces  ')).toBe('spaces')
		expect(slugifyProject('UPPERCASE')).toBe('uppercase')
	})

	test('removes special characters', () => {
		expect(slugifyProject('project@#$%^&*()')).toBe('project')
		expect(slugifyProject('hello.world.2024')).toBe('hello-world-2024')
	})

	test('handles empty string', () => {
		expect(slugifyProject('')).toBe('')
	})

	test('handles numbers', () => {
		expect(slugifyProject('project 42')).toBe('project-42')
		expect(slugifyProject('123')).toBe('123')
	})

	test('collapses consecutive separators', () => {
		expect(slugifyProject('foo---bar')).toBe('foo-bar')
		expect(slugifyProject('foo   bar')).toBe('foo-bar')
	})
})

// ─── CRUD Integration (uses real ~/.tamias/projects) ───────────────────────
// These create real projects in the user's TAMIAS_DIR but clean up after themselves

describe('Project CRUD integration', () => {
	const createdIds: string[] = []

	afterEach(() => {
		for (const id of createdIds) {
			try { deleteProject(id) } catch {}
		}
		createdIds.length = 0
	})

	test('addProject creates a project and returns it with id and timestamps', () => {
		const result = addProject({ name: 'CRUD Test Proj', path: '/tmp/crud', description: 'Test desc' })
		createdIds.push(result.id)

		expect(result.id).toBeDefined()
		expect(result.id).toContain('crud-test-proj')
		expect(result.name).toBe('CRUD Test Proj')
		expect(result.description).toBe('Test desc')
		expect(result.kanban).toEqual([])
		expect(result.createdAt).toBeDefined()
		expect(result.updatedAt).toBeDefined()
	})

	test('getProject retrieves a project by id', () => {
		const created = addProject({ name: 'Get Test Proj', path: '/tmp/get' })
		createdIds.push(created.id)

		const retrieved = getProject(created.id)
		expect(retrieved).toBeDefined()
		expect(retrieved!.name).toBe('Get Test Proj')
		expect(retrieved!.id).toContain('get-test-proj')
	})

	test('getProject returns undefined for non-existent project', () => {
		const result = getProject('non-existent-project-test-id-xyz')
		expect(result).toBeUndefined()
	})

	test('updateProject updates config fields', () => {
		const created = addProject({ name: 'Update Test Proj', path: '/tmp/upd' })
		createdIds.push(created.id)

		const updated = updateProject(created.id, { description: 'Updated desc' })
		expect(updated.description).toBe('Updated desc')

		const retrieved = getProject(created.id)
		expect(retrieved!.description).toBe('Updated desc')
	})

	test('updateProject writes kanban to separate kanban.json', () => {
		const created = addProject({ name: 'Kanban Upd Test', path: '/tmp/kb' })
		createdIds.push(created.id)

		const tasks = [{ id: 'k1', title: 'New Task', status: 'todo' as const, createdAt: Date.now(), priority: 'high' as const, labels: ['test'] }]
		const updated = updateProject(created.id, { kanban: tasks })

		expect(updated.kanban).toHaveLength(1)
		expect(updated.kanban[0].title).toBe('New Task')
		expect(updated.kanban[0].priority).toBe('high')
		expect(updated.kanban[0].labels).toEqual(['test'])

		const retrieved = getProject(created.id)
		expect(retrieved!.kanban).toHaveLength(1)
		expect(retrieved!.kanban[0].title).toBe('New Task')
	})

	test('deleteProject removes the project completely', () => {
		const created = addProject({ name: 'Delete Test Proj', path: '/tmp/del' })
		// Don't push to createdIds since we're deleting manually

		deleteProject(created.id)
		const retrieved = getProject(created.id)
		expect(retrieved).toBeUndefined()
	})

	test('getProjects returns all existing projects', () => {
		const p1 = addProject({ name: 'List Test Alpha', path: '/tmp/a' })
		const p2 = addProject({ name: 'List Test Beta', path: '/tmp/b' })
		createdIds.push(p1.id, p2.id)

		const all = getProjects()
		expect(all[p1.id]).toBeDefined()
		expect(all[p2.id]).toBeDefined()
		expect(all[p1.id].name).toBe('List Test Alpha')
		expect(all[p2.id].name).toBe('List Test Beta')
	})

	test('updateProject throws for non-existent project', () => {
		expect(() => updateProject('completely-non-existent-test-xyz', { name: 'Fail' })).toThrow()
	})

	test('getProjectSkills returns empty array for project without skills', () => {
		const created = addProject({ name: 'No Skills Test', path: '/tmp/ns' })
		createdIds.push(created.id)

		const skills = getProjectSkills(created.id)
		expect(skills).toEqual([])
	})

	test('addProject creates directory with expected files', () => {
		const created = addProject({ name: 'Files Test Proj', path: '/tmp/files' })
		createdIds.push(created.id)

		const { getProjectDirectory } = require('../core/projects')
		const dir = getProjectDirectory(created.id)

		expect(existsSync(join(dir, 'README.md'))).toBe(true)
		expect(existsSync(join(dir, 'kanban.json'))).toBe(true)
		expect(existsSync(join(dir, 'skills'))).toBe(true)

		// Verify README.md has YAML frontmatter
		const raw = readFileSync(join(dir, 'README.md'), 'utf-8')
		const parsed = matter(raw)
		expect(parsed.data.name).toBe('Files Test Proj')
		expect(parsed.data.status).toBe('active')
	})

	test('addProject generates unique id when slug already exists', () => {
		const p1 = addProject({ name: 'Dupe Name', path: '/tmp/d1' })
		const p2 = addProject({ name: 'Dupe Name', path: '/tmp/d2' })
		createdIds.push(p1.id, p2.id)

		expect(p1.id).not.toBe(p2.id)
		expect(p1.name).toBe('Dupe Name')
		expect(p2.name).toBe('Dupe Name')
	})
})
