import { describe, test, expect, afterEach } from 'bun:test'
import {
	addProject, deleteProject, getProject,
	getProjectAgents, addProjectAgent, updateProjectAgent, removeProjectAgent,
} from '../core/projects.ts'

const createdIds: string[] = []

afterEach(() => {
	for (const id of createdIds) {
		try { deleteProject(id) } catch {}
	}
	createdIds.length = 0
})

describe('Per-project agents', () => {
	test('getProjectAgents returns empty array for project with no agents', () => {
		const project = addProject({ name: 'Agents Empty Test', path: '/tmp/test' })
		createdIds.push(project.id)
		expect(getProjectAgents(project.id)).toEqual([])
	})

	test('getProjectAgents returns empty array for non-existent project', () => {
		expect(getProjectAgents('non-existent-project-xyz')).toEqual([])
	})

	test('addProjectAgent creates an agent and returns it', () => {
		const project = addProject({ name: 'Agents Add Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const agent = addProjectAgent(project.id, {
			slug: 'test-agent',
			name: 'Test Agent',
			instructions: 'You are a test agent.',
		})

		expect(agent.id).toBeDefined()
		expect(agent.slug).toBe('test-agent')
		expect(agent.name).toBe('Test Agent')
		expect(agent.instructions).toBe('You are a test agent.')
		expect(agent.enabled).toBe(true)
	})

	test('addProjectAgent auto-derives slug from name', () => {
		const project = addProject({ name: 'Agents Slug Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const agent = addProjectAgent(project.id, {
			slug: '',
			name: 'My Cool Agent',
			instructions: 'Test',
		})

		expect(agent.slug).toBe('my-cool-agent')
	})

	test('addProjectAgent throws for non-existent project', () => {
		expect(() => addProjectAgent('non-existent', {
			slug: 'test',
			name: 'Test',
			instructions: 'Test',
		})).toThrow('Project non-existent not found')
	})

	test('getProjectAgents returns all agents after adding multiple', () => {
		const project = addProject({ name: 'Agents List Test', path: '/tmp/test' })
		createdIds.push(project.id)

		addProjectAgent(project.id, { slug: 'agent-a', name: 'Agent A', instructions: 'A' })
		addProjectAgent(project.id, { slug: 'agent-b', name: 'Agent B', instructions: 'B' })

		const agents = getProjectAgents(project.id)
		expect(agents).toHaveLength(2)
		expect(agents.map(a => a.slug).sort()).toEqual(['agent-a', 'agent-b'])
	})

	test('updateProjectAgent modifies agent fields', () => {
		const project = addProject({ name: 'Agents Update Test', path: '/tmp/test' })
		createdIds.push(project.id)

		addProjectAgent(project.id, { slug: 'updatable', name: 'Updatable', instructions: 'Original' })
		const updated = updateProjectAgent(project.id, 'updatable', { instructions: 'Modified', enabled: false })

		expect(updated.instructions).toBe('Modified')
		expect(updated.enabled).toBe(false)
		expect(updated.slug).toBe('updatable')
	})

	test('updateProjectAgent throws for non-existent agent', () => {
		const project = addProject({ name: 'Agents Update Fail Test', path: '/tmp/test' })
		createdIds.push(project.id)

		expect(() => updateProjectAgent(project.id, 'nope', { instructions: 'X' }))
			.toThrow('Agent "nope" not found')
	})

	test('removeProjectAgent removes the agent', () => {
		const project = addProject({ name: 'Agents Remove Test', path: '/tmp/test' })
		createdIds.push(project.id)

		addProjectAgent(project.id, { slug: 'removable', name: 'Removable', instructions: 'Bye' })
		expect(getProjectAgents(project.id)).toHaveLength(1)

		removeProjectAgent(project.id, 'removable')
		expect(getProjectAgents(project.id)).toHaveLength(0)
	})

	test('removeProjectAgent throws for non-existent agent', () => {
		const project = addProject({ name: 'Agents Remove Fail Test', path: '/tmp/test' })
		createdIds.push(project.id)

		expect(() => removeProjectAgent(project.id, 'nope')).toThrow('Agent "nope" not found')
	})

	test('project deletion cleans up agents', () => {
		const project = addProject({ name: 'Agents Cleanup Test', path: '/tmp/test' })
		createdIds.push(project.id)

		addProjectAgent(project.id, { slug: 'doomed', name: 'Doomed', instructions: 'Gone soon' })
		expect(getProjectAgents(project.id)).toHaveLength(1)

		deleteProject(project.id)
		createdIds.pop() // already deleted
		expect(getProjectAgents(project.id)).toEqual([])
	})

	test('addProject initializes agents.json as empty array', () => {
		const project = addProject({ name: 'Agents Init Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const { join } = require('path')
		const { readFileSync } = require('fs')
		const { TAMIAS_DIR } = require('../utils/config')
		const agentsFile = join(TAMIAS_DIR, 'workspace', project.id, 'agents.json')
		const content = JSON.parse(readFileSync(agentsFile, 'utf-8'))
		expect(content).toEqual([])
	})

	test('addProject initializes cron.json as empty array', () => {
		const project = addProject({ name: 'Cron Init Test', path: '/tmp/test' })
		createdIds.push(project.id)

		const { join } = require('path')
		const { readFileSync } = require('fs')
		const { TAMIAS_DIR } = require('../utils/config')
		const cronFile = join(TAMIAS_DIR, 'workspace', project.id, 'cron.json')
		const content = JSON.parse(readFileSync(cronFile, 'utf-8'))
		expect(content).toEqual([])
	})
})
