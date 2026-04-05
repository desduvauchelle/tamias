/**
 * Unified file operations tool.
 *
 * Merges capabilities from terminal.ts, workspace.ts, tamias.ts (workspace path tools),
 * codingCli.ts, and gemini.ts into a single tool with a `restricted` parameter that
 * controls whether operations are scoped to the session workspace or have broader access.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, unlinkSync, cpSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs'
import { rename } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { validatePath, expandHome } from '../utils/path.ts'
import { TAMIAS_DIR, getSandboxConfig, getWorkspacePath, getCodingProviders } from '../utils/config.ts'
import type { AIService } from '../services/aiService.ts'
import {
	delegateCodingTask,
	isCommandAvailable,
	PROVIDER_PRESETS,
} from './codingCli.ts'

export const FILES_TOOL_NAME = 'files'
export const FILES_TOOL_LABEL = '📁 Files (file CRUD, shell, search, workspace, coding CLI)'

// ─── Private helpers (from terminal.ts) ──────────────────────────────────────

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

// ─── Zod description for the `restricted` parameter ──────────────────────────

const restrictedDesc = 'If true (default), restricts to workspace directory. If false, allows broader terminal access.'

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createFilesTools(aiService: AIService, sessionId: string, sessionWorkspacePath?: string) {
	/** Resolve root from per-session path or fall back to global config */
	const getRoot = () => sessionWorkspacePath ?? getWorkspacePath()
	/** Validate a path within this session's workspace (restricted mode) */
	const vp = (p: string) => validatePath(p, sessionWorkspacePath)

	return {
		// ─── 1. run_command ──────────────────────────────────────────────────
		run_command: tool({
			description: 'Execute a shell command. When restricted (default), runs within the workspace with blocked-keyword guard and workspace cwd. When unrestricted, uses full terminal audit + optional sandbox.',
			inputSchema: z.object({
				command: z.string().describe('The shell command to execute'),
				cwd: z.string().optional().describe('Working directory (defaults to workspace root when restricted, process.cwd() when unrestricted)'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ command, cwd, restricted }: { command: string; cwd?: string; restricted: boolean }) => {
				try {
					if (restricted) {
						// Workspace-restricted mode (from workspace.ts)
						const root = getRoot()
						const targetCwd = cwd ? vp(cwd) : root

						// Block obviously dangerous commands even if they stay in CWD
						const blocked = ['rm -rf /', 'sudo', 'chmod', 'chown', 'export', 'unset', 'env']
						if (blocked.some(b => command.includes(b))) {
							return { success: false, error: 'Command contains blocked keywords for security.' }
						}

						const output = execSync(command, {
							cwd: targetCwd,
							encoding: 'utf-8',
							timeout: 30_000,
							maxBuffer: 1024 * 1024 * 10,
						})
						return { success: true, stdout: output, stderr: '', restricted: true }
					}

					// Unrestricted mode (from terminal.ts): audit + optional sandbox
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
							return { success: false, stdout, stderr: stderr || `Process exited with code ${exitCode}`, sandboxed: true, restricted: false }
						}
						return { success: true, stdout, stderr: '', sandboxed: true, restricted: false }
					}

					// Non-sandboxed (original terminal behaviour)
					const output = execSync(command, {
						cwd: targetCwd,
						encoding: 'utf-8',
						timeout: 30_000,
						maxBuffer: 1024 * 1024 * 10, // 10 MB
					})
					return { success: true, stdout: output, stderr: '', restricted: false }
				} catch (err: unknown) {
					const e = err as { stdout?: string; stderr?: string; message?: string }
					return { success: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) }
				}
			},
		}),

		// ─── 2. read_file ────────────────────────────────────────────────────
		read_file: tool({
			description: 'Read the contents of a file at the given path.',
			inputSchema: z.object({
				path: z.string().describe('Absolute or relative path to the file'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ path, restricted }: { path: string; restricted: boolean }) => {
				try {
					const fullPath = restricted ? vp(path) : validatePath(path)
					const content = readFileSync(fullPath, 'utf-8')
					return { success: true, content }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 3. write_file ───────────────────────────────────────────────────
		write_file: tool({
			description: 'Create or overwrite a file with the given content. Parent directories are created automatically.',
			inputSchema: z.object({
				path: z.string().describe('File path to write'),
				content: z.string().describe('Content to write to the file'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ path, content, restricted }: { path: string; content: string; restricted: boolean }) => {
				try {
					const fullPath = restricted ? vp(path) : validatePath(path)
					mkdirSync(dirname(fullPath), { recursive: true })
					// Normalize literal escape sequences that some models emit instead of real characters
					const normalizedContent = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
					writeFileSync(fullPath, normalizedContent, 'utf-8')
					return { success: true }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 4. edit_file ────────────────────────────────────────────────────
		edit_file: tool({
			description: 'Replace an exact string in a file with new content. Returns an error if the target string is not found.',
			inputSchema: z.object({
				path: z.string().describe('File path'),
				target: z.string().describe('Exact string to search for and replace'),
				replacement: z.string().describe('String to replace it with'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ path, target, replacement, restricted }: { path: string; target: string; replacement: string; restricted: boolean }) => {
				try {
					const fullPath = restricted ? vp(path) : validatePath(path)
					const original = readFileSync(fullPath, 'utf-8')
					// Normalize literal escape sequences that some models emit instead of real characters
					const normalizeEscapes = (s: string) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
					const normTarget = normalizeEscapes(target)
					const normReplacement = normalizeEscapes(replacement)
					if (!original.includes(normTarget)) {
						return { success: false, error: 'Target string not found in file.' }
					}
					writeFileSync(fullPath, original.replace(normTarget, normReplacement), 'utf-8')
					return { success: true }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 5. delete_file ──────────────────────────────────────────────────
		delete_file: tool({
			description: 'Delete a file at the given path.',
			inputSchema: z.object({
				path: z.string().describe('File path to delete'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ path, restricted }: { path: string; restricted: boolean }) => {
				try {
					const fullPath = restricted ? vp(path) : validatePath(path)
					unlinkSync(fullPath)
					return { success: true }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 6. move_file ────────────────────────────────────────────────────
		move_file: tool({
			description: 'Move or rename a file from one path to another.',
			inputSchema: z.object({
				from: z.string().describe('Source path'),
				to: z.string().describe('Destination path'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ from, to, restricted }: { from: string; to: string; restricted: boolean }) => {
				try {
					const fullFrom = restricted ? vp(from) : validatePath(from)
					const fullTo = restricted ? vp(to) : validatePath(to)
					mkdirSync(dirname(fullTo), { recursive: true })
					await rename(fullFrom, fullTo)
					return { success: true }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 7. copy_file ────────────────────────────────────────────────────
		copy_file: tool({
			description: 'Copy a file from one path to another.',
			inputSchema: z.object({
				from: z.string().describe('Source path'),
				to: z.string().describe('Destination path'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ from, to, restricted }: { from: string; to: string; restricted: boolean }) => {
				try {
					const fullFrom = restricted ? vp(from) : validatePath(from)
					const fullTo = restricted ? vp(to) : validatePath(to)
					mkdirSync(dirname(fullTo), { recursive: true })
					cpSync(fullFrom, fullTo)
					return { success: true }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 8. list_dir ─────────────────────────────────────────────────────
		list_dir: tool({
			description: 'List files and directories inside a directory.',
			inputSchema: z.object({
				path: z.string().describe('Directory path to list').default('.'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ path, restricted }: { path: string; restricted: boolean }) => {
				try {
					const fullPath = restricted ? vp(path) : validatePath(path)
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

		// ─── 9. find_files ───────────────────────────────────────────────────
		find_files: tool({
			description: 'Find files matching a pattern using find/glob. Returns matching paths. Uses auditCommand for safety.',
			inputSchema: z.object({
				pattern: z.string().describe('Shell glob/find pattern, e.g. "*.ts" or "./src/**/*.ts"'),
				cwd: z.string().optional().describe('Root directory to search from (defaults to workspace root when restricted, process.cwd() when unrestricted)'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ pattern, cwd, restricted }: { pattern: string; cwd?: string; restricted: boolean }) => {
				try {
					let targetCwd: string
					if (restricted) {
						targetCwd = cwd ? vp(cwd) : getRoot()
					} else {
						targetCwd = cwd ? validatePath(cwd) : process.cwd()
					}
					const builtCommand = `find . -name "${pattern}" -type f 2>/dev/null || true`
					auditCommand(builtCommand)
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

		// ─── 10. search_grep ─────────────────────────────────────────────────
		search_grep: tool({
			description: 'Search for a regex/text pattern in files. Uses ripgrep (rg) if available, falls back to grep. Returns raw match output capped at 200 lines.',
			inputSchema: z.object({
				pattern: z.string().describe('Regex or literal text to search for'),
				path: z.string().optional().describe('Directory or file to search in (defaults to workspace root when restricted, process.cwd() when unrestricted)'),
				include_extension: z.string().optional().describe('Limit search to files with this extension, e.g. "ts" or "md"'),
				case_insensitive: z.boolean().optional().describe('Case-insensitive search (default: false)'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ pattern, path, include_extension, case_insensitive, restricted }: {
				pattern: string; path?: string; include_extension?: string; case_insensitive?: boolean; restricted: boolean
			}) => {
				try {
					let targetPath: string
					if (restricted) {
						targetPath = path ? vp(path) : getRoot()
					} else {
						targetPath = path ? validatePath(path) : process.cwd()
					}
					const caseFlag = case_insensitive ? '-i' : ''
					const extFilter = include_extension ? `--include="*.${include_extension}"` : ''

					// Try ripgrep first, fall back to grep
					let command: string
					try {
						execSync('which rg', { encoding: 'utf-8' })
						const rgExt = include_extension ? `-g "*.${include_extension}"` : ''
						const rgCase = case_insensitive ? '-i' : ''
						command = `rg -n ${rgCase} ${rgExt} ${JSON.stringify(pattern)} ${JSON.stringify(targetPath)} 2>/dev/null | head -200 || true`
					} catch {
						command = `grep -rn ${caseFlag} ${extFilter} ${JSON.stringify(pattern)} ${JSON.stringify(targetPath)} 2>/dev/null | head -200 || true`
					}

					if (!restricted) auditCommand(command)
					const output = execSync(command, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 5 })
					return { success: true, output: output.trim(), pattern, path: targetPath }
				} catch (err) {
					return { success: false, error: String(err), output: '' }
				}
			},
		}),

		// ─── 11. read_lines ──────────────────────────────────────────────────
		read_lines: tool({
			description: 'Read a specific line range from a file (1-indexed). Useful for inspecting large files without loading everything.',
			inputSchema: z.object({
				path: z.string().describe('Path to the file'),
				start_line: z.number().int().min(1).describe('First line to read (1-indexed)'),
				end_line: z.number().int().min(1).describe('Last line to read (1-indexed, inclusive)'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ path, start_line, end_line, restricted }: {
				path: string; start_line: number; end_line: number; restricted: boolean
			}) => {
				try {
					const fullPath = restricted ? vp(path) : validatePath(path)
					const raw = readFileSync(fullPath, 'utf-8')
					const allLines = raw.split('\n')
					const total_lines = allLines.length
					const sliced = allLines.slice(start_line - 1, end_line)
					return {
						success: true,
						content: sliced.join('\n'),
						start_line,
						end_line: Math.min(end_line, total_lines),
						total_lines,
					}
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 12. list_recent_files ───────────────────────────────────────────
		list_recent_files: tool({
			description: 'List files modified within the last N hours, sorted newest first. Excludes .git, node_modules, dist, .next.',
			inputSchema: z.object({
				path: z.string().optional().describe('Root directory to search from (defaults to workspace root when restricted, process.cwd() when unrestricted)'),
				hours: z.number().optional().describe('How many hours back to look (default: 24)'),
				limit: z.number().int().optional().describe('Maximum number of files to return (default: 30)'),
				restricted: z.boolean().default(true).describe(restrictedDesc),
			}),
			execute: async ({ path, hours, limit, restricted }: {
				path?: string; hours?: number; limit?: number; restricted: boolean
			}) => {
				try {
					let targetPath: string
					if (restricted) {
						targetPath = path ? vp(path) : getRoot()
					} else {
						targetPath = path ? validatePath(path) : process.cwd()
					}
					const h = hours ?? 24
					const l = limit ?? 30
					const minutes = Math.round(h * 60)
					const command = `find ${JSON.stringify(targetPath)} -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.next/*" -type f -mmin -${minutes} -printf "%T@ %p\\n" 2>/dev/null | sort -rn | head -${l} | awk '{print $2}' || true`
					if (!restricted) auditCommand(command)
					const output = execSync(command, { encoding: 'utf-8', maxBuffer: 1024 * 1024 })
					const files = output.trim().split('\n').filter(Boolean)
					return { success: true, files, hours: h, count: files.length }
				} catch (err) {
					return { success: false, error: String(err), files: [] }
				}
			},
		}),

		// ─── 13. get_workspace_path ──────────────────────────────────────────
		get_workspace_path: tool({
			description: 'Get the current restricted workspace directory path for this session.',
			inputSchema: z.object({}),
			execute: async () => {
				const session = aiService.getSession(sessionId)
				return { workspacePath: session?.workspacePath ?? getWorkspacePath() }
			},
		}),

		// ─── 14. set_workspace_path ──────────────────────────────────────────
		set_workspace_path: tool({
			description: 'Override the workspace directory for THIS session\'s file operations. MUST be a path inside ~/.tamias (e.g. ~/.tamias/workspace/my-project). Paths outside ~/.tamias are forbidden. Only affects this session.',
			inputSchema: z.object({
				path: z.string().describe('Absolute path inside ~/.tamias, e.g. ~/.tamias/workspace/my-project'),
			}),
			execute: async ({ path }: { path: string }) => {
				const normalised = path.replace(/\/+$/, '')
				if (!normalised.startsWith(TAMIAS_DIR)) {
					return {
						success: false,
						error: `Workspace path must be inside ${TAMIAS_DIR}. Got: '${path}'. Use a sub-folder such as ~/.tamias/workspace or ~/.tamias/workspace/<project>.`
					}
				}
				try {
					// Update this session's workspace path (does NOT change the global config)
					const session = aiService.getSession(sessionId)
					if (session) {
						session.workspacePath = normalised
						// Ensure the directory exists
						mkdirSync(normalised, { recursive: true })
					}
					return { success: true, workspacePath: normalised }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

		// ─── 15. delegate_coding_task ────────────────────────────────────────
		delegate_coding_task: tool({
			description: 'Delegate a coding task to an external coding CLI (Claude Code, Copilot, Aider, etc.). The system will automatically select the best available provider, choose smart/normal model tier based on task complexity, and handle fallback if a provider is rate-limited or fails. Use this for substantial coding work — file edits, feature implementation, refactoring, test writing, etc.',
			inputSchema: z.object({
				task: z.string().describe('Detailed description of the coding task to delegate.'),
				directory: z.string().describe('Absolute path to the working directory (project root) where the coding CLI should operate.'),
				complexity_hint: z.enum(['smart', 'normal']).optional().describe('Optional override: "smart" forces the powerful model, "normal" forces the standard model. If omitted, complexity is auto-estimated.'),
			}),
			execute: async ({ task, directory, complexity_hint }: {
				task: string
				directory: string
				complexity_hint?: 'smart' | 'normal'
			}) => {
				if (!existsSync(directory)) {
					return {
						success: false,
						error: `Directory does not exist: ${directory}`,
					}
				}

				const result = await delegateCodingTask(
					task, directory, sessionId, complexity_hint,
				)

				if (result.success) {
					return {
						success: true,
						provider: result.providerName,
						modelTier: result.modelTier,
						output: result.stdout.slice(-10000), // Last 10k chars
						durationSeconds: Math.round(result.durationMs / 1000),
						attemptedProviders: result.attemptedProviders,
					}
				}

				return {
					success: false,
					error: result.error,
					attemptedProviders: result.attemptedProviders,
					lastStderr: result.stderr.slice(-2000),
				}
			},
		}),

		// ─── 16. check_coding_providers ──────────────────────────────────────
		check_coding_providers: tool({
			description: 'List configured coding CLI providers, their status, and whether each CLI is detected on the system.',
			inputSchema: z.object({}),
			execute: async () => {
				const providers = getCodingProviders()
				const presets = PROVIDER_PRESETS

				const configured = providers.map(p => {
					const preset = presets.find(pr => pr.name === p.name)
					const detectCmd = preset?.detectCommand ?? `which ${p.command.split(/\s+/)[0]}`
					const installed = isCommandAvailable(detectCmd)

					return {
						name: p.name,
						command: p.command,
						enabled: p.enabled,
						priority: p.priority,
						smartModel: p.smartModel ?? '(default)',
						normalModel: p.normalModel ?? '(default)',
						timeout: p.timeout,
						installed,
					}
				})

				const availablePresets = presets
					.filter(pr => !providers.some(p => p.name === pr.name))
					.map(pr => ({
						name: pr.name,
						displayName: pr.displayName,
						installed: isCommandAvailable(pr.detectCommand),
					}))

				return {
					configuredProviders: configured,
					availablePresets,
					totalConfigured: configured.length,
					totalInstalled: configured.filter(c => c.installed).length,
				}
			},
		}),

		// ─── 17. gemini_run ──────────────────────────────────────────────────
		gemini_run: tool({
			description: 'Execute a command or request using the Gemini CLI in a specific directory. Useful for code fixes, bug fixes, or generating content in a project context.',
			inputSchema: z.object({
				path: z.string().describe('The absolute or relative path to the directory where the Gemini CLI should be executed'),
				prompt: z.string().describe('The prompt or instruction to send to the Gemini CLI'),
			}),
			execute: async ({ path, prompt }: { path: string; prompt: string }) => {
				try {
					const fullPath = expandHome(path)
					const output = execSync(`gemini "${prompt.replace(/"/g, '\\"')}"`, {
						cwd: fullPath,
						encoding: 'utf-8',
						timeout: 600_000, // 10 minutes, as AI operations can be slow
						maxBuffer: 1024 * 1024 * 50, // 50 MB
					})
					return { success: true, stdout: output, stderr: '' }
				} catch (err: unknown) {
					const e = err as { stdout?: string; stderr?: string; message?: string }
					return {
						success: false,
						stdout: e.stdout ?? '',
						stderr: e.stderr ?? e.message ?? String(err),
						error: 'Failed to execute Gemini CLI. Ensure it is installed and available in the PATH.'
					}
				}
			},
		}),
	}
}
