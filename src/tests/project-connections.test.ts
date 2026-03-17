import { describe, test, expect, afterEach } from 'bun:test'
import { addProject, deleteProject, getProject, updateProject } from '../core/projects.ts'

const createdIds: string[] = []

afterEach(() => {
	for (const id of createdIds) {
		try { deleteProject(id) } catch {}
	}
	createdIds.length = 0
})

describe('Per-project connection preferences', () => {
	test('new project has no connection preferences by default', () => {
		const project = addProject({ name: 'Conn Default Test', path: '/tmp/test' })
		createdIds.push(project.id)

		expect(project.preferredConnections).toBeUndefined()
		expect(project.preferredModel).toBeUndefined()
		expect(project.preferredModelFallbacks).toBeUndefined()
	})

	test('preferredConnections round-trips through update/get', () => {
		const project = addProject({ name: 'Conn Roundtrip Test', path: '/tmp/test' })
		createdIds.push(project.id)

		updateProject(project.id, { preferredConnections: ['openai-main', 'anthropic-prod'] })
		const retrieved = getProject(project.id)

		expect(retrieved).toBeDefined()
		expect(retrieved!.preferredConnections).toEqual(['openai-main', 'anthropic-prod'])
	})

	test('preferredModel round-trips through update/get', () => {
		const project = addProject({ name: 'Model Roundtrip Test', path: '/tmp/test' })
		createdIds.push(project.id)

		updateProject(project.id, { preferredModel: 'openai-main/gpt-4o' })
		const retrieved = getProject(project.id)

		expect(retrieved!.preferredModel).toBe('openai-main/gpt-4o')
	})

	test('preferredModelFallbacks round-trips through update/get', () => {
		const project = addProject({ name: 'Fallback Roundtrip Test', path: '/tmp/test' })
		createdIds.push(project.id)

		updateProject(project.id, {
			preferredModel: 'openai-main/gpt-4o',
			preferredModelFallbacks: ['anthropic-prod/claude-sonnet-4', 'openai-main/gpt-4o-mini'],
		})
		const retrieved = getProject(project.id)

		expect(retrieved!.preferredModelFallbacks).toEqual([
			'anthropic-prod/claude-sonnet-4',
			'openai-main/gpt-4o-mini',
		])
	})

	test('updating preferredConnections does not affect other config fields', () => {
		const project = addProject({ name: 'Conn Isolation Test', description: 'Original desc', path: '/tmp/test' })
		createdIds.push(project.id)

		updateProject(project.id, { preferredConnections: ['my-conn'] })
		const retrieved = getProject(project.id)

		expect(retrieved!.description).toBe('Original desc')
		expect(retrieved!.name).toBe('Conn Isolation Test')
		expect(retrieved!.preferredConnections).toEqual(['my-conn'])
	})

	test('clearing preferences by setting empty array', () => {
		const project = addProject({ name: 'Conn Clear Test', path: '/tmp/test' })
		createdIds.push(project.id)

		updateProject(project.id, { preferredConnections: ['openai'], preferredModel: 'openai/gpt-4o' })
		updateProject(project.id, { preferredConnections: [], preferredModel: undefined })
		const retrieved = getProject(project.id)

		expect(retrieved!.preferredConnections).toEqual([])
	})
})
