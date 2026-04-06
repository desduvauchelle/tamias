import type { Database } from 'bun:sqlite'
import * as tasksDb from './tasks-db.ts'
import * as executionsDb from './executions-db.ts'
import * as commentsDb from './comments-db.ts'
import { buildCliCommand, type KanbanConfig } from './cli-adapter.ts'
import { getFreshEnv } from './fresh-env.ts'
import { parseStreamLine } from './stream-parser.ts'
import { detectRateLimit, type RateLimitInfo } from './rate-limit.ts'
import { buildKanbanPrompt } from './prompt-builder.ts'

const activeProcesses = new Map<string, { proc: ReturnType<typeof Bun.spawn>; executionId: string }>()

export function killTaskProcess(taskId: string): boolean {
	const entry = activeProcesses.get(taskId)
	if (!entry) return false
	try { entry.proc.kill('SIGTERM') } catch { }
	activeProcesses.delete(taskId)
	return true
}

export function killAllTaskProcesses(): void {
	for (const [taskId, entry] of activeProcesses) {
		try { entry.proc.kill('SIGTERM') } catch { }
		activeProcesses.delete(taskId)
	}
}

export interface RunnerCallbacks {
	onExecutionStarted: (taskId: string, executionId: string, phase: 'plan' | 'execute') => void
	onOutput: (executionId: string, chunk: string) => void
	onExecutionCompleted: (executionId: string, status: 'success' | 'failed', exitCode: number) => void
	onTaskUpdated: (task: tasksDb.Task) => void
	onCommentAdded: (comment: commentsDb.Comment) => void
}

export interface RunResult {
	success: boolean
	exitCode: number
	output: string
	rateLimitInfo?: RateLimitInfo
}

interface ProjectContext {
	name: string
	directory: string
	description?: string
}

export async function runTask(
	db: Database,
	task: tasksDb.Task,
	project: ProjectContext,
	comments: commentsDb.Comment[],
	config: KanbanConfig,
	callbacks: RunnerCallbacks,
	options?: { existingPlanOutput?: string }
): Promise<RunResult> {
	if (task.assignee === 'human') throw new Error(`Task "${task.title}" is assigned to a human`)

	tasksDb.updateTaskStatus(db, task.id, 'in-progress')
	const inProgTask = tasksDb.getTask(db, task.id)
	if (inProgTask) callbacks.onTaskUpdated(inProgTask)

	const THINKING_MODELS: Record<string, string> = { smart: 'claude-opus-4-6', basic: 'claude-sonnet-4-6' }
	const resolveModel = (thinkingLevel: string): string => THINKING_MODELS[thinkingLevel] ?? config.model ?? 'claude-opus-4-6'

	const sessionId = crypto.randomUUID()
	const hasPlan = config.planThinking !== null

	let result: RunResult = { success: false, exitCode: -1, output: '' }

	if (hasPlan) {
		const existingPlan = options?.existingPlanOutput
		if (existingPlan) {
			// Reuse existing plan — skip plan phase
		} else {
			const planConfig = { ...config, model: resolveModel(config.planThinking!) }
			result = await executePhase(db, task, project, comments, planConfig, 'plan', callbacks, sessionId, false)
			if (!result.success) return result
		}
		const planOutput = existingPlan ?? result.output
		const execConfig = { ...config, model: resolveModel(config.executeThinking ?? 'smart') }
		result = await executePhase(db, task, project, comments, execConfig, 'execute', callbacks, sessionId, true, planOutput)
		result = { ...result, output: result.output.slice(-1024) }
	} else {
		const execConfig = { ...config, model: resolveModel(config.executeThinking ?? 'smart') }
		result = await executePhase(db, task, project, comments, execConfig, 'execute', callbacks, sessionId, false)
	}

	return result
}

