import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync } from 'fs'

export const dynamic = 'force-dynamic'

// ── Inline usage summary (mirrors src/utils/usageRolling.ts shapes) ──────────

interface ModelDayStats {
	requests: number
	promptTokens: number
	completionTokens: number
	cost: number
}

interface DayStats {
	models: Record<string, ModelDayStats>
	channels: Record<string, { requests: number; cost: number }>
	tenants: Record<string, { requests: number; cost: number }>
	agents: Record<string, { requests: number; cost: number }>
	totalCost: number
	totalRequests: number
	totalPromptTokens: number
	totalCompletionTokens: number
}

interface RollingUsageData {
	days: Record<string, DayStats>
	updatedAt: string
}

function emptyResponse() {
	return {
		today: 0, yesterday: 0, thisWeek: 0, thisMonth: 0, total: 0,
		totalPromptTokens: 0, totalCompletionTokens: 0, totalRequests: 0,
		dailySpend: [] as { date: string; cost: number }[],
		modelDistribution: [] as { name: string; value: number }[],
		initiatorDistribution: [] as { name: string; value: number }[],
		tenantDistribution: [] as { name: string; value: number }[],
		agentDistribution: [] as { name: string; value: number }[],
		channelDistribution: [] as { name: string; value: number }[],
	}
}

function buildUsageSummaryFromFile(): ReturnType<typeof emptyResponse> {
	const usageFile = join(homedir(), '.tamias', 'usage.json')
	if (!existsSync(usageFile)) return emptyResponse()

	let data: RollingUsageData
	try {
		data = JSON.parse(readFileSync(usageFile, 'utf-8'))
		if (!data?.days || typeof data.days !== 'object') return emptyResponse()
	} catch {
		return emptyResponse()
	}

	const now = new Date()
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const todayStr = startOfToday.toISOString().split('T')[0]
	const yesterdayStr = new Date(startOfToday.getTime() - 86400000).toISOString().split('T')[0]

	const dayOfWeek = now.getDay()
	const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
	const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diffToMonday)
	const weekStr = startOfWeek.toISOString().split('T')[0]
	const monthStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

	let today = 0, yesterday = 0, thisWeek = 0, thisMonth = 0, total = 0
	let totalPromptTokens = 0, totalCompletionTokens = 0, totalRequests = 0
	const modelMap: Record<string, number> = {}
	const channelMap: Record<string, number> = {}
	const tenantMap: Record<string, number> = {}
	const agentMap: Record<string, number> = {}

	const dailyMap: Record<string, number> = {}
	for (let i = 0; i < 14; i++) {
		dailyMap[new Date(startOfToday.getTime() - i * 86400000).toISOString().split('T')[0]] = 0
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
		if (dailyMap[dateKey] !== undefined) dailyMap[dateKey] += day.totalCost
		for (const [m, s] of Object.entries(day.models)) modelMap[m] = (modelMap[m] || 0) + s.cost
		for (const [c, s] of Object.entries(day.channels)) channelMap[c] = (channelMap[c] || 0) + s.cost
		for (const [t, s] of Object.entries(day.tenants)) tenantMap[t] = (tenantMap[t] || 0) + s.cost
		for (const [a, s] of Object.entries(day.agents)) agentMap[a] = (agentMap[a] || 0) + s.cost
	}

	const sortDesc = (m: Record<string, number>) =>
		Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

	return {
		today, yesterday, thisWeek, thisMonth, total,
		totalPromptTokens, totalCompletionTokens, totalRequests,
		dailySpend: Object.entries(dailyMap).map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date)),
		modelDistribution: sortDesc(modelMap),
		initiatorDistribution: sortDesc(channelMap),
		tenantDistribution: sortDesc(tenantMap),
		agentDistribution: sortDesc(agentMap),
		channelDistribution: sortDesc(channelMap),
	}
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
	try {
		// Try to proxy through the running daemon first (it computes the summary)
		const daemonFile = join(homedir(), '.tamias', 'daemon.json')
		if (existsSync(daemonFile)) {
			const info = JSON.parse(readFileSync(daemonFile, 'utf-8'))
			const port = info.port || 9001
			const res = await fetch(`http://127.0.0.1:${port}/usage`, { cache: 'no-store' })
			if (res.ok) {
				const data = await res.json()
				return NextResponse.json(data)
			}
		}

		// Fallback: read usage.json directly (works even if daemon is down)
		return NextResponse.json(buildUsageSummaryFromFile())
	} catch (error) {
		console.error('API /usage error:', error)
		return NextResponse.json(emptyResponse())
	}
}
