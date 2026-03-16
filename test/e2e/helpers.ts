/**
 * Shared helpers, mock data factories, and utilities for E2E tests.
 *
 * All spec files should import from here instead of duplicating setup logic.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { Page, Route } from '@playwright/test'

// ─── Paths ────────────────────────────────────────────────────────────────────
export const TAMIAS_E2E_DIR = '/tmp/tamias-e2e'
export const IDENTITY_PATH = join(TAMIAS_E2E_DIR, 'memory', 'IDENTITY.md')

// ─── Onboarding ───────────────────────────────────────────────────────────────

/** Ensure IDENTITY.md exists so the middleware won't redirect to /onboarding. */
export function ensureOnboarded() {
	mkdirSync(join(TAMIAS_E2E_DIR, 'memory'), { recursive: true })
	if (!existsSync(IDENTITY_PATH)) {
		writeFileSync(IDENTITY_PATH, '# Test Identity\n')
	}
}

/** Remove IDENTITY.md created during test. */
export function cleanupIdentity() {
	if (existsSync(IDENTITY_PATH)) rmSync(IDENTITY_PATH)
}

// ─── Common API mocks ─────────────────────────────────────────────────────────

/**
 * Mock all APIs that the Nav / LayoutClient fetch on every page load.
 * Call this before `page.goto()` so the nav sidebar doesn't hang.
 */
export async function mockNavAPIs(
	page: Page,
	overrides?: {
		projects?: unknown[]
		sessions?: unknown[]
		status?: Record<string, unknown>
	},
) {
	await page.route('/api/status', route =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(overrides?.status ?? { running: true, pid: 12345, uptimeSec: 300, tamiasVersion: '1.0.0', dashboardVersion: '1.0.0' }),
		}),
	)
	await page.route('/api/projects', route => {
		if (route.request().method() === 'GET') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(overrides?.projects ?? []),
			})
		}
		return route.continue()
	})
	// Mock sessions for the chat sidebar (only matched on exact /api/sessions)
	await page.route('/api/sessions', route => {
		if (route.request().url().endsWith('/api/sessions')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ sessions: overrides?.sessions ?? [] }),
			})
		}
		return route.continue()
	})
	// Mock discord channels (project creation modal)
	await page.route('/api/discord/channels', route =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [] }) }),
	)
}

// ─── Request capture ──────────────────────────────────────────────────────────

/**
 * Intercept the next request matching `method` + `urlPattern` and capture its body.
 * Returns a Promise that resolves to the parsed JSON body.
 *
 * Usage:
 * ```ts
 * const body = interceptAndCapture(page, 'POST', '/api/agents')
 * // trigger the action
 * const captured = await body
 * ```
 */
export function interceptAndCapture(
	page: Page,
	method: string,
	urlPattern: string,
	responseFn?: (body: unknown) => unknown,
): Promise<unknown> {
	return new Promise(resolve => {
		page.route(urlPattern, async (route: Route) => {
			if (route.request().method() === method) {
				const body = route.request().postDataJSON()
				resolve(body)
				const responseBody = responseFn ? responseFn(body) : body
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(responseBody),
				})
			} else {
				await route.continue()
			}
		})
	})
}

// ─── Mock data factories ──────────────────────────────────────────────────────

export function createMockAgent(overrides: Partial<{
	id: string
	slug: string
	name: string
	model: string
	modelFallbacks: string[]
	instructions: string
	enabled: boolean
}> = {}) {
	return {
		id: overrides.id ?? 'agent-1',
		slug: overrides.slug ?? 'test-agent',
		name: overrides.name ?? 'Test Agent',
		model: overrides.model ?? 'gpt-4o',
		modelFallbacks: overrides.modelFallbacks ?? [],
		instructions: overrides.instructions ?? 'You are a test agent.',
		enabled: overrides.enabled ?? true,
	}
}

export function createMockSkill(overrides: Partial<{
	name: string
	description: string
	content: string
	isBuiltIn: boolean
	folder: string
	filePath: string
	tags: string[]
	parent: string
}> = {}) {
	return {
		name: overrides.name ?? 'test-skill',
		description: overrides.description ?? 'A test skill',
		content: overrides.content ?? '# Test Skill\nDo the thing.',
		isBuiltIn: overrides.isBuiltIn ?? false,
		folder: overrides.folder ?? 'test-skill',
		filePath: overrides.filePath ?? '~/.tamias/skills/test-skill/SKILL.md',
		tags: overrides.tags ?? ['test'],
		parent: overrides.parent,
	}
}

export function createMockCronJob(overrides: Partial<{
	id: string
	name: string
	schedule: string
	type: 'ai' | 'message'
	prompt: string
	target: string
	enabled: boolean
	lastRun: string
	lastStatus: 'success' | 'error'
	createdAt: string
}> = {}) {
	return {
		id: overrides.id ?? 'cron-1',
		name: overrides.name ?? 'Test Cron',
		schedule: overrides.schedule ?? '1h',
		type: overrides.type ?? 'ai',
		prompt: overrides.prompt ?? 'Check pending tasks.',
		target: overrides.target ?? 'last',
		enabled: overrides.enabled ?? true,
		lastRun: overrides.lastRun,
		lastStatus: overrides.lastStatus,
		createdAt: overrides.createdAt ?? new Date().toISOString(),
	}
}

