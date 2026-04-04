/**
 * Process manager for long-running CLI processes (coding CLIs).
 *
 * Provides lifecycle management, configurable timeouts, streaming output,
 * and rate-limit detection — designed for coding tools that may run
 * for minutes (Claude Code, Aider, etc.).
 */

import type { Subprocess } from 'bun'

export interface ProcessOptions {
	/** CLI command (first token), e.g. "claude" */
	command: string
	/** Arguments array, e.g. ["-p", "--model", "sonnet", ...] */
	args: string[]
	/** Working directory for the process */
	cwd: string
	/** Maximum runtime in seconds (default 300 = 5 min) */
	timeout?: number
	/** Called with chunks of stdout as they arrive */
	onStdout?: (chunk: string) => void
	/** Called with chunks of stderr as they arrive */
	onStderr?: (chunk: string) => void
}

export interface ProcessResult {
	/** Whether the process exited successfully (code 0) */
	success: boolean
	/** Full captured stdout */
	stdout: string
	/** Full captured stderr */
	stderr: string
	/** Process exit code (null if killed by timeout) */
	exitCode: number | null
	/** Whether the process was killed due to timeout */
	timedOut: boolean
	/** Whether rate-limit patterns were detected in output */
	rateLimited: boolean
	/** Runtime in milliseconds */
	durationMs: number
}

/** Patterns in stderr/stdout that indicate rate limiting */
const RATE_LIMIT_PATTERNS = [
	/rate.?limit/i,
	/too many requests/i,
	/overloaded/i,
	/429/,
	/quota.?exceeded/i,
	/capacity/i,
	/throttl/i,
]

/** Detect rate-limit patterns in combined output */
export function detectRateLimit(text: string): boolean {
	return RATE_LIMIT_PATTERNS.some(p => p.test(text))
}

/** Map of active processes by a caller-provided ID */
const activeProcesses = new Map<string, Subprocess>()

/**
 * Spawn a long-running CLI process with streaming output and timeout.
 *
 * @param id       Unique ID for tracking (e.g. session ID + provider name)
 * @param options  Process configuration
 * @returns        Structured result after completion or timeout
 */
export async function spawnProcess(id: string, options: ProcessOptions): Promise<ProcessResult> {
	const { command, args, cwd, timeout = 300, onStdout, onStderr } = options
	const timeoutMs = timeout * 1000
	const startTime = Date.now()

	const proc = Bun.spawn([command, ...args], {
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env },
	})

	activeProcesses.set(id, proc)

	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		proc.kill()
	}, timeoutMs)

	const stdoutChunks: string[] = []
	const stderrChunks: string[] = []

	// Stream stdout
	const readStdout = (async () => {
		const reader = proc.stdout.getReader()
		const decoder = new TextDecoder()
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const text = decoder.decode(value, { stream: true })
				stdoutChunks.push(text)
				onStdout?.(text)
			}
		} catch {
			// Process may have been killed
		}
	})()

	// Stream stderr
	const readStderr = (async () => {
		const reader = proc.stderr.getReader()
		const decoder = new TextDecoder()
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const text = decoder.decode(value, { stream: true })
				stderrChunks.push(text)
				onStderr?.(text)
			}
		} catch {
			// Process may have been killed
		}
	})()

	// Wait for both streams + process exit
	await Promise.all([readStdout, readStderr])
	const exitCode = await proc.exited

	clearTimeout(timer)
	activeProcesses.delete(id)

	const stdout = stdoutChunks.join('')
	const stderr = stderrChunks.join('')
	const combinedOutput = stdout + stderr
	const rateLimited = detectRateLimit(combinedOutput)
	const durationMs = Date.now() - startTime

	return {
		success: !timedOut && exitCode === 0,
		stdout,
		stderr,
		exitCode: timedOut ? null : exitCode,
		timedOut,
		rateLimited,
		durationMs,
	}
}

/**
 * Kill an active process by its tracking ID.
 * @returns true if a process was found and killed
 */
export function killProcess(id: string): boolean {
	const proc = activeProcesses.get(id)
	if (!proc) return false
	proc.kill()
	activeProcesses.delete(id)
	return true
}

/**
 * List IDs of all currently active processes.
 */
export function getActiveProcessIds(): string[] {
	return [...activeProcesses.keys()]
}
