/**
 * Heuristic complexity estimator for coding tasks.
 *
 * Scores a task description on a 0–100+ scale. Higher = more complex.
 * Used to decide whether to invoke the "smart" or "normal" model tier
 * on a coding CLI provider.
 */

interface ComplexitySignal {
	/** Regex or string patterns to match in the task description */
	patterns: RegExp[]
	/** Score awarded when *any* pattern matches (not additive per pattern) */
	score: number
	/** Human-readable reason (for debugging / logging) */
	label: string
}

const SIGNALS: ComplexitySignal[] = [
	// ── High complexity indicators ──────────────────────────────────────
	{
		patterns: [/\brefactor\b/i, /\bredesign\b/i, /\bmigrat(e|ion)\b/i, /\brewrite\b/i, /\boverhaul\b/i],
		score: 25,
		label: 'refactor/redesign/migrate',
	},
	{
		patterns: [/\barchitecture\b/i, /\bdesign pattern\b/i, /\bsystem design\b/i],
		score: 25,
		label: 'architecture/patterns',
	},
	{
		patterns: [/\bnew feature\b/i, /\bimplement\b/i, /\bbuild\b/i, /\bcreate\b/i],
		score: 20,
		label: 'new feature/implement',
	},
	{
		patterns: [/\bfull coverage\b/i, /\badd tests?\b/i, /\btest suite\b/i, /\bwrite tests?\b/i],
		score: 20,
		label: 'testing scope',
	},
	{
		patterns: [/\bmultiple files?\b/i, /\bacross.*(files?|modules?|components?)\b/i, /\bseveral\b/i],
		score: 30,
		label: 'multi-file scope',
	},
	{
		patterns: [/\bperformance\b/i, /\boptimiz(e|ation)\b/i, /\bscalability\b/i],
		score: 15,
		label: 'performance/optimization',
	},
	{
		patterns: [/\bsecurity\b/i, /\bauth(entication|orization)\b/i, /\bencrypt\b/i],
		score: 15,
		label: 'security concerns',
	},
	{
		patterns: [/\bdatabase\b/i, /\bschema\b/i, /\bmigration\b/i, /\bSQL\b/],
		score: 15,
		label: 'database work',
	},

	// ── Low complexity indicators ───────────────────────────────────────
	{
		patterns: [/\bfix\b/i, /\bbug\b/i, /\bpatch\b/i],
		score: 10,
		label: 'bug fix',
	},
	{
		patterns: [/\btypo\b/i, /\brename\b/i, /\bupdate (readme|docs|comment)\b/i],
		score: 5,
		label: 'trivial change',
	},
	{
		patterns: [/\bsingle file\b/i, /\bone file\b/i],
		score: 10,
		label: 'single-file scope',
	},
]

export interface ComplexityResult {
	/** Numeric complexity score (0+) */
	score: number
	/** Which tier the score maps to given the threshold */
	tier: 'smart' | 'normal'
	/** Matched signal labels for transparency */
	matchedSignals: string[]
}

/**
 * Estimate the complexity of a coding task from its text description.
 *
 * @param taskDescription  Free-text description of the task
 * @param threshold        Score boundary: > threshold → 'smart', else 'normal' (default 50)
 * @returns                Complexity result with score, tier, and matched signals
 */
export function estimateComplexity(taskDescription: string, threshold = 50): ComplexityResult {
	if (!taskDescription || typeof taskDescription !== 'string') {
		return { score: 0, tier: 'normal', matchedSignals: [] }
	}

	let score = 0
	const matchedSignals: string[] = []

	for (const signal of SIGNALS) {
		const matched = signal.patterns.some(p => p.test(taskDescription))
		if (matched) {
			score += signal.score
			matchedSignals.push(signal.label)
		}
	}

	// Bonus: very long task descriptions tend to be more complex
	const wordCount = taskDescription.trim().split(/\s+/).length
	if (wordCount > 100) {
		score += 10
		matchedSignals.push('long description (>100 words)')
	}

	const tier = score > threshold ? 'smart' : 'normal'

	return { score, tier, matchedSignals }
}
