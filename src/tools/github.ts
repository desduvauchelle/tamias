import { tool } from 'ai'
import { z } from 'zod'
import { execSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync } from 'fs'

function expandHome(path: string): string {
	if (path.startsWith('~/')) {
		return join(homedir(), path.slice(2))
	}
	if (path === '~') {
		return homedir()
	}
	return path
}

export const githubTools = {
	git_status: tool({
		description: 'Show the working tree status.',
		inputSchema: z.object({
			cwd: z.string().optional().describe('Working directory (defaults to process.cwd())'),
		}),
		execute: async ({ cwd }: { cwd?: string }) => {
			try {
				const output = execSync('git status', {
					cwd: cwd ? expandHome(cwd) : process.cwd(),
					encoding: 'utf-8',
				})
				return { success: true, stdout: output }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),

	git_add: tool({
		description: 'Add file contents to the index.',
		inputSchema: z.object({
			files: z.array(z.string()).describe('List of files to add. Use ["."] for all.'),
			cwd: z.string().optional().describe('Working directory'),
		}),
		execute: async ({ files, cwd }: { files: string[]; cwd?: string }) => {
			try {
				execSync(`git add ${files.join(' ')}`, {
					cwd: cwd ? expandHome(cwd) : process.cwd(),
					encoding: 'utf-8',
				})
				return { success: true, message: `Added ${files.join(', ')} to index.` }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),

	git_commit: tool({
		description: 'Record changes to the repository.',
		inputSchema: z.object({
			message: z.string().describe('Commit message'),
			cwd: z.string().optional().describe('Working directory'),
		}),
		execute: async ({ message, cwd }: { message: string; cwd?: string }) => {
			try {
				const output = execSync(`git commit -m ${JSON.stringify(message)}`, {
					cwd: cwd ? expandHome(cwd) : process.cwd(),
					encoding: 'utf-8',
				})
				return { success: true, stdout: output }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),

	git_push: tool({
		description: 'Update remote refs along with associated objects.',
		inputSchema: z.object({
			remote: z.string().optional().default('origin'),
			branch: z.string().optional().describe('Branch name (defaults to current branch)'),
			cwd: z.string().optional().describe('Working directory'),
		}),
		execute: async ({ remote, branch, cwd }: { remote: string; branch?: string; cwd?: string }) => {
			try {
				const cmd = `git push ${remote} ${branch ?? ''}`
				const output = execSync(cmd, {
					cwd: cwd ? expandHome(cwd) : process.cwd(),
					encoding: 'utf-8',
				})
				return { success: true, stdout: output }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),

	git_pull: tool({
		description: 'Fetch from and integrate with another repository or a local branch.',
		inputSchema: z.object({
			remote: z.string().optional().default('origin'),
			branch: z.string().optional().describe('Branch name (defaults to current branch)'),
			cwd: z.string().optional().describe('Working directory'),
		}),
		execute: async ({ remote, branch, cwd }: { remote: string; branch?: string; cwd?: string }) => {
			try {
				const cmd = `git pull ${remote} ${branch ?? ''}`
				const output = execSync(cmd, {
					cwd: cwd ? expandHome(cwd) : process.cwd(),
					encoding: 'utf-8',
				})
				return { success: true, stdout: output }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),

	git_clone: tool({
		description: 'Clone a repository into a new directory.',
		inputSchema: z.object({
			repository: z.string().describe('URL or path of the repository to clone'),
			directory: z.string().optional().describe('Target directory name'),
			cwd: z.string().optional().describe('Parent directory for clones (defaults to process.cwd())'),
		}),
		execute: async ({ repository, directory, cwd }: { repository: string; directory?: string; cwd?: string }) => {
			try {
				const targetCwd = cwd ? expandHome(cwd) : process.cwd()
				if (!existsSync(targetCwd)) {
					mkdirSync(targetCwd, { recursive: true })
				}
				const cmd = `git clone ${repository} ${directory ?? ''}`
				const output = execSync(cmd, {
					cwd: targetCwd,
					encoding: 'utf-8',
				})
				return { success: true, stdout: output }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),

	git_diff: tool({
		description: 'Show changes between commits, commit and working tree, etc.',
		inputSchema: z.object({
			args: z.string().optional().describe('Raw arguments for git diff, e.g. "--cached" or "HEAD~1"'),
			cwd: z.string().optional().describe('Working directory'),
		}),
		execute: async ({ args, cwd }: { args?: string; cwd?: string }) => {
			try {
				const output = execSync(`git diff ${args ?? ''}`, {
					cwd: cwd ? expandHome(cwd) : process.cwd(),
					encoding: 'utf-8',
				})
				return { success: true, stdout: output }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),

	git_log: tool({
		description: 'Show commit logs.',
		inputSchema: z.object({
			n: z.number().optional().default(10).describe('Limit the number of commits'),
			cwd: z.string().optional().describe('Working directory'),
		}),
		execute: async ({ n, cwd }: { n: number; cwd?: string }) => {
			try {
				const output = execSync(`git log -n ${n} --oneline`, {
					cwd: cwd ? expandHome(cwd) : process.cwd(),
					encoding: 'utf-8',
				})
				return { success: true, stdout: output }
			} catch (err: any) {
				return { success: false, error: err.stdout || err.message }
			}
		},
	}),
}

export const GITHUB_TOOL_NAME = 'github'
export const GITHUB_TOOL_LABEL = '📂 GitHub (git: add, commit, push, pull, clone, etc.)'