export function createMockChannelConfig(): {
	bridges: {
		terminal: { enabled: boolean }
		discords: Record<string, unknown>
		telegrams: Record<string, unknown>
		whatsappUnofficials: Record<string, unknown>
	}
} {
	return {
		bridges: {
			terminal: { enabled: true },
			discords: {
				default: {
					enabled: true,
					botToken: 'MTI...fake',
					allowedChannels: ['123456789'],
					mode: 'full',
				},
			},
			telegrams: {},
			whatsappUnofficials: {},
		},
	}
}

export function createMockModelsConfig() {
	return {
		connections: [
			{
				nickname: 'openai-main',
				provider: 'openai',
				apiKey: '[REDACTED]',
				selectedModels: ['gpt-4o', 'gpt-4o-mini'],
			},
			{
				nickname: 'anthropic-main',
				provider: 'anthropic',
				apiKey: '[REDACTED]',
				selectedModels: ['claude-sonnet-4'],
			},
		],
		defaultModels: ['openai-main/gpt-4o', 'anthropic-main/claude-sonnet-4'],
		smartModels: ['openai-main/gpt-4o'],
		defaultConnection: 'openai-main',
	}
}

export function createMockToolsConfig() {
	return {
		internalTools: {
			shell: { enabled: true, functions: { executeCommand: { enabled: true } } },
			browser: { enabled: true },
			gemini: { enabled: false },
			image: { enabled: true },
		},
		availableInternalTools: {
			shell: 'Shell Commands',
			browser: 'Web Browser',
			gemini: 'Gemini CLI',
			image: 'Image Generation',
		},
		availableFunctions: {
			shell: ['executeCommand'],
			browser: ['browse', 'screenshot'],
			gemini: ['runGemini'],
			image: ['generateImage'],
		},
		defaultImageModels: ['openai/dall-e-3'],
		emails: {},
		mcpServers: {},
	}
}

export function createMockUsageData() {
	return {
		today: 1.23,
		yesterday: 0.98,
		thisWeek: 5.67,
		thisMonth: 18.42,
		total: 42.00,
		dailySpend: [
			{ date: '2026-03-10', cost: 0.50 },
			{ date: '2026-03-11', cost: 0.75 },
			{ date: '2026-03-12', cost: 1.20 },
			{ date: '2026-03-13', cost: 0.40 },
			{ date: '2026-03-14', cost: 0.98 },
			{ date: '2026-03-15', cost: 1.23 },
		],
		modelDistribution: [
			{ name: 'gpt-4o', value: 25.0 },
			{ name: 'claude-sonnet-4', value: 12.0 },
			{ name: 'gpt-4o-mini', value: 5.0 },
		],
		initiatorDistribution: [
			{ name: 'terminal', value: 20.0 },
			{ name: 'discord', value: 15.0 },
			{ name: 'telegram', value: 7.0 },
		],
	}
}

export function createMockHistoryLogs() {
	return {
		logs: [
			{
				id: 1,
				timestamp: '2026-03-16T10:00:00Z',
				sessionId: 'session-abc',
				model: 'gpt-4o',
				provider: 'openai',
				action: 'chat',
				durationMs: 1200,
				tokens: { prompt: 150, completion: 80, total: 230 },
				prompt: 'What is the weather today?',
				response: 'I cannot check the weather in real-time.',
				estimatedCostUsd: 0.0023,
				fullHistory: [],
			},
			{
				id: 2,
				timestamp: '2026-03-16T09:30:00Z',
				sessionId: 'session-def',
				model: 'claude-sonnet-4',
				provider: 'anthropic',
				action: 'chat',
				durationMs: 2500,
				tokens: { prompt: 300, completion: 200, total: 500 },
				prompt: 'Explain quantum computing',
				response: 'Quantum computing uses qubits...',
				toolCalls: [{ toolName: 'web_search', args: { query: 'quantum computing basics' } }],
				toolResults: [{ toolName: 'web_search', result: 'Found 10 results' }],
				estimatedCostUsd: 0.0075,
				fullHistory: [],
			},
		],
	}
}

export function createMockProject(overrides: Partial<{
	id: string
	name: string
	path: string
	description: string
	kanban: unknown[]
}> = {}) {
	return {
		id: overrides.id ?? 'proj-1',
		name: overrides.name ?? 'Test Project',
		path: overrides.path ?? '~/.tamias/workspace/test-project',
		description: overrides.description ?? 'A test project description',
		kanban: overrides.kanban ?? [
			{ id: 'task-1', title: 'Existing Task', status: 'todo', createdAt: Date.now() - 1000 },
		],
	}
}
