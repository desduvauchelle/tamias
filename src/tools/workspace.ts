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
}

export const WORKSPACE_TOOL_NAME = 'workspace'
export const WORKSPACE_TOOL_LABEL = '📂 Workspace (restricted terminal, only inside tamias-workspace)'
