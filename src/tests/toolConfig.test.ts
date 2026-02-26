import { describe, test, expect } from 'bun:test'
import { getToolPreferredModel, getToolPreferredProvider, generateToolGuide, DEFAULT_TOOL_PREFERENCES } from '../utils/toolConfig'

describe('Tool Config', () => {
	describe('DEFAULT_TOOL_PREFERENCES', () => {
		test('has preferences for image and gemini tools', () => {
			expect(DEFAULT_TOOL_PREFERENCES.length).toBeGreaterThanOrEqual(2)
			expect(DEFAULT_TOOL_PREFERENCES.find(p => p.toolName === 'image')).toBeDefined()
			expect(DEFAULT_TOOL_PREFERENCES.find(p => p.toolName === 'gemini')).toBeDefined()
		})
	})

	describe('getToolPreferredProvider', () => {
		test('returns openai for image tool', () => {
			expect(getToolPreferredProvider('image')).toBe('openai')
		})

		test('returns google for gemini tool', () => {
			expect(getToolPreferredProvider('gemini')).toBe('google')
		})

		test('returns undefined for unknown tool', () => {
			expect(getToolPreferredProvider('nonexistent')).toBeUndefined()
		})

		test('uses custom preferences when provided', () => {
			const custom = [{ toolName: 'myTool', preferredProvider: 'anthropic' }]
			expect(getToolPreferredProvider('myTool', custom)).toBe('anthropic')
		})
	})

	describe('getToolPreferredModel', () => {
		test('returns undefined when no model preference set', () => {
			expect(getToolPreferredModel('image')).toBeUndefined()
		})

		test('returns model when set in custom preferences', () => {
			const custom = [{ toolName: 'image', preferredModel: 'openai/dall-e-3' }]
			expect(getToolPreferredModel('image', custom)).toBe('openai/dall-e-3')
		})
	})

	describe('generateToolGuide', () => {
		test('generates markdown for tools', () => {
			const tools = [
				{
					name: 'terminal',
					description: 'Execute shell commands',
					functions: ['execute', 'read_output'],
				},
				{
					name: 'workspace',
					description: 'File operations',
					functions: ['read_file', 'write_file', 'list_dir'],
				},
			]

			const guide = generateToolGuide(tools)
			expect(guide).toContain('# Tool Reference Guide')
			expect(guide).toContain('## terminal')
			expect(guide).toContain('terminal__execute')
			expect(guide).toContain('## workspace')
			expect(guide).toContain('workspace__read_file')
		})

		test('handles empty tool list', () => {
			const guide = generateToolGuide([])
			expect(guide).toContain('# Tool Reference Guide')
		})
	})
})
