import { describe, test, expect, afterEach } from 'bun:test'
import {
	addProject, deleteProject,
	getProjectCrons, addProjectCron, updateProjectCron, removeProjectCron,
} from '../core/projects.ts'

const createdIds: string[] = []

afterEach(() => {
	for (const id of createdIds) {
		try { deleteProject(id) } catch {}
	}
	createdIds.length = 0
})

describe('Per-project crons', () => {
	test('getProjectCrons returns empty array for project with no crons', () => {
		const project = addProject({ name: 'Crons Empty Test', path: '/tmp/test' })
		createdIds.push(project.id)
		expect(getProjectCrons(project.id)).toEqual([])
	})

	test('getProjectCrons returns empty array for non-existent project', () => {
		expect(getProjectCrons('non-existent-project-xyz')).toEqual([])
	})

	test('addProjectCron creates a cron and returns it', () => {
		const project = addProject({ name: 'Crons Add Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const cron = addProjectCron(project.id, {
			name: 'Test Cron',
			schedule: '30m',
			type: 'ai',
			prompt: 'Check project status',
			target: 'last',
		})

		expect(cron.id).toBeDefined()
		expect(cron.id).toStartWith('cron_')
		expect(cron.name).toBe('Test Cron')
		expect(cron.schedule).toBe('30m')
		expect(cron.type).toBe('ai')
		expect(cron.prompt).toBe('Check project status')
		expect(cron.enabled).toBe(true)
		expect(cron.createdAt).toBeDefined()
	})

	test('addProjectCron throws for non-existent project', () => {
		expect(() => addProjectCron('non-existent', {
			name: 'Fail',
			schedule: '1h',
			type: 'ai',
			prompt: 'X',
			target: 'last',
		})).toThrow('Project non-existent not found')
	})

	test('getProjectCrons returns all crons after adding multiple', () => {
		const project = addProject({ name: 'Crons List Test', path: '/tmp/test' })
		createdIds.push(project.id)

		addProjectCron(project.id, { name: 'Cron A', schedule: '30m', type: 'ai', prompt: 'A', target: 'last' })
		addProjectCron(project.id, { name: 'Cron B', schedule: '1h', type: 'message', prompt: 'B', target: 'last' })

		const crons = getProjectCrons(project.id)
		expect(crons).toHaveLength(2)
		expect(crons.map(c => c.name).sort()).toEqual(['Cron A', 'Cron B'])
	})

	test('updateProjectCron modifies cron fields', () => {
		const project = addProject({ name: 'Crons Update Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const cron = addProjectCron(project.id, { name: 'Updatable', schedule: '30m', type: 'ai', prompt: 'Original', target: 'last' })
		const updated = updateProjectCron(project.id, cron.id, { prompt: 'Modified', enabled: false })

		expect(updated.prompt).toBe('Modified')
		expect(updated.enabled).toBe(false)
		expect(updated.name).toBe('Updatable')
	})

	test('updateProjectCron throws for non-existent cron', () => {
		const project = addProject({ name: 'Crons Update Fail Test', path: '/tmp/test' })
		createdIds.push(project.id)

		expect(() => updateProjectCron(project.id, 'nope', { prompt: 'X' }))
			.toThrow('Cron "nope" not found')
	})

	test('removeProjectCron removes the cron', () => {
		const project = addProject({ name: 'Crons Remove Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const cron = addProjectCron(project.id, { name: 'Removable', schedule: '30m', type: 'ai', prompt: 'Bye', target: 'last' })
		expect(getProjectCrons(project.id)).toHaveLength(1)

		removeProjectCron(project.id, cron.id)
		expect(getProjectCrons(project.id)).toHaveLength(0)
	})

	test('removeProjectCron throws for non-existent cron', () => {
		const project = addProject({ name: 'Crons Remove Fail Test', path: '/tmp/test' })
		createdIds.push(project.id)

		expect(() => removeProjectCron(project.id, 'nope')).toThrow('Cron "nope" not found')
	})

	test('project deletion cleans up crons', () => {
		const project = addProject({ name: 'Crons Cleanup Test', path: '/tmp/test' })
		createdIds.push(project.id)

		addProjectCron(project.id, { name: 'Doomed', schedule: '30m', type: 'ai', prompt: 'Gone', target: 'last' })
		expect(getProjectCrons(project.id)).toHaveLength(1)

		deleteProject(project.id)
		createdIds.pop() // already deleted
		expect(getProjectCrons(project.id)).toEqual([])
	})

	test('updateProjectCron records lastRun and lastStatus', () => {
		const project = addProject({ name: 'Crons LastRun Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const cron = addProjectCron(project.id, { name: 'Runner', schedule: '30m', type: 'ai', prompt: 'Run', target: 'last' })
		const now = new Date().toISOString()
		const updated = updateProjectCron(project.id, cron.id, { lastRun: now, lastStatus: 'success' })

		expect(updated.lastRun).toBe(now)
		expect(updated.lastStatus).toBe('success')
	})
})
