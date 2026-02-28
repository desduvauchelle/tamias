import { tool } from 'ai'
import { z } from 'zod'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, unlinkSync, cpSync, mkdirSync, readdirSync, statSync } from 'fs'
import { rename } from 'fs/promises'
import { join, dirname } from 'path'
import { getWorkspacePath } from '../utils/config.ts'
import { validatePath } from '../utils/path.ts'

/**
 * Restricted Terminal Tools
 * Every tool validates that the target path is within the configured workspace.
 */

export const workspaceTools = {

	run_command: tool({
		description: 'Execute a shell command WITHIN the restricted workspace. Blocks dangerous commands.',
		inputSchema: z.object({
			command: z.string().describe('The shell command to execute'),
			cwd: z.string().optional().describe('Relative sub-path within the workspace'),
		}),
		execute: async ({ command, cwd }) => {
			const root = getWorkspacePath()
			const targetCwd = cwd ? validatePath(cwd) : root

			// Block some obviously dangerous commands even if they stay in CWD
			const blocked = ['rm -rf /', 'sudo', 'chmod', 'chown', 'export', 'unset', 'env']
			if (blocked.some(b => command.includes(b))) {
				return { success: false, error: 'Command contains blocked keywords for security.' }
			}

			try {
				const output = execSync(command, {
					cwd: targetCwd,
					encoding: 'utf-8',
					timeout: 30_000,
					maxBuffer: 1024 * 1024 * 10,
				})
				return { success: true, stdout: output, stderr: '' }
			} catch (err: unknown) {
				const e = err as { stdout?: string; stderr?: string; message?: string }
				return { success: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) }
			}
		},
	}),

	read_file: tool({
		description: 'Read the contents of a file within the workspace.',
		inputSchema: z.object({
			path: z.string().describe('Path to the file relative to the workspace'),
		}),
		execute: async ({ path }) => {
			try {
				const absolutePath = validatePath(path)
				const content = readFileSync(absolutePath, 'utf-8')
				return { success: true, content }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	write_file: tool({
		description: 'Create or overwrite a file within the workspace.',
		inputSchema: z.object({
			path: z.string().describe('File path relative to the workspace'),
			content: z.string().describe('Content to write'),
		}),
		execute: async ({ path, content }) => {
			try {
				const absolutePath = validatePath(path)
				mkdirSync(dirname(absolutePath), { recursive: true })
				writeFileSync(absolutePath, content, 'utf-8')
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	edit_file: tool({
		description: 'Replace an exact string in a file within the workspace.',
		inputSchema: z.object({
			path: z.string().describe('File path relative to the workspace'),
			target: z.string().describe('Exact string to search for'),
			replacement: z.string().describe('String to replace it with'),
		}),
		execute: async ({ path, target, replacement }) => {
			try {
				const absolutePath = validatePath(path)
				const original = readFileSync(absolutePath, 'utf-8')
				if (!original.includes(target)) {
					return { success: false, error: 'Target string not found in file.' }
				}
				writeFileSync(absolutePath, original.replace(target, replacement), 'utf-8')
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	delete_file: tool({
		description: 'Delete a file within the workspace.',
		inputSchema: z.object({
			path: z.string().describe('File path relative to the workspace'),
		}),
		execute: async ({ path }) => {
			try {
				const absolutePath = validatePath(path)
				unlinkSync(absolutePath)
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	move_file: tool({
		description: 'Move or rename a file within the workspace.',
		inputSchema: z.object({
			from: z.string().describe('Source path'),
			to: z.string().describe('Destination path'),
		}),
		execute: async ({ from, to }) => {
			try {
				const source = validatePath(from)
				const dest = validatePath(to)
				mkdirSync(dirname(dest), { recursive: true })
				await rename(source, dest)
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	copy_file: tool({
		description: 'Copy a file within the workspace.',
		inputSchema: z.object({
			from: z.string().describe('Source path'),
			to: z.string().describe('Destination path'),
		}),
		execute: async ({ from, to }) => {
			try {
				const source = validatePath(from)
				const dest = validatePath(to)
				mkdirSync(dirname(dest), { recursive: true })
				cpSync(source, dest)
				return { success: true }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	list_dir: tool({
		description: 'List files and directories inside a workspace directory.',
		inputSchema: z.object({
			path: z.string().describe('Sub-directory path').default('.'),
		}),
		execute: async ({ path }) => {
			try {
				const absolutePath = validatePath(path)
				const entries = readdirSync(absolutePath, { withFileTypes: true }).map((e) => ({
					name: e.name,
					type: e.isDirectory() ? 'directory' : 'file',
					size: e.isFile() ? statSync(join(absolutePath, e.name)).size : undefined,
				}))
				return { success: true, path, entries }
			} catch (err) {
				return { success: false, error: String(err) }
			}
		},
	}),

	search_grep: tool({
		description: 'Search for a regex/text pattern in workspace files. Uses ripgrep (rg) if available, falls back to grep. Returns raw match output capped at 200 lines.',
		inputSchema: z.object({
			pattern: z.string().describe('Regex or literal text to search for'),
			path: z.string().optional().describe('Sub-path within the workspace to search (defaults to workspace root)'),
			include_extension: z.string().optional().describe('Limit search to files with this extension, e.g. "ts" or "md"'),
			case_insensitive: z.boolean().optional().describe('Case-insensitive search (default: false)'),
		}),
		execute: async ({ pattern, path, include_extension, case_insensitive }) => {
			try {
				const root = getWorkspacePath()
				const targetPath = path ? validatePath(path) : root
				const caseFlag = case_insensitive ? '-i' : ''
				const extFilter = include_extension ? `--include="*.${include_extension}"` : ''

				let output: string
				try {
					execSync('which rg', { encoding: 'utf-8' })
					const rgExt = include_extension ? `-g "*.${include_extension}"` : ''
					const rgCase = case_insensitive ? '-i' : ''
					output = execSync(`rg -n ${rgCase} ${rgExt} ${JSON.stringify(pattern)} ${JSON.stringify(targetPath)} 2>/dev/null | head -200 || true`, {
						encoding: 'utf-8',
						maxBuffer: 1024 * 1024 * 5,
					})
				} catch {
					output = execSync(`grep -rn ${caseFlag} ${extFilter} ${JSON.stringify(pattern)} ${JSON.stringify(targetPath)} 2>/dev/null | head -200 || true`, {
						encoding: 'utf-8',
						maxBuffer: 1024 * 1024 * 5,
					})
				}

				return { success: true, output: output.trim(), pattern, path: targetPath }
			} catch (err) {
				return { success: false, error: String(err), output: '' }
			}
		},
	}),

	read_lines: tool({
		description: 'Read a specific line range from a workspace file (1-indexed). Useful for inspecting large files without loading everything.',
		inputSchema: z.object({
			path: z.string().describe('Path to the file within the workspace'),
			start_line: z.number().int().min(1).describe('First line to read (1-indexed)'),
			end_line: z.number().int().min(1).describe('Last line to read (1-indexed, inclusive)'),
		}),
		execute: async ({ path, start_line, end_line }) => {
			try {
				const fullPath = validatePath(path)
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

	list_recent_files: tool({
		description: 'List workspace files modified within the last N hours, sorted newest first. Excludes .git, node_modules, dist, .next.',
		inputSchema: z.object({
			path: z.string().optional().describe('Sub-path within the workspace to search (defaults to workspace root)'),
			hours: z.number().optional().describe('How many hours back to look (default: 24)'),
			limit: z.number().int().optional().describe('Maximum number of files to return (default: 30)'),
		}),
		execute: async ({ path, hours, limit }) => {
			try {
				const root = getWorkspacePath()
				const targetPath = path ? validatePath(path) : root
				const h = hours ?? 24
				const l = limit ?? 30
				const minutes = Math.round(h * 60)
				const output = execSync(
					`find ${JSON.stringify(targetPath)} -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.next/*" -type f -mmin -${minutes} -printf "%T@ %p\\n" 2>/dev/null | sort -rn | head -${l} | awk '{print $2}' || true`,
					{ encoding: 'utf-8', maxBuffer: 1024 * 1024 }
				)
				const files = output.trim().split('\n').filter(Boolean)
				return { success: true, files, hours: h, count: files.length }
			} catch (err) {
				return { success: false, error: String(err), files: [] }
			}
		},
	}),
}

export const WORKSPACE_TOOL_NAME = 'workspace'
export const WORKSPACE_TOOL_LABEL = '📂 Workspace (restricted terminal, only inside tamias-workspace)'
