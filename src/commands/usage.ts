import * as p from '@clack/prompts'
import pc from 'picocolors'
import { type AiLogPayload } from '../utils/logger.ts'
import { getEstimatedCost, formatCurrency } from '../utils/pricing.ts'
import { db } from '../utils/db.ts'

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'all'

export const runUsageCommand = async (periodStr: string = 'all') => {
	const period = periodStr.toLowerCase() as Period
	if (!['today', 'yesterday', 'week', 'month', 'all'].includes(period)) {
		p.cancel(`Invalid period: ${period}. Allowed: today, yesterday, week, month, all.`)
		process.exit(1)
	}

	p.intro(pc.bgMagenta(pc.white(` Tamias — AI Usage (${period}) `)))

	const rows = db.query<{ timestamp: string, sessionId: string, model: string, provider: string, action: string, durationMs: number, promptTokens: number | null, completionTokens: number | null, totalTokens: number | null, requestMessagesJson: string, response: string }, []>(`
		SELECT timestamp, sessionId, model, provider, action, durationMs,
			promptTokens, completionTokens, totalTokens, requestMessagesJson, response
		FROM ai_logs ORDER BY id DESC
	`).all()

	if (rows.length === 0) {
		p.note('No AI requests logged yet.', 'Stats')
		p.outro('Start a chat to generate some logs!')
		return
	}

	const logs: AiLogPayload[] = rows.map(r => ({
		timestamp: r.timestamp,
		sessionId: r.sessionId,
		model: r.model,
		provider: r.provider,
		action: r.action as 'chat' | 'compact',
		durationMs: r.durationMs,
		tokens: {
			prompt: r.promptTokens || 0,
			completion: r.completionTokens || 0,
			total: r.totalTokens || 0,
		},
		messages: JSON.parse(r.requestMessagesJson || '[]'),
		response: r.response
	}))

	// Sort logs by timestamp just to be sure, although ORDER BY id DESC does most of it (we need it descending)
	logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

	// Filter by period
	const now = new Date()
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const startOfYesterday = new Date(startOfToday.getTime() - 86400000)

	// Start of week (Monday)
	const day = now.getDay()
	const diff = now.getDate() - day + (day === 0 ? -6 : 1)
	const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff)
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

	let filteredLogs = logs
	let periodLabel = 'All Time'

	if (period === 'today') {
		filteredLogs = logs.filter(l => new Date(l.timestamp) >= startOfToday)
		periodLabel = 'Today'
	} else if (period === 'yesterday') {
		filteredLogs = logs.filter(l => {
			const d = new Date(l.timestamp)
			return d >= startOfYesterday && d < startOfToday
		})
		periodLabel = 'Yesterday'
	} else if (period === 'week') {
		filteredLogs = logs.filter(l => new Date(l.timestamp) >= startOfWeek)
		periodLabel = 'This Week'
	} else if (period === 'month') {
		filteredLogs = logs.filter(l => new Date(l.timestamp) >= startOfMonth)
		periodLabel = 'This Month'
	}

	if (filteredLogs.length === 0) {
		p.note(`No requests found for ${periodLabel}.`, 'Stats')
		p.outro('')
		return
	}

	// Aggregations
	let totalIn = 0
	let totalOut = 0
	let totalCost = 0
	let totalDuration = 0

	const modelsMap = new Map<string, { requests: number, in: number, out: number, cost: number }>()
	const sessionsMap = new Map<string, { requests: number, cost: number }>()

	for (const log of filteredLogs) {
		const tin = log.tokens?.prompt || 0
		const tout = log.tokens?.completion || 0
		const cost = getEstimatedCost(log.model, tin, tout)

		totalIn += tin
		totalOut += tout
		totalCost += cost
		totalDuration += log.durationMs || 0

		const modelKey = log.model || 'unknown'
		const modelData = modelsMap.get(modelKey) || { requests: 0, in: 0, out: 0, cost: 0 }
		modelData.requests += 1
		modelData.in += tin
		modelData.out += tout
		modelData.cost += cost
		modelsMap.set(modelKey, modelData)

		const sessKey = log.sessionId || 'unknown'
		const sessData = sessionsMap.get(sessKey) || { requests: 0, cost: 0 }
		sessData.requests += 1
		sessData.cost += cost
		sessionsMap.set(sessKey, sessData)
	}

	// 1. General Stats
	const avgLatency = Math.round(totalDuration / filteredLogs.length)
	p.note([
		`Total Requests:    ${pc.cyan(String(filteredLogs.length))}`,
		`Tokens In/Out:     ${pc.dim(totalIn.toLocaleString())} / ${pc.dim(totalOut.toLocaleString())}`,
		`Total Cost:        ${pc.green(formatCurrency(totalCost))}`,
		`Avg Latency:       ${pc.blue(avgLatency + ' ms')}`
	].join('\n'), `${periodLabel} Overview`)

	// 2. Models
	const sortedModels = [...modelsMap.entries()].sort((a, b) => b[1].cost - a[1].cost)
	const modelLines = sortedModels.map(([m, data]) => {
		const name = m.split('/').pop() || m
		return `  ${pc.bold(name.padEnd(20))} ${pc.dim(String(data.requests).padStart(4) + ' reqs')}  ${pc.dim(String(data.in + data.out).padStart(7) + ' tkns')}  ${pc.green(formatCurrency(data.cost).padStart(10))}`
	}).join('\n')
	p.note(modelLines, 'Models by Cost')

	// 3. Sessions
	const sortedSessions = [...sessionsMap.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
	const sessionLines = sortedSessions.map(([s, data]) => {
		return `  ${pc.cyan(s.padEnd(15))} ${pc.dim(String(data.requests).padStart(4) + ' requests')}  ${pc.green(formatCurrency(data.cost).padStart(10))}`
	}).join('\n')
	if (sessionLines) p.note(sessionLines, 'Most Expensive Sessions')

	// 4. Recent Requests (up to 20)
	const recent = filteredLogs.slice(0, 20)
	const recentLines = recent.map(r => {
		const time = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		const modelShort = r.model.split('/').pop()?.slice(0, 15) || 'unknown'
		const action = Object.hasOwnProperty.call(r, 'action') ? (r as any).action : 'chat'
		const actColor = action === 'compact' ? pc.magenta('compact') : pc.blue('chat   ')
		const tin = r.tokens?.prompt || 0
		const tout = r.tokens?.completion || 0
		const cost = getEstimatedCost(r.model, tin, tout)
		const costStr = cost > 0 ? pc.green(formatCurrency(cost).padStart(8)) : pc.dim('   $0.00 ')

		return `  ${pc.dim(time)}  ${actColor}  ${pc.white(modelShort.padEnd(15))}  ${pc.dim(r.sessionId.padEnd(12))}  ${pc.dim(String(tin + tout).padStart(5))} tkns  ${costStr}`
	}).join('\n')

	p.note(recentLines || 'No recent requests.', 'Recent Requests (Last 20)')

	p.outro(pc.dim('Run `tamias usage [today|yesterday|week|month|all]` for different periods.'))
}
