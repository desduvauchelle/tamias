import { existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { TAMIAS_DIR } from './config.ts'

function getTamiasRoot(): string {
	return process.env.TAMIAS_DIR ?? TAMIAS_DIR
}

export function getLogsDirPath(): string {
	return join(getTamiasRoot(), 'logs')
}

function ensureLogsDir() {
	const logsDir = getLogsDirPath()
	if (!existsSync(logsDir)) {
		mkdirSync(logsDir, { recursive: true })
	}
}

/**
 * Returns the canonical log file path under ~/.tamias/logs/<name> and migrates
 * a legacy ~/.tamias/<name> file into the new location if present.
 */
export function getLogFilePath(name: string): string {
	ensureLogsDir()
	const root = getTamiasRoot()
	const canonical = join(getLogsDirPath(), name)
	const legacy = join(root, name)

	if (existsSync(legacy) && !existsSync(canonical)) {
		try {
			renameSync(legacy, canonical)
		} catch {
			// Keep going with canonical path even if migration fails.
		}
	}

	return canonical
}
