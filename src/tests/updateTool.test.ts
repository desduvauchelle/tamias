// src/tests/updateTool.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ── Mocks registered BEFORE any imports that resolve update.ts ────────────────
// tamias.ts uses `await import('../utils/update.ts')` inside execute(), so
// mock.module intercepts those dynamic imports.

let mockCheckForUpdateResult: any = {
	currentVersion: '26.03.16.4',
	latestVersion: '26.04.03.1',
	release: { body: '## Changelog\n- fix: cron jobs restored', tag_name: 'v26.04.03.1', assets: [] },
}

const checkForUpdateMock = mock(async () => mockCheckForUpdateResult)
const performUpdateAndRestartMock = mock(async () => {})

mock.module('../utils/update.ts', () => ({
	checkForUpdate: checkForUpdateMock,
	performUpdateAndRestart: performUpdateAndRestartMock,
}))

import { createTamiasTools } from '../tools/tamias.ts'
import type { AIService } from '../services/aiService.ts'

function makeMockAIService(channelId = 'discord:test-channel', channelUserId = 'user-1'): AIService {
	return {
		getSession: mock(() => ({ channelId, channelUserId })),
	} as unknown as AIService
}

beforeEach(() => {
	checkForUpdateMock.mockClear()
	performUpdateAndRestartMock.mockClear()
	mockCheckForUpdateResult = {
		currentVersion: '26.03.16.4',
		latestVersion: '26.04.03.1',
		release: { body: '## Changelog\n- fix: cron jobs restored', tag_name: 'v26.04.03.1', assets: [] },
	}
	checkForUpdateMock.mockImplementation(async () => mockCheckForUpdateResult)
})

type ToolResult = { success: boolean; message?: string; error?: string }

async function executeUpdateTool(tools: ReturnType<typeof createTamiasTools>, toolCallId: string): Promise<ToolResult> {
	const raw = await tools.update_tamias.execute!({}, { messages: [], toolCallId })
	return raw as ToolResult
}

describe('update_tamias tool', () => {
	test('returns version transition message when update is available', async () => {
		const tools = createTamiasTools(makeMockAIService(), 'sess-1')
		const result = await executeUpdateTool(tools, 't1')
		expect(result.success).toBe(true)
		expect(result.message).toContain('26.03.16.4')
		expect(result.message).toContain('26.04.03.1')
		expect(result.message).toContain('restarting in')
	})

	test('returns already-up-to-date when versions match', async () => {
		mockCheckForUpdateResult = {
			currentVersion: '26.04.03.1',
			latestVersion: '26.04.03.1',
			release: { body: '', tag_name: 'v26.04.03.1', assets: [] },
		}
		const tools = createTamiasTools(makeMockAIService(), 'sess-1')
		const result = await executeUpdateTool(tools, 't2')
		expect(result.success).toBe(true)
		expect(result.message).toContain('up to date')
	})

	test('returns error when checkForUpdate throws', async () => {
		checkForUpdateMock.mockImplementationOnce(async () => {
			throw new Error('GitHub API timeout')
		})
		const tools = createTamiasTools(makeMockAIService(), 'sess-1')
		const result = await executeUpdateTool(tools, 't3')
		expect(result.success).toBe(false)
		expect(result.error).toContain('GitHub API timeout')
	})
})
