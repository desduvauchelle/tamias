import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
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

function splitLogLines(raw: string): string[] {
	const lines = raw.split('\n')
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop()
	}
	return lines
}

function buildPageFileRegex(name: string): RegExp {
	if (name.endsWith('.log')) {
		const stem = name.slice(0, -4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		return new RegExp(`^${stem}\\.page-(\\d{4})\\.log$`)
	}
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(`^${escaped}\\.page-(\\d{4})$`)
}

function buildPageFileName(name: string, page: number): string {
	const pageLabel = String(page).padStart(4, '0')
	if (name.endsWith('.log')) {
		const stem = name.slice(0, -4)
		return `${stem}.page-${pageLabel}.log`
	}
	return `${name}.page-${pageLabel}`
}

export interface PaginateLogResult {
	activeLines: number
	overflowLines: number
	pagesCreated: number
}

export function paginateLogByLines(name: string, maxLines: number): PaginateLogResult {
	if (!Number.isInteger(maxLines) || maxLines < 1) {
		throw new Error(`maxLines must be a positive integer, received: ${maxLines}`)
	}

	const logPath = getLogFilePath(name)
	if (!existsSync(logPath)) {
		return { activeLines: 0, overflowLines: 0, pagesCreated: 0 }
	}

	const allLines = splitLogLines(readFileSync(logPath, 'utf8'))
	if (allLines.length <= maxLines) {
		return { activeLines: allLines.length, overflowLines: 0, pagesCreated: 0 }
	}

	const overflowLines = allLines.slice(0, allLines.length - maxLines)
	const activeLines = allLines.slice(-maxLines)
	const pageChunks: string[][] = []
	for (let i = 0; i < overflowLines.length; i += maxLines) {
		pageChunks.push(overflowLines.slice(i, i + maxLines))
	}

	const pageRegex = buildPageFileRegex(name)
	const currentMaxPage = readdirSync(getLogsDirPath())
		.map(entry => {
			const match = pageRegex.exec(entry)
			return match ? Number.parseInt(match[1] ?? '0', 10) : 0
		})
		.reduce((max, value) => (value > max ? value : max), 0)

	pageChunks.forEach((chunk, index) => {
		const pageName = buildPageFileName(name, currentMaxPage + index + 1)
		const pagePath = join(getLogsDirPath(), pageName)
		writeFileSync(pagePath, `${chunk.join('\n')}\n`, 'utf8')
	})

	writeFileSync(logPath, `${activeLines.join('\n')}\n`, 'utf8')

	return {
		activeLines: activeLines.length,
		overflowLines: overflowLines.length,
		pagesCreated: pageChunks.length,
	}
}
