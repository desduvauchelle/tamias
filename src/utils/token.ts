import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'

const TOKEN_FILE = join(homedir(), '.tamias', 'dashboard.token')

/**
 * Returns the persistent dashboard token, creating one if it doesn't exist.
 * Pass `reset: true` to force-generate a new token.
 */
export async function getOrCreateDashboardToken(reset = false): Promise<string> {
	if (!reset && existsSync(TOKEN_FILE)) {
		const existing = readFileSync(TOKEN_FILE, 'utf-8').trim()
		if (existing) return existing
	}
	const { randomBytes } = await import('crypto')
	const token = randomBytes(24).toString('hex')
	writeFileSync(TOKEN_FILE, token, 'utf-8')
	return token
}

export function readDashboardToken(): string | null {
	if (!existsSync(TOKEN_FILE)) return null
	const val = readFileSync(TOKEN_FILE, 'utf-8').trim()
	return val || null
}
