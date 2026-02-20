import { tool } from 'ai'
import { z } from 'zod'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, unlinkSync, cpSync, mkdirSync, readdirSync, statSync } from 'fs'
import { rename } from 'fs/promises'
import { join, dirname } from 'path'

/** All tools exported from this file become the "terminal" internal tool */

export const terminalTools = {

	run_command: tool({
		description: 'Execute a shell command and return stdout and stderr. Use for navigation, package management, git, building files, etc.',
		inputSchema: z.object({
			command: z.string().describe('The shell command to execute'),
			cwd: z.string().optional().describe('Working directory (defaults to process.cwd())'),
		}),
		execute: async ({ command, cwd }: { command: string; cwd?: string }) => {
			try {
				const output = execSync(command, {
					cwd: cwd ?? process.cwd(),
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
				const content = readFileSync(path, 'utf-8')
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
				mkdirSync(dirname(path), { recursive: true })
				writeFileSync(path, content, 'utf-8')
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
				const original = readFileSync(path, 'utf-8')
				if (!original.includes(target)) {
					return { success: false, error: 'Target string not found in file.' }
				}
				writeFileSync(path, original.replace(target, replacement), 'utf-8')
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
				unlinkSync(path)
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
				mkdirSync(dirname(to), { recursive: true })
				await rename(from, to)
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
				mkdirSync(dirname(to), { recursive: true })
				cpSync(from, to)
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
				const entries = readdirSync(path, { withFileTypes: true }).map((e) => ({
					name: e.name,
					type: e.isDirectory() ? 'directory' : 'file',
					size: e.isFile() ? statSync(join(path, e.name)).size : undefined,
				}))
				return { success: true, path, entries }
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
				// Use `find` for actual filesystem searching
				const output = execSync(`find . -name "${pattern}" -type f 2>/dev/null || true`, {
					cwd: cwd ?? process.cwd(),
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
