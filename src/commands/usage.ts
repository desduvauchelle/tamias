import * as p from '@clack/prompts'
import pc from 'picocolors'
import { formatCurrency } from '../utils/pricing.ts'
import { buildUsageSummary } from '../utils/usageRolling.ts'

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'all'

export const runUsageCommand = async (periodStr: string = 'all') => {
	const period = periodStr.toLowerCase() as Period
	if (!['today', 'yesterday', 'week', 'month', 'all'].includes(period)) {
		p.cancel(`Invalid period: ${period}. Allowed: today, yesterday, week, month, all.`)
		process.exit(1)
	}

	p.intro(pc.bgMagenta(pc.white(` Tamias — AI Usage (${period}) `)))

	const summary = buildUsageSummary()

	if (summary.totalRequests === 0) {
		p.note('No AI requests logged yet.', 'Stats')
		p.outro('Start a chat to generate some logs!')
		return
	}

	// Select appropriate cost for the requested period
	let periodCost = summary.total
	let periodLabel = 'All Time (30 days)'

	if (period === 'today') {
		periodCost = summary.today
		periodLabel = 'Today'
	} else if (period === 'yesterday') {
		periodCost = summary.yesterday
		periodLabel = 'Yesterday'
	} else if (period === 'week') {
		periodCost = summary.thisWeek
		periodLabel = 'This Week'
	} else if (period === 'month') {
		periodCost = summary.thisMonth
		periodLabel = 'This Month'
	}

	// 1. General Stats
	p.note([
		`Total Requests:    ${pc.cyan(String(summary.totalRequests))}`,
		`Tokens In/Out:     ${pc.dim(summary.totalPromptTokens.toLocaleString())} / ${pc.dim(summary.totalCompletionTokens.toLocaleString())}`,
		`Period Cost:       ${pc.green(formatCurrency(periodCost))}`,
		`Total Cost (30d):  ${pc.green(formatCurrency(summary.total))}`,
	].join('\n'), `${periodLabel} Overview`)

	// 2. Models by cost
	if (summary.modelDistribution.length > 0) {
		const modelLines = summary.modelDistribution.map(m => {
			const name = m.name.split('/').pop() || m.name
			return `  ${pc.bold(name.padEnd(25))}  ${pc.green(formatCurrency(m.value).padStart(10))}`
		}).join('\n')
		p.note(modelLines, 'Models by Cost')
	}

	// 3. Channels
	if (summary.channelDistribution.length > 0) {
		const channelLines = summary.channelDistribution.map(c => {
			return `  ${pc.cyan(c.name.padEnd(20))}  ${pc.green(formatCurrency(c.value).padStart(10))}`
		}).join('\n')
		p.note(channelLines, 'Channels by Cost')
	}

	// 4. Daily spend (last 14 days)
	if (summary.dailySpend.length > 0) {
		const maxCost = Math.max(...summary.dailySpend.map(d => d.cost), 0.001)
		const barWidth = 30
		const dailyLines = summary.dailySpend.map(d => {
			const barLen = Math.round((d.cost / maxCost) * barWidth)
			const bar = '█'.repeat(barLen) + '░'.repeat(barWidth - barLen)
			return `  ${pc.dim(d.date)}  ${bar}  ${pc.green(formatCurrency(d.cost))}`
		}).join('\n')
		p.note(dailyLines, 'Daily Spend (14 days)')
	}

	p.outro(pc.dim('Run `tamias usage [today|yesterday|week|month|all]` for different periods.'))
}
