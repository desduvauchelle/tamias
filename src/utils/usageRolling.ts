import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

const TAMIAS_DIR = join(homedir(), '.tamias')
const USAGE_FILE = join(TAMIAS_DIR, 'usage.json')

/**
 * Rolling 30-day usage summary, keyed by date then model.
 * Incremented atomically on every AI request via `recordUsage()`.
 * Pruned to 30 days on every write.
 */
export interface ModelDayStats {
	requests: number
	promptTokens: number
	completionTokens: number
	cost: number
}

export interface DayStats {
	models: Record<string, ModelDayStats>
	channels: Record<string, { requests: number; cost: number }>
	tenants: Record<string, { requests: number; cost: number }>
	agents: Record<string, { requests: number; cost: number }>
	totalCost: number
	totalRequests: number
	totalPromptTokens: number
	totalCompletionTokens: number
}

export interface RollingUsageData {
	days: Record<string, DayStats>
	updatedAt: string
}

function localDateKey(date: Date): string {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function emptyDay(): DayStats {
	return {
		models: {},
		channels: {},
		tenants: {},
		agents: {},
		totalCost: 0,
		totalRequests: 0,
		totalPromptTokens: 0,
		totalCompletionTokens: 0,
	}
}

/**
 * Load the rolling usage file. Returns empty structure if missing or corrupt.
 */
export function loadRollingUsage(): RollingUsageData {
	if (!existsSync(USAGE_FILE)) {
		return { days: {}, updatedAt: new Date().toISOString() }
	}
	try {
		const raw = readFileSync(USAGE_FILE, 'utf-8')
		const data = JSON.parse(raw) as RollingUsageData
		if (!data.days || typeof data.days !== 'object') {
			return { days: {}, updatedAt: new Date().toISOString() }
		}
		return data
	} catch {
		console.error('[UsageRolling] Failed to parse usage.json, starting fresh.')
		return { days: {}, updatedAt: new Date().toISOString() }
	}
}

/**
 * Prune days older than 30 days from the data.
 */
function pruneDays(data: RollingUsageData): void {
	const cutoff = new Date()
	cutoff.setDate(cutoff.getDate() - 30)
	const cutoffStr = localDateKey(cutoff)

	for (const dateKey of Object.keys(data.days)) {
		if (dateKey < cutoffStr) {
			delete data.days[dateKey]
		}
	}
}

/**
 * Save the rolling usage data to disk.
 */
function saveRollingUsage(data: RollingUsageData): void {
	if (!existsSync(TAMIAS_DIR)) {
		mkdirSync(TAMIAS_DIR, { recursive: true })
	}
	data.updatedAt = new Date().toISOString()
	writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export interface UsageRecord {
	model: string
	promptTokens: number
	completionTokens: number
	estimatedCostUsd: number
	channelId?: string | null
	tenantId?: string | null
	agentId?: string | null
}

/**
 * Record a single AI request into the rolling usage file.
 * Called from logAiRequest() on every AI call.
 */
export function recordUsage(record: UsageRecord): void {
	try {
		const data = loadRollingUsage()
		const dateKey = localDateKey(new Date())

		if (!data.days[dateKey]) {
			data.days[dateKey] = emptyDay()
		}

		const day = data.days[dateKey]

		// Model stats
		if (!day.models[record.model]) {
			day.models[record.model] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 }
		}
		const modelStats = day.models[record.model]
		modelStats.requests += 1
		modelStats.promptTokens += record.promptTokens
		modelStats.completionTokens += record.completionTokens
		modelStats.cost += record.estimatedCostUsd

		// Channel stats
		const channelKey = record.channelId || 'terminal'
		if (!day.channels[channelKey]) {
			day.channels[channelKey] = { requests: 0, cost: 0 }
		}
		day.channels[channelKey].requests += 1
		day.channels[channelKey].cost += record.estimatedCostUsd

		// Tenant stats
		const tenantKey = record.tenantId || 'default'
		if (!day.tenants[tenantKey]) {
			day.tenants[tenantKey] = { requests: 0, cost: 0 }
		}
		day.tenants[tenantKey].requests += 1
		day.tenants[tenantKey].cost += record.estimatedCostUsd

		// Agent stats
		const agentKey = record.agentId || 'main'
		if (!day.agents[agentKey]) {
			day.agents[agentKey] = { requests: 0, cost: 0 }
		}
		day.agents[agentKey].requests += 1
		day.agents[agentKey].cost += record.estimatedCostUsd

		// Day totals
		day.totalCost += record.estimatedCostUsd
		day.totalRequests += 1
		day.totalPromptTokens += record.promptTokens
		day.totalCompletionTokens += record.completionTokens

		// Prune old days and save
		pruneDays(data)
		saveRollingUsage(data)
	} catch (err) {
		console.error('[UsageRolling] Failed to record usage:', err)
	}
}

/**
 * Build the usage summary response from the rolling JSON file.
 * Returns the shape expected by the dashboard and CLI.
 */
export function buildUsageSummary(): {
	today: number
	yesterday: number
	thisWeek: number
	thisMonth: number
	total: number
	totalPromptTokens: number
	totalCompletionTokens: number
	totalRequests: number
	dailySpend: { date: string; cost: number }[]
	modelDistribution: { name: string; value: number }[]
	initiatorDistribution: { name: string; value: number }[]
	tenantDistribution: { name: string; value: number }[]
	agentDistribution: { name: string; value: number }[]
	channelDistribution: { name: string; value: number }[]
} {
	const data = loadRollingUsage()

	const now = new Date()
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const todayStr = localDateKey(startOfToday)
	const yesterdayStr = localDateKey(new Date(startOfToday.getTime() - 86400000))

	// Start of week (Monday)
	const dayOfWeek = now.getDay()
	const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
	const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diffToMonday)
	const weekStr = localDateKey(startOfWeek)

	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
	const monthStr = localDateKey(startOfMonth)

	let today = 0, yesterday = 0, thisWeek = 0, thisMonth = 0, total = 0
	let totalPromptTokens = 0, totalCompletionTokens = 0, totalRequests = 0

	const modelMap: Record<string, number> = {}
	const channelMap: Record<string, number> = {}
	const tenantMap: Record<string, number> = {}
	const agentMap: Record<string, number> = {}

	// Build 14-day dailySpend array
	const dailyMap: Record<string, number> = {}
	for (let i = 0; i < 14; i++) {
		const d = new Date(startOfToday.getTime() - (i * 86400000))
		dailyMap[localDateKey(d)] = 0
	}

	for (const [dateKey, day] of Object.entries(data.days)) {
		total += day.totalCost
		totalPromptTokens += day.totalPromptTokens
		totalCompletionTokens += day.totalCompletionTokens
		totalRequests += day.totalRequests

		if (dateKey === todayStr) today += day.totalCost
		if (dateKey === yesterdayStr) yesterday += day.totalCost
		if (dateKey >= weekStr) thisWeek += day.totalCost
		if (dateKey >= monthStr) thisMonth += day.totalCost

		if (dailyMap[dateKey] !== undefined) {
			dailyMap[dateKey] += day.totalCost
		}

		// Aggregate model distribution
		for (const [model, stats] of Object.entries(day.models)) {
			modelMap[model] = (modelMap[model] || 0) + stats.cost
		}

		// Aggregate channel distribution
		for (const [channel, stats] of Object.entries(day.channels)) {
			channelMap[channel] = (channelMap[channel] || 0) + stats.cost
		}

		// Aggregate tenant distribution
		for (const [tenant, stats] of Object.entries(day.tenants)) {
			tenantMap[tenant] = (tenantMap[tenant] || 0) + stats.cost
		}

		// Aggregate agent distribution
		for (const [agent, stats] of Object.entries(day.agents)) {
			agentMap[agent] = (agentMap[agent] || 0) + stats.cost
		}
	}

	const dailySpend = Object.entries(dailyMap)
		.map(([date, cost]) => ({ date, cost }))
		.sort((a, b) => a.date.localeCompare(b.date))

	const sortDesc = (map: Record<string, number>) =>
		Object.entries(map)
			.map(([name, value]) => ({ name, value }))
			.sort((a, b) => b.value - a.value)

	return {
		today,
		yesterday,
		thisWeek,
		thisMonth,
		total,
		totalPromptTokens,
		totalCompletionTokens,
		totalRequests,
		dailySpend,
		modelDistribution: sortDesc(modelMap),
		initiatorDistribution: sortDesc(channelMap),
		tenantDistribution: sortDesc(tenantMap),
		agentDistribution: sortDesc(agentMap),
		channelDistribution: sortDesc(channelMap),
	}
}