async function executePhase(
	db: Database,
	task: tasksDb.Task,
	project: ProjectContext,
	comments: commentsDb.Comment[],
	config: KanbanConfig,
	phase: 'plan' | 'execute',
	callbacks: RunnerCallbacks,
	sessionId: string,
	resume: boolean,
	planOutput?: string
): Promise<RunResult> {
	const prompt = buildKanbanPrompt({ task, projectName: project.name, projectDirectory: project.directory, projectDescription: project.description, comments, config, phase, planOutput })
	const execution = executionsDb.createExecution(db, task.id, sessionId, phase)
	callbacks.onExecutionStarted(task.id, execution.id, phase)

	const startedAt = Date.now()
	const startedComment = commentsDb.addSystemComment(db, task.id, execution.id, `${phase === 'plan' ? 'Plan' : 'Execution'} started.`)
	callbacks.onCommentAdded(startedComment)

	let shaBefore: string | null = null
	if (phase === 'execute') {
		shaBefore = await captureGitSha(project.directory)
	}

	const cliCmd = buildCliCommand(config, prompt, sessionId, phase, resume)
	const proc = Bun.spawn(cliCmd.args, {
		cwd: project.directory,
		stdout: 'pipe',
		stderr: 'pipe',
		env: getFreshEnv() as Record<string, string>,
	})

	if (proc.pid) executionsDb.updateExecutionPid(db, execution.id, proc.pid)
	activeProcesses.set(task.id, { proc, executionId: execution.id })

	const MAX_OUTPUT_MEMORY = 50 * 1024
	let output = ''
	const reader = proc.stdout.getReader()
	const decoder = new TextDecoder()
	let buffer = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split('\n')
			buffer = lines.pop() ?? ''
			for (const line of lines) {
				if (cliCmd.supportsStreamJson) {
					const parsed = parseStreamLine(line)
					if (parsed && (parsed.type === 'text' || parsed.type === 'tool_use')) {
						output += parsed.content + '\n'
						callbacks.onOutput(execution.id, parsed.content)
						executionsDb.appendExecutionOutput(db, execution.id, parsed.content + '\n')
					}
					if (parsed?.type === 'result' && parsed.costUsd !== undefined) {
						executionsDb.updateExecutionCost(db, execution.id, parsed.costUsd)
					}
				} else if (line.trim()) {
					output += line + '\n'
					callbacks.onOutput(execution.id, line)
					executionsDb.appendExecutionOutput(db, execution.id, line + '\n')
				}
				if (output.length > MAX_OUTPUT_MEMORY * 1.5) output = output.slice(-MAX_OUTPUT_MEMORY)
			}
		}
	} catch { /* stream read error is non-fatal */ }

	let stderrOutput = ''
	try {
		const stderrReader = proc.stderr.getReader()
		const stderrDecoder = new TextDecoder()
		while (true) {
			const { done, value } = await stderrReader.read()
			if (done) break
			stderrOutput += stderrDecoder.decode(value, { stream: true })
			if (stderrOutput.length > 4096) stderrOutput = stderrOutput.slice(-4096)
		}
	} catch { }

	if (buffer.trim()) {
		if (cliCmd.supportsStreamJson) {
			const parsed = parseStreamLine(buffer)
			if (parsed && (parsed.type === 'text' || parsed.type === 'tool_use')) {
				output += parsed.content + '\n'
				callbacks.onOutput(execution.id, parsed.content)
			}
		} else {
			output += buffer + '\n'
			callbacks.onOutput(execution.id, buffer)
		}
	}

	const exitCode = await proc.exited
	activeProcesses.delete(task.id)
	const success = exitCode === 0
	const status = success ? 'success' : 'failed'
	executionsDb.updateExecutionStatus(db, execution.id, status, exitCode)

	if (phase === 'execute' && shaBefore) {
		try {
			const filesChanged = await captureFileChanges(project.directory, shaBefore)
			executionsDb.updateExecutionFilesChanged(db, execution.id, filesChanged)
		} catch { }
	}

	const durationMs = Date.now() - startedAt
	const durationStr = durationMs < 60000 ? `${Math.floor(durationMs / 1000)}s` : `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
	const phaseName = phase === 'plan' ? 'Plan' : 'Execution'
	const summary = success
		? `${phaseName} completed successfully in ${durationStr}.`
		: `${phaseName} failed with exit code ${exitCode} after ${durationStr}.${stderrOutput ? `\n\nstderr:\n${stderrOutput.trim().slice(-500)}` : ''}${output ? `\n\nLast output:\n${output.slice(-500)}` : ''}`
	const comment = commentsDb.addSystemComment(db, task.id, execution.id, summary)
	callbacks.onCommentAdded(comment)

	callbacks.onExecutionCompleted(execution.id, status, exitCode)

	const rateLimitResult = !success ? detectRateLimit(output, stderrOutput, exitCode) : null
	return { success, exitCode, output, ...(rateLimitResult ? { rateLimitInfo: rateLimitResult } : {}) }
}

async function captureGitSha(directory: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })
		const output = await new Response(proc.stdout).text()
		const exitCode = await proc.exited
		return exitCode === 0 ? (output.trim() || null) : null
	} catch { return null }
}

async function captureFileChanges(directory: string, shaBefore: string): Promise<Array<{ path: string; additions: number; deletions: number }>> {
	try {
		const proc = Bun.spawn(['git', 'diff', '--numstat', shaBefore], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })
		const output = await new Response(proc.stdout).text()
		const exitCode = await proc.exited
		if (exitCode !== 0) return []
		const files: Array<{ path: string; additions: number; deletions: number }> = []
		for (const line of output.trim().split('\n')) {
			if (!line.trim()) continue
			const parts = line.split('\t')
			if (parts.length < 3) continue
			const [addStr, delStr, ...pathParts] = parts
			const path = pathParts.join('\t')
			files.push({ path, additions: addStr === '-' ? 0 : parseInt(addStr!, 10) || 0, deletions: delStr === '-' ? 0 : parseInt(delStr!, 10) || 0 })
		}
		return files
	} catch { return [] }
}
