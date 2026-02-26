import { tool } from 'ai'
import { z } from 'zod'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, unlinkSync, cpSync, mkdirSync, readdirSync, statSync } from 'fs'
import { rename } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { validatePath, expandHome } from '../utils/path.ts'
import { TAMIAS_DIR, getSandboxConfig } from '../utils/config.ts'

/** Absolute path of the secrets file — never readable via run_command */
const TAMIAS_ENV_FILE = join(TAMIAS_DIR, '.env')
/** Normalised home dir for path checks (no trailing slash) */
const HOME = homedir()

/**
 * Scan a shell command string for references to paths that are either:
 *  - the secrets file (~/.tamias/.env)
 *  - outside ~/.tamias entirely
 *
 * This is a best-effort guard against the AI constructing commands like
 * `cat ~/.tamias/.env` or `cp /etc/passwd ...`. Full shell AST parsing is
 * not attempted; we check against known dangerous patterns.
 */
function auditCommand(command: string): void {
	const trimmed = command.trim()

	// 1. Block privilege escalation
	const privilegeEscalators = ['sudo ', 'su ', 'doas ', 'chmod +s', 'chown ', 'chgrp ']
	if (privilegeEscalators.some(p => trimmed.toLowerCase().includes(p))) {
		throw new Error(`Access denied: privilege escalation commands are strictly blocked.`)
	}

	// 2. Expand ~ for consistent checks
	const expanded = trimmed.replace(/~\//g, HOME + '/').replace(/^~$/, HOME)

	// 3. Block access to the .env secrets file
	const envVariants = [
		TAMIAS_ENV_FILE,
		'~/.tamias/.env',
		join(HOME, '.tamias/.env'),
	]
	for (const variant of envVariants) {
		if (expanded.includes(variant) || trimmed.includes(variant)) {
			throw new Error(`Access denied: commands that reference the secrets file '${TAMIAS_ENV_FILE}' are blocked.`)
		}
	}

	// 4. Block dangerous redirections/pipes to system paths
	//    Matches > /path, >> /path, | tee /path etc.
	const redirectionMatches = expanded.match(/(?:>|>>|\|\s*tee\s+(-a\s+)?)\s*(\/[^\s|&;]+|~[^\s|&;]*)/g) || []
	for (const match of redirectionMatches) {
		const pathPart = match.split(/\s+/).pop()?.replace(/^['"]|['"]$/g, '')
		if (pathPart) {
			const norm = pathPart.replace(/\/+$/, '')
			if (!norm.startsWith(TAMIAS_DIR) && norm !== HOME) {
				throw new Error(`Access denied: redirection to path '${norm}' outside the authorized workspace is blocked.`)
			}
		}
	}

	// 5. Block obvious attempts to read/write outside ~/.tamias using absolute paths as arguments.
	//    We look for path-like tokens that start with / or ~ and are NOT under ~/.tamias.
	//    Improved regex to catch paths in various contexts (quotes, spaces, starts of lines)
	const pathTokens = expanded.match(/(?<=^|\s|['"])(?:\/|~)[^\s'"]*/g) || []
	for (let token of pathTokens) {
		token = token.trim().replace(/^['"]|['"]$/g, '')
		if (!token.startsWith('/') && !token.startsWith(HOME)) continue

		// Normalise
		const norm = token.replace(/\/+$/, '')
		if (norm.startsWith(TAMIAS_DIR)) continue          // inside ~/.tamias — fine
		if (norm === HOME) continue                         // bare ~ — usually harmless (e.g. cd ~)

		// Common system paths that would clearly be an escape attempt
		const dangerPrefixes = ['/etc', '/root', '/private/etc', '/proc', '/sys', '/var', '/usr', '/bin', '/sbin', '/lib', '/opt']
		if (dangerPrefixes.some(p => norm.startsWith(p))) {
			throw new Error(`Access denied: command references a system path '${norm}' outside the authorized workspace '${TAMIAS_DIR}'.`)
		}

		// Any other absolute path outside ~/.tamias that isn't the home dir itself
		if (norm.startsWith(HOME) && norm !== HOME && !norm.startsWith(TAMIAS_DIR)) {
			throw new Error(`Access denied: command references '${norm}' which is outside the authorized workspace '${TAMIAS_DIR}'.`)
		}
	}
}

/** All tools exported from this file become the "terminal" internal tool */

/**
 * Build a sandboxed command string using docker/podman.
 * Mounts TAMIAS_DIR as /workspace inside the container.
 */
function buildSandboxedCommand(command: string, cwd: string): { cmd: string; args: string[] } {
	const sandbox = getSandboxConfig()
	const engine = sandbox.engine // 'docker' or 'podman'

	// Map the host cwd to a container-relative path
	const containerWorkspace = '/workspace'
	let containerCwd = containerWorkspace
	if (cwd.startsWith(TAMIAS_DIR)) {
		containerCwd = containerWorkspace + cwd.slice(TAMIAS_DIR.length)
	}

	const args = [
		'run', '--rm',
		'-v', `${TAMIAS_DIR}:${containerWorkspace}`,
		'-w', containerCwd,
		'--memory', sandbox.memoryLimit,
		'--cpus', sandbox.cpuLimit,
	]

	if (!sandbox.networkEnabled) {
		args.push('--network', 'none')
	}

	args.push(sandbox.image, 'sh', '-c', command)

	return { cmd: engine, args }
}

export const terminalTools = {

	run_command: tool({
		description: 'Execute a shell command and return stdout and stderr. Use for navigation, package management, git, building files, etc.',
		inputSchema: z.object({
			command: z.string().describe('The shell command to execute'),
			cwd: z.string().optional().describe('Working directory (defaults to process.cwd())'),
		}),
		execute: async ({ command, cwd }: { command: string; cwd?: string }) => {
			try {
				auditCommand(command)
				const targetCwd = validatePath(cwd || '.')
				const sandbox = getSandboxConfig()

				if (sandbox.engine !== 'none') {
					// Run inside container
					const { cmd, args } = buildSandboxedCommand(command, targetCwd)
					const timeout = sandbox.timeout * 1000
					const proc = Bun.spawn([cmd, ...args], {
						stdout: 'pipe',
						stderr: 'pipe',
					})

					// Apply timeout
					const timer = setTimeout(() => proc.kill(), timeout)
					const [stdout, stderr] = await Promise.all([
						new Response(proc.stdout).text(),
						new Response(proc.stderr).text(),
					])
					clearTimeout(timer)

					const exitCode = await proc.exited
					if (exitCode !== 0) {
						return { success: false, stdout, stderr: stderr || `Process exited with code ${exitCode}`, sandboxed: true }
					}
					return { success: true, stdout, stderr: '', sandboxed: true }
				}

				// Non-sandboxed (original behaviour)
				const output = execSync(command, {
					cwd: targetCwd,
					encoding: 'utf-8',
					timeout: 30_000,
					maxBuffer: 1024 * 1024 * 10, // 10 MB
				})
				return { success: true, stdout: output, stderr: '' }
			} catch (err: unknown) {
				const e = err as { stdout?: string; stderr?: string; message?: string }
				return { success: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) }
			}
		},
	}),

	read_file: tool({
		description: 'Read the contents of a file at the given path.',
		inputSchema: z.object({
			path: z.string().describe('Absolute or relative path to the file'),
		}),
		execute: async ({ path }: { path: string }) => {
			try {
				const content = readFileSync(validatePath(path), 'utf-8')
				return { success: true, content }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	write_file: tool({
		description: 'Create or overwrite a file with the given content. Parent directories are created automatically.',
		inputSchema: z.object({
			path: z.string().describe('File path to write'),
			content: z.string().describe('Content to write to the file'),
		}),
		execute: async ({ path, content }: { path: string; content: string }) => {
			try {
				const fullPath = validatePath(path)
				mkdirSync(dirname(fullPath), { recursive: true })
				writeFileSync(fullPath, content, 'utf-8')
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	edit_file: tool({
		description: 'Replace an exact string in a file with new content. Returns an error if the target string is not found.',
		inputSchema: z.object({
			path: z.string().describe('File path'),
			target: z.string().describe('Exact string to search for and replace'),
			replacement: z.string().describe('String to replace it with'),
		}),
		execute: async ({ path, target, replacement }: { path: string; target: string; replacement: string }) => {
			try {
				const fullPath = validatePath(path)
				const original = readFileSync(fullPath, 'utf-8')
				if (!original.includes(target)) {
					return { success: false, error: 'Target string not found in file.' }
				}
				writeFileSync(fullPath, original.replace(target, replacement), 'utf-8')
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	delete_file: tool({
		description: 'Delete a file at the given path.',
		inputSchema: z.object({
			path: z.string().describe('File path to delete'),
		}),
		execute: async ({ path }: { path: string }) => {
			try {
				unlinkSync(validatePath(path))
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	move_file: tool({
		description: 'Move or rename a file from one path to another.',
		inputSchema: z.object({
			from: z.string().describe('Source path'),
			to: z.string().describe('Destination path'),
		}),
		execute: async ({ from, to }: { from: string; to: string }) => {
			try {
				const fullTo = validatePath(to)
				const fullFrom = validatePath(from)
				mkdirSync(dirname(fullTo), { recursive: true })
				await rename(fullFrom, fullTo)
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	copy_file: tool({
		description: 'Copy a file from one path to another.',
		inputSchema: z.object({
			from: z.string().describe('Source path'),
			to: z.string().describe('Destination path'),
		}),
		execute: async ({ from, to }: { from: string; to: string }) => {
			try {
				const fullTo = validatePath(to)
				const fullFrom = validatePath(from)
				mkdirSync(dirname(fullTo), { recursive: true })
				cpSync(fullFrom, fullTo)
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	list_dir: tool({
		description: 'List files and directories inside a directory.',
		inputSchema: z.object({
			path: z.string().describe('Directory path to list').default('.'),
		}),
		execute: async ({ path }: { path: string }) => {
			try {
				const fullPath = validatePath(path)
				const entries = readdirSync(fullPath, { withFileTypes: true }).map((e) => ({
					name: e.name,
					type: e.isDirectory() ? 'directory' : 'file',
					size: e.isFile() ? statSync(join(fullPath, e.name)).size : undefined,
				}))
				return { success: true, path: fullPath, entries }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	find_files: tool({
		description: 'Find files matching a pattern using find/glob. Returns matching paths.',
		inputSchema: z.object({
			pattern: z.string().describe('Shell glob/find pattern, e.g. "*.ts" or "./src/**/*.ts"'),
			cwd: z.string().optional().describe('Root directory to search from (defaults to process.cwd())'),
		}),
		execute: async ({ pattern, cwd }: { pattern: string; cwd?: string }) => {
			try {
				const targetCwd = cwd ? validatePath(cwd) : process.cwd()
				const builtCommand = `find . -name "${pattern}" -type f 2>/dev/null || true`
				auditCommand(builtCommand)
				// Use `find` for actual filesystem searching
				const output = execSync(builtCommand, {
					cwd: targetCwd,
					encoding: 'utf-8',
				})
				const matches = output.split('\n').filter(Boolean)
				return { success: true, matches }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),
}

export const TERMINAL_TOOL_NAME = 'terminal'
export const TERMINAL_TOOL_LABEL = '💻 Terminal (shell, file CRUD, directory navigation)'
