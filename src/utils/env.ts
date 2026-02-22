import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { randomBytes } from 'crypto'
import { TAMIAS_DIR } from './config.ts'

const getEnvFilePath = () => join(TAMIAS_DIR, '.env')

/** Parse the .env file and return a record of key-value pairs */
export const readEnvFile = (): Record<string, string> => {
	const path = getEnvFilePath()
	if (!existsSync(path)) return {}

	const content = readFileSync(path, 'utf-8')
	const env: Record<string, string> = {}

	for (const line of content.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue

		const eqIdx = trimmed.indexOf('=')
		if (eqIdx !== -1) {
			const k = trimmed.slice(0, eqIdx).trim()
			let v = trimmed.slice(eqIdx + 1).trim()

			// Remove surrounding quotes if present
			if (v.startsWith('"') && v.endsWith('"')) {
				v = v.slice(1, -1)
			} else if (v.startsWith("'") && v.endsWith("'")) {
				v = v.slice(1, -1)
			}

			env[k] = v
		}
	}
	return env
}

/** Write the full key-value record to the .env file with 600 permissions */
const writeEnvFile = (env: Record<string, string>): void => {
	const path = getEnvFilePath()
	const lines = []
	for (const [k, v] of Object.entries(env)) {
		// Escape quotes and wrap in double quotes
		const safeVal = v.replace(/"/g, '\\"')
		lines.push(`${k}="${safeVal}"`)
	}

	writeFileSync(path, lines.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 })
	// Explicitly assure permissions in case writeFileSync honors existing loose permissions
	chmodSync(path, 0o600)
}

/** Get a specific key from the .env file */
export const getEnv = (key: string): string | undefined => {
	const env = readEnvFile()
	return env[key]
}

/** Set or update a specific key in the .env file */
export const setEnv = (key: string, value: string): void => {
	const env = readEnvFile()
	env[key] = value
	writeEnvFile(env)
}

/** Remove a specific key from the .env file */
export const removeEnv = (key: string): void => {
	const env = readEnvFile()
	if (key in env) {
		delete env[key]
		writeEnvFile(env)
	}
}

/** Generate a secure random string for a key name suffix */
export const generateSecureEnvKey = (prefix: string): string => {
	const safePrefix = prefix.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
	const randomPart = randomBytes(4).toString('hex').toUpperCase()
	return `TAMIAS_${safePrefix}_${randomPart}`
}
