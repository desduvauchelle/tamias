import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'

const LOG_PATH = join(homedir(), '.tamias', 'daemon.log')
const DEFAULT_LINES = 80

// Print the last N lines of a file
function tailLines(filePath: string, n: number): string[] {
	const text = readFileSync(filePath, 'utf8')
	const lines = text.split('\n')
	return lines.slice(-n - 1, -1) // -1 strips trailing empty line
}

export const runLogsCommand = async (opts: { lines?: string; follow?: boolean; clear?: boolean } = {}) => {
	const n = parseInt(opts.lines ?? String(DEFAULT_LINES), 10) || DEFAULT_LINES
	const follow = opts.follow ?? true // default: follow

	if (!existsSync(LOG_PATH)) {
		p.cancel(pc.yellow(`No daemon log found at ${LOG_PATH} — start the daemon first with \`tamias start\``))
		process.exit(1)
	}

	if (opts.clear) {
		await Bun.write(LOG_PATH, '')
		console.log(pc.green(`✅ Cleared ${LOG_PATH}`))
		process.exit(0)
	}

	// Print the existing tail
	const existing = tailLines(LOG_PATH, n)
	console.log(pc.dim(`─── ${LOG_PATH} (last ${existing.length} lines) ────────────────────────────`))
	for (const line of existing) {
		console.log(colorLine(line))
	}

	if (!follow) {
		process.exit(0)
	}

	console.log(pc.dim(`─── following (Ctrl+C to stop) ──────────────────────────────────────────`))

	// Follow mode: watch the file for new bytes
	let offset = existsSync(LOG_PATH) ? Bun.file(LOG_PATH).size : 0

	const interval = setInterval(async () => {
		if (!existsSync(LOG_PATH)) return
		const file = Bun.file(LOG_PATH)
		const size = file.size
		if (size > offset) {
			const slice = await file.slice(offset, size).text()
			offset = size
			// Print each new line
			const newLines = slice.split('\n')
			for (let i = 0; i < newLines.length - 1; i++) {
				console.log(colorLine(newLines[i]))
			}
		} else if (size < offset) {
			// File was truncated (e.g. `tamias logs --clear`)
			offset = 0
			console.log(pc.dim('─── log file was cleared ───'))
		}
	}, 200)

	process.on('SIGINT', () => {
		clearInterval(interval)
		console.log('')
		process.exit(0)
	})
}

/** Add colour hints to common log patterns */
function colorLine(line: string): string {
	if (!line) return line
	if (line.includes('[DEBUG]')) return pc.dim(line)
	if (line.includes('[Daemon')) return pc.cyan(line)
	if (line.includes('error') || line.includes('Error') || line.includes('ERROR')) return pc.red(line)
	if (line.includes('warn') || line.includes('Warn') || line.includes('WARN')) return pc.yellow(line)
	if (line.includes('[AIService]') && line.includes('Attempting')) return pc.green(line)
	if (line.includes('[AIService]') && line.includes('Skipping')) return pc.yellow(line)
	if (line.includes('[Bridge]')) return pc.magenta(line)
	if (line.includes('[Cron]')) return pc.blue(line)
	return line
}
