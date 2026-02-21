import { tool } from 'ai'
import { z } from 'zod'
import { execSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'

function expandHome(path: string): string {
	if (path.startsWith('~/')) {
		return join(homedir(), path.slice(2))
	}
	if (path === '~') {
		return homedir()
	}
	return path
}

export const GEMINI_TOOL_NAME = 'gemini'
export const GEMINI_TOOL_LABEL = '♊ Gemini CLI (run prompts in specific directories)'

export const geminiTools = {
	run: tool({
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
