export interface RateLimitInfo {
	isRateLimit: boolean
	isOverloaded: boolean
	resetMessage?: string
}

const RATE_LIMIT_PATTERNS = [/rate.limit/i, /429/, /too many requests/i, /quota.exceeded/i, /resource.exhausted/i, /overloaded/i, /capacity/i, /throttl/i, /usage.limit/i, /request limit/i, /token limit/i, /exceeded.*limit/i, /limit.*exceeded/i]
const OVERLOADED_PATTERNS = [/529/, /overloaded/i, /service.unavailable/i, /server.busy/i]
const RESET_PATTERNS: { pattern: RegExp; extract: (m: RegExpMatchArray) => string }[] = [
	{ pattern: /retry.after[:\s]+(\d+)\s*(seconds?|minutes?|hours?)/i, extract: (m) => `Retry after ${m[1]} ${m[2]}` },
	{ pattern: /try again in\s+(.+?)[.\n]/i, extract: (m) => `Try again in ${m[1]}` },
	{ pattern: /wait\s+(\d+)\s*(seconds?|minutes?|hours?)/i, extract: (m) => `Wait ${m[1]} ${m[2]}` },
]

export function detectRateLimit(stdout: string, stderr: string, exitCode: number): RateLimitInfo {
	if (exitCode === 0) return { isRateLimit: false, isOverloaded: false }
	const combined = `${stderr}\n${stdout}`
	const isOverloaded = OVERLOADED_PATTERNS.some(p => p.test(combined))
	const isRateLimit = isOverloaded || RATE_LIMIT_PATTERNS.some(p => p.test(combined))
	if (!isRateLimit) return { isRateLimit: false, isOverloaded: false }
	for (const { pattern, extract } of RESET_PATTERNS) {
		const match = combined.match(pattern)
		if (match) return { isRateLimit: true, isOverloaded, resetMessage: extract(match) }
	}
	return { isRateLimit: true, isOverloaded, resetMessage: isOverloaded ? 'Claude servers are overloaded.' : 'Check provider dashboard for reset time.' }
}
