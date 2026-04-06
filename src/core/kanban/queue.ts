import type { Database } from 'bun:sqlite'
import * as tasksDb from './tasks-db.ts'
import * as commentsDb from './comments-db.ts'
import * as executionsDb from './executions-db.ts'
import { runTask, killTaskProcess, type RunnerCallbacks } from './runner.ts'
import { type KanbanConfig } from './cli-adapter.ts'
import type { RateLimitInfo } from './rate-limit.ts'

export interface QueueState {
	projectId: string
	queue: string[]
	active: string[]
	isRunning: boolean
	isPaused: boolean
}

export interface QueueCallbacks extends RunnerCallbacks {
	onQueueUpdated: (projectId: string, state: QueueState) => void
	onQueueStopped: (projectId: string, reason: string) => void
	onRateLimited?: (projectId: string, taskTitle: string, retryInSeconds: number) => void
}

const queues = new Map<string, QueueState>()
const stoppedTaskIds = new Set<string>()

export function getQueueState(projectId: string): QueueState {
	return queues.get(projectId) ?? { projectId, queue: [], active: [], isRunning: false, isPaused: false }
}

export function isQueueRunning(projectId: string): boolean {
	return queues.get(projectId)?.isRunning ?? false
}

export function consumeStoppedFlag(taskId: string): boolean {
	return stoppedTaskIds.delete(taskId)
}

export async function startQueue(
	db: Database,
	projectId: string,
	project: { name: string; directory: string; description?: string },
	config: KanbanConfig,
	callbacks: QueueCallbacks
): Promise<void> {
	const queuedTasks = tasksDb.listQueuedTasks(db)
	if (queuedTasks.length === 0) {
		callbacks.onQueueStopped(projectId, 'No queued tasks to execute')
		return
	}

	const cardIds = queuedTasks.map(t => t.id)
	const state: QueueState = {
		projectId,
		queue: cardIds.slice(1),
		active: cardIds.slice(0, 1),
		isRunning: true,
		isPaused: false,
	}
	queues.set(projectId, state)
	callbacks.onQueueUpdated(projectId, { ...state })

	void processTask(db, projectId, cardIds[0]!, project, config, callbacks)
}

export function stopQueue(projectId: string, callbacks: QueueCallbacks): void {
	const state = queues.get(projectId)
	if (!state) return

	state.isRunning = false
	state.queue = []
	state.active = []
	queues.set(projectId, state)

	callbacks.onQueueStopped(projectId, 'Stopped by user')
}

export function stopTask(db: Database, taskId: string, callbacks: QueueCallbacks): void {
	stoppedTaskIds.add(taskId)
	killTaskProcess(taskId)
	tasksDb.updateTaskStatus(db, taskId, 'backlog')

	for (const [projectId, state] of queues) {
		if (state.active.includes(taskId)) {
			state.active = state.active.filter(id => id !== taskId)
			queues.set(projectId, state)
			callbacks.onQueueUpdated(projectId, { ...state })
			break
		}
	}

	const updated = tasksDb.getTask(db, taskId)
	if (updated) callbacks.onTaskUpdated(updated)
}

export function notifyNewTask(
	db: Database,
	projectId: string,
	project: { name: string; directory: string; description?: string },
	config: KanbanConfig,
	callbacks: QueueCallbacks
): void {
	const state = queues.get(projectId)
	if (state?.isPaused) return
	if (state?.isRunning) {
		fillSlots(db, projectId, project, config, callbacks)
		return
	}
	void startQueue(db, projectId, project, config, callbacks)
}

async function processTask(
	db: Database,
	projectId: string,
	taskId: string,
	project: { name: string; directory: string; description?: string },
	config: KanbanConfig,
	callbacks: QueueCallbacks
): Promise<void> {
	const state = queues.get(projectId)
	if (!state || !state.isRunning) return

	const task = tasksDb.getTask(db, taskId)
	if (!task || task.assignee === 'human') {
		removeFromActive(projectId, taskId)
		fillSlots(db, projectId, project, config, callbacks)
		return
	}

	const comments = commentsDb.listComments(db, taskId)
	const taskConfig = applyTaskOverrides(config, task)

	try {
		const existingPlanOutput = executionsDb.getCompletedPlanOutput(db, taskId) ?? undefined
		const result = await runTask(db, task, project, comments, taskConfig, callbacks, existingPlanOutput ? { existingPlanOutput } : undefined)

		if (consumeStoppedFlag(taskId)) {
			removeFromActive(projectId, taskId)
			fillSlots(db, projectId, project, config, callbacks)
			return
		}

		if (result.success) {
			tasksDb.updateTaskStatus(db, taskId, 'done')
			const updated = tasksDb.getTask(db, taskId)
			if (updated) callbacks.onTaskUpdated(updated)
			removeFromActive(projectId, taskId)
			fillSlots(db, projectId, project, config, callbacks)
		} else if (result.rateLimitInfo?.isRateLimit) {
			handleRateLimited(db, projectId, task, result.rateLimitInfo, project, config, callbacks)
		} else {
			// Retry once
			const retryComments = commentsDb.listComments(db, taskId)
			const retryPlanOutput = executionsDb.getCompletedPlanOutput(db, taskId) ?? undefined
			const retryResult = await runTask(db, task, project, retryComments, taskConfig, callbacks, retryPlanOutput ? { existingPlanOutput: retryPlanOutput } : undefined)

			if (consumeStoppedFlag(taskId)) {
				removeFromActive(projectId, taskId)
				fillSlots(db, projectId, project, config, callbacks)
				return
			}

			if (retryResult.success) {
				tasksDb.updateTaskStatus(db, taskId, 'done')
				const updated = tasksDb.getTask(db, taskId)
				if (updated) callbacks.onTaskUpdated(updated)
				removeFromActive(projectId, taskId)
				fillSlots(db, projectId, project, config, callbacks)
			} else if (retryResult.rateLimitInfo?.isRateLimit) {
				handleRateLimited(db, projectId, task, retryResult.rateLimitInfo, project, config, callbacks)
			} else {
				tasksDb.updateTaskStatus(db, taskId, 'failed')
				const updated = tasksDb.getTask(db, taskId)
				if (updated) callbacks.onTaskUpdated(updated)
				removeFromActive(projectId, taskId)

				if (task.blocking) {
					const queueState = queues.get(projectId)
					if (queueState) {
						for (const qId of queueState.queue) {
							tasksDb.updateTaskStatus(db, qId, 'backlog')
							const resetTask = tasksDb.getTask(db, qId)
							if (resetTask) callbacks.onTaskUpdated(resetTask)
						}
						queueState.isRunning = false
						queueState.queue = []
						queueState.active = []
						queues.set(projectId, queueState)
					}
					callbacks.onQueueStopped(projectId, `Task "${task.title}" failed (blocking)`)
				} else {
					fillSlots(db, projectId, project, config, callbacks)
				}
			}
		}
	} catch (err) {
		console.error(`[kanban-queue] Unexpected error processing task ${taskId}:`, err)
		if (!consumeStoppedFlag(taskId)) {
			tasksDb.updateTaskStatus(db, taskId, 'failed')
			const updated = tasksDb.getTask(db, taskId)
			if (updated) callbacks.onTaskUpdated(updated)
		}
		removeFromActive(projectId, taskId)
		fillSlots(db, projectId, project, config, callbacks)
	}
}

