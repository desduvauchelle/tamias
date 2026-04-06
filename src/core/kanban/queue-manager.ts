import { openKanbanDb, closeAllKanbanDbs } from './db.ts'
import { startQueue, stopQueue, getQueueState, notifyNewTask, type QueueCallbacks, type QueueState } from './queue.ts'
import { DEFAULT_KANBAN_CONFIG, type KanbanConfig } from './cli-adapter.ts'
import { recoverInterruptedTasks } from './tasks-db.ts'
import { listExecutions, getExecution } from './executions-db.ts'
import { getProjects, projectEvents } from '../../core/projects.ts'

export { listExecutions, getExecution }

export interface ExecutionOutputListener {
	executionId: string
	send: (chunk: string) => void
	close: () => void
}

// Live output buffers for SSE streaming
const outputBuffers = new Map<string, string[]>() // executionId -> chunks
const outputListeners = new Map<string, Set<ExecutionOutputListener>>()

export function addOutputListener(listener: ExecutionOutputListener): void {
	const existing = outputBuffers.get(listener.executionId)
	if (existing) {
		// Send buffered chunks first
		for (const chunk of existing) {
			listener.send(chunk)
		}
	}
	if (!outputListeners.has(listener.executionId)) {
		outputListeners.set(listener.executionId, new Set())
	}
	outputListeners.get(listener.executionId)!.add(listener)
}

export function removeOutputListener(listener: ExecutionOutputListener): void {
	outputListeners.get(listener.executionId)?.delete(listener)
}

function buildCallbacks(projectId: string, onStateChange: (projectId: string, state: QueueState) => void): QueueCallbacks {
	return {
		onExecutionStarted(taskId, executionId, phase) {
			outputBuffers.set(executionId, [])
			console.log(`[kanban] Execution started: task=${taskId} exec=${executionId} phase=${phase}`)
		},
		onOutput(executionId, chunk) {
			let buf = outputBuffers.get(executionId)
			if (!buf) { buf = []; outputBuffers.set(executionId, buf) }
			buf.push(chunk)
			if (buf.length > 1000) buf.splice(0, buf.length - 1000)
			const listeners = outputListeners.get(executionId)
			if (listeners) {
				for (const l of listeners) {
					try { l.send(chunk) } catch { listeners.delete(l) }
				}
			}
		},
		onExecutionCompleted(executionId, status, exitCode) {
			console.log(`[kanban] Execution completed: exec=${executionId} status=${status} exit=${exitCode}`)
			const listeners = outputListeners.get(executionId)
			if (listeners) {
				for (const l of listeners) { try { l.close() } catch { } }
				outputListeners.delete(executionId)
			}
			// Keep buffer for 30s for late subscribers
			setTimeout(() => outputBuffers.delete(executionId), 30_000)
		},
		onTaskUpdated(task) {
			console.log(`[kanban] Task updated: id=${task.id} status=${task.status}`)
			projectEvents.emit('kanban_task_updated', { projectId, task })
		},
		onCommentAdded(comment) {
			projectEvents.emit('kanban_comment_added', { projectId, comment })
		},
		onQueueUpdated(pid, state) {
			onStateChange(pid, state)
			projectEvents.emit('kanban_queue_updated', { projectId: pid, state })
		},
		onQueueStopped(pid, reason) {
			console.log(`[kanban] Queue stopped: project=${pid} reason=${reason}`)
			projectEvents.emit('kanban_queue_stopped', { projectId: pid, reason })
		},
	}
}

function getProjectConfig(projectId: string): KanbanConfig {
	try {
		const projects = getProjects()
		const project = projects[projectId]
		if (!project) return DEFAULT_KANBAN_CONFIG
		return {
			...DEFAULT_KANBAN_CONFIG,
			cliProvider: (project.kanbanCliProvider as KanbanConfig['cliProvider']) ?? DEFAULT_KANBAN_CONFIG.cliProvider,
			planThinking: (project.kanbanPlanThinking as KanbanConfig['planThinking']) ?? DEFAULT_KANBAN_CONFIG.planThinking,
			executeThinking: (project.kanbanExecuteThinking as KanbanConfig['executeThinking']) ?? DEFAULT_KANBAN_CONFIG.executeThinking,
			autoCommit: project.kanbanAutoCommit ?? DEFAULT_KANBAN_CONFIG.autoCommit,
			autoPush: project.kanbanAutoPush ?? DEFAULT_KANBAN_CONFIG.autoPush,
			customInstructions: project.kanbanCustomInstructions ?? DEFAULT_KANBAN_CONFIG.customInstructions,
		}
	} catch {
		return DEFAULT_KANBAN_CONFIG
	}
}

const queueStateCache = new Map<string, QueueState>()

export function startProjectQueue(projectId: string): void {
	const projects = getProjects()
	const project = projects[projectId]
	if (!project || !project.directory) {
		console.warn(`[kanban] Cannot start queue for ${projectId}: no directory configured`)
		return
	}

	const db = openKanbanDb(projectId)
	const config = getProjectConfig(projectId)
	const callbacks = buildCallbacks(projectId, (pid, state) => { queueStateCache.set(pid, state) })

	void startQueue(db, projectId, { name: project.name, directory: project.directory, description: project.description }, config, callbacks)
}

export function stopProjectQueue(projectId: string): void {
	const projects = getProjects()
	const project = projects[projectId]
	if (!project || !project.directory) return

	const db = openKanbanDb(projectId)
	const config = getProjectConfig(projectId)
	const callbacks = buildCallbacks(projectId, (pid, state) => { queueStateCache.set(pid, state) })

	stopQueue(projectId, callbacks)
}

export function getProjectQueueStatus(projectId: string): QueueState & { hasDirectory: boolean } {
	const projects = getProjects()
	const project = projects[projectId]
	const state = getQueueState(projectId)
	return { ...state, hasDirectory: Boolean(project?.directory) }
}

export function notifyProjectNewTask(projectId: string): void {
	const projects = getProjects()
	const project = projects[projectId]
	if (!project?.directory) return

	const db = openKanbanDb(projectId)
	const config = getProjectConfig(projectId)
	const callbacks = buildCallbacks(projectId, (pid, state) => { queueStateCache.set(pid, state) })

	notifyNewTask(db, projectId, { name: project.name, directory: project.directory, description: project.description }, config, callbacks)
}

export function initKanbanQueueManager(): void {
	console.log('[kanban] Initializing queue manager...')

	// Recover any in-progress tasks from before daemon restart
	const projects = getProjects()
	for (const [projectId, project] of Object.entries(projects)) {
		if (!project.directory) continue
		try {
			const db = openKanbanDb(projectId)
			const recovered = recoverInterruptedTasks(db)
			if (recovered.requeued > 0 || recovered.reset > 0) {
				console.log(`[kanban] Recovered tasks for project ${projectId}: ${recovered.requeued} re-queued, ${recovered.reset} reset to backlog`)
			}
		} catch (err) {
			console.warn(`[kanban] Failed to recover tasks for project ${projectId}:`, err)
		}
	}
}

export function shutdownKanbanQueueManager(): void {
	closeAllKanbanDbs()
}

export function getExecutionOutputBuffer(executionId: string): string[] {
	return outputBuffers.get(executionId) ?? []
}
