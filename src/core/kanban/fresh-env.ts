import { spawnSync } from 'node:child_process'

let cachedEnv: Record<string, string | undefined> | null = null
let cachedAt = 0
const ENV_CACHE_TTL = 5000

/**
 * Returns a fresh env for spawning CLI subprocesses.
 * On macOS, attempts to read Claude's OAuth token from Keychain.
 * Results are cached for 5s.
 */
export function getFreshEnv(): Record<string, string | undefined> {
	if (cachedEnv && Date.now() - cachedAt < ENV_CACHE_TTL) return cachedEnv

	let result: Record<string, string | undefined> | null = null

	// macOS Keychain
	if (!result && process.platform === 'darwin') {
		try {
			const kcResult = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 3000, encoding: 'utf-8' })
			if (kcResult.status === 0 && kcResult.stdout) {
				const creds = JSON.parse(kcResult.stdout.trim())
				const oauth = creds?.claudeAiOauth
				if (oauth?.accessToken && Date.now() < (oauth.expiresAt ?? 0) - 60_000) {
					result = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: oauth.accessToken }
				}
			}
		} catch { /* fall through */ }
	}

	if (!result) result = { ...process.env }

	cachedEnv = result
	cachedAt = Date.now()
	return result
}