function removeFromActive(projectId: string, taskId: string): void {
	const state = queues.get(projectId)
	if (!state) return
	state.active = state.active.filter(id => id !== taskId)
	queues.set(projectId, state)
}

function fillSlots(
	db: Database,
	projectId: string,
	project: { name: string; directory: string; description?: string },
	config: KanbanConfig,
	callbacks: QueueCallbacks
): void {
	const state = queues.get(projectId)
	if (!state || !state.isRunning || state.isPaused) return

	if (state.queue.length === 0) {
		const newQueued = tasksDb.listQueuedTasks(db).filter(t => !state.active.includes(t.id))
		if (newQueued.length > 0) {
			state.queue = newQueued.map(t => t.id)
		} else if (state.active.length === 0) {
			queues.delete(projectId)
			callbacks.onQueueStopped(projectId, 'All tasks completed')
			return
		} else {
			callbacks.onQueueUpdated(projectId, { ...state })
			return
		}
	}

	const toStart: string[] = []
	while (state.active.length + toStart.length < 1 && state.queue.length > 0) {
		const nextId = state.queue.shift()!
		toStart.push(nextId)
	}

	state.active.push(...toStart)
	queues.set(projectId, state)
	callbacks.onQueueUpdated(projectId, { ...state })

	for (const taskId of toStart) {
		void processTask(db, projectId, taskId, project, config, callbacks)
	}

	if (toStart.length === 0 && state.active.length === 0) {
		queues.delete(projectId)
		callbacks.onQueueStopped(projectId, 'All tasks completed')
	}
}

function handleRateLimited(
	db: Database,
	projectId: string,
	task: tasksDb.Task,
	rateLimitInfo: RateLimitInfo,
	project: { name: string; directory: string; description?: string },
	config: KanbanConfig,
	callbacks: QueueCallbacks
): void {
	tasksDb.updateTaskStatus(db, task.id, 'queue')
	let retrySeconds = 60
	const resetMsg = rateLimitInfo.resetMessage ?? ''
	const match = resetMsg.match(/(\d+)\s*(seconds?|minutes?|hours?)/i)
	if (match && match[1] && match[2]) {
		const val = parseInt(match[1], 10)
		const unit = match[2].toLowerCase()
		retrySeconds = unit.startsWith('minute') ? val * 60 : unit.startsWith('hour') ? val * 3600 : val
	}

	commentsDb.addSystemComment(db, task.id, '', `Rate limited. Retrying in ${retrySeconds}s. ${resetMsg}`)
	callbacks.onRateLimited?.(projectId, task.title, retrySeconds)

	const state = queues.get(projectId)
	if (state) {
		state.isPaused = true
		removeFromActive(projectId, task.id)
		callbacks.onQueueUpdated(projectId, { ...state })
	}

	setTimeout(() => {
		const currentState = queues.get(projectId)
		if (currentState?.isPaused && currentState.isRunning) {
			currentState.isPaused = false
			queues.set(projectId, currentState)
			fillSlots(db, projectId, project, config, callbacks)
		}
	}, retrySeconds * 1000)
}

export function applyTaskOverrides(config: KanbanConfig, task: tasksDb.Task): KanbanConfig {
	let planThinking: 'smart' | 'basic' | null
	if (task.plan_thinking === ('none' as string)) {
		planThinking = null
	} else if (task.plan_thinking !== null && task.plan_thinking !== undefined) {
		planThinking = task.plan_thinking as 'smart' | 'basic'
	} else {
		planThinking = config.planThinking
	}
	return {
		...config,
		planThinking,
		executeThinking: task.execute_thinking ?? config.executeThinking,
		autoCommit: task.auto_commit !== null && task.auto_commit !== undefined ? task.auto_commit : config.autoCommit,
		autoPush: task.auto_push !== null && task.auto_push !== undefined ? task.auto_push : config.autoPush,
		cliProvider: task.cli_provider ?? config.cliProvider,
		cliCustomCommand: task.cli_custom_command ?? config.cliCustomCommand,
		branchMode: task.branch_mode ?? config.branchMode,
		branchName: task.branch_name ?? config.branchName,
	}
}
