import { describe, expect, test } from 'bun:test'
import { moveModelPreference, reorderModelPreferences } from '../app/tools/modelPreferences'

describe('model preferences helpers', () => {
	test('reorders models when dragging from one valid index to another', () => {
		const models = ['openai/gpt-image-1', 'google/imagen-3', 'replicate/flux']
		const reordered = reorderModelPreferences(models, 2, 0)
		expect(reordered).toEqual(['replicate/flux', 'openai/gpt-image-1', 'google/imagen-3'])
		expect(models).toEqual(['openai/gpt-image-1', 'google/imagen-3', 'replicate/flux'])
	})

	test('returns unchanged copy for empty input', () => {
		const models: string[] = []
		expect(reorderModelPreferences(models, 0, 1)).toEqual([])
	})

	test('returns unchanged copy for malformed indexes', () => {
		const models = ['a', 'b', 'c']
		expect(reorderModelPreferences(models, -1, 1)).toEqual(models)
		expect(reorderModelPreferences(models, 1, -1)).toEqual(models)
		expect(reorderModelPreferences(models, 9, 1)).toEqual(models)
		expect(reorderModelPreferences(models, 1, 9)).toEqual(models)
	})

	test('keeps order unchanged when source and target are identical', () => {
		const models = ['x', 'y']
		expect(reorderModelPreferences(models, 1, 1)).toEqual(['x', 'y'])
	})

	test('supports boundary movements including first to last', () => {
		const models = ['m1', 'm2', 'm3', 'm4']
		expect(reorderModelPreferences(models, 0, 3)).toEqual(['m2', 'm3', 'm4', 'm1'])
	})

	test('moves one step up or down with move helper and guards boundaries', () => {
		const models = ['alpha', 'beta', 'gamma']
		expect(moveModelPreference(models, 1, -1)).toEqual(['beta', 'alpha', 'gamma'])
		expect(moveModelPreference(models, 1, 1)).toEqual(['alpha', 'gamma', 'beta'])
		expect(moveModelPreference(models, 0, -1)).toEqual(['alpha', 'beta', 'gamma'])
		expect(moveModelPreference(models, 2, 1)).toEqual(['alpha', 'beta', 'gamma'])
	})
})
