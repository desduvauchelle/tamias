import { expect, test, describe, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { EventEmitter } from 'events'
import { join } from 'node:path'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import {
	TAMIAS_DIR,
	saveConfig,
	invalidateConfigCache,
	type TamiasConfig,
} from '../utils/config'
import { setEnv, removeEnv } from '../utils/env'

// Mock the AI SDK before importing
mock.module('ai', () => {
	return {
		tool: (spec: any) => spec, // passthrough
		generateImage: async (params: any) => {
			if (params.prompt === 'fail') {
				throw new Error('Image generation failed intentionally')
			}
			return {
				image: {
					uint8Array: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]), // mock PNG bytes
				}
			}
		}
	}
})

import { createImageTools } from '../tools/image'
import type { AIService } from '../services/aiService'

const TEMP_WORKSPACE = join(TAMIAS_DIR, 'test-workspace')
const TEMP_FALLBACK = join(TAMIAS_DIR, 'generated-images')
const TEST_ENV_KEY = 'TAMIAS_TEST_IMAGE_API_KEY'

const BASE_CONFIG: TamiasConfig = {
	version: '1.0',
	connections: {
		'test-openai': {
			nickname: 'test-openai',
			provider: 'openai',
			envKeyName: TEST_ENV_KEY,
			selectedModels: ['dall-e-3'],
		},
	},
	bridges: { terminal: { enabled: true } },
	defaultImageModels: ['test-openai/dall-e-3'],
	debug: false,
}

function clearTestDirs() {
	if (existsSync(TEMP_WORKSPACE)) rmSync(TEMP_WORKSPACE, { recursive: true, force: true })
	if (existsSync(TEMP_FALLBACK)) rmSync(TEMP_FALLBACK, { recursive: true, force: true })
}

describe('Image Tool', () => {
	beforeEach(() => {
		clearTestDirs()
		mkdirSync(TEMP_WORKSPACE, { recursive: true })
		saveConfig(BASE_CONFIG)
		invalidateConfigCache()
		setEnv(TEST_ENV_KEY, 'sk-test')
	})

	afterEach(() => {
		invalidateConfigCache()
		removeEnv(TEST_ENV_KEY)
		mock.restore()
	})

	afterAll(() => {
		clearTestDirs()
	})

	test('saves image to disk in the provided workspace and returns filePath', async () => {
		const events: any[] = []
		const session = {
			id: 'sess123',
			emitter: new EventEmitter(),
		}
		session.emitter.on('event', e => events.push(e))

		const mockAiService = {
			getSession: () => session
		} as unknown as AIService

		const tools = createImageTools(mockAiService, 'sess123', TEMP_WORKSPACE)
		const execute = (tools.generate as any).execute

		const result = await execute({
			prompt: 'a cute cat',
			size: '1024x1024',
			mode: 'generate',
		}, {})

		expect(result.success).toBe(true)
		expect(result.fileName).toMatch(/^generated_\d+\.png$/)
		expect(result.filePath).toBe(join(TEMP_WORKSPACE, result.fileName))
		expect(result.modelUsed).toBe('test-openai/dall-e-3')

		// Verify file was written
		expect(existsSync(result.filePath)).toBe(true)
		const savedBytes = readFileSync(result.filePath)
		expect(savedBytes[0]).toBe(0x89)
		expect(savedBytes[1]).toBe(0x50)

		// Verify file event emitted correctly
		const fileEvent = events.find(e => e.type === 'file')
		expect(fileEvent).toBeDefined()
		expect(fileEvent.name).toBe(result.fileName)
		expect(Buffer.isBuffer(fileEvent.buffer)).toBe(true)
		expect(fileEvent.mimeType).toBe('image/png')
	})

	test('saves image to fallback folder (~/.tamias/generated-images) if workspacePath is missing', async () => {
		const session = {
			id: 'sess123',
			emitter: new EventEmitter(),
		}

		const mockAiService = {
			getSession: () => session
		} as unknown as AIService

		// Omit workspacePath
		const tools = createImageTools(mockAiService, 'sess123')
		const execute = (tools.generate as any).execute

		const result = await execute({
			prompt: 'a cute cat in fallback folder',
			size: '1024x1024',
			mode: 'generate',
		}, {})

		expect(result.success).toBe(true)
		expect(result.filePath).toBe(join(TEMP_FALLBACK, result.fileName))
		expect(existsSync(result.filePath)).toBe(true)
	})
})
