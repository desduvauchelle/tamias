import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync } from 'fs'

export const dynamic = 'force-dynamic'

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
		const usageFile = join(homedir(), '.tamias', 'usage.json')
		if (existsSync(usageFile)) {
			const { buildUsageSummary } = await import('../../../../../utils/usageRolling')
			return NextResponse.json(buildUsageSummary())
		}

		throw new Error('No usage data available')
	} catch (error) {
		console.error('API /usage error:', error)
		return NextResponse.json({
			today: 0,
			yesterday: 0,
			thisWeek: 0,
			thisMonth: 0,
			total: 0,
			dailySpend: [],
			modelDistribution: [],
			initiatorDistribution: []
		})
	}
}
