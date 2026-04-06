"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { KanbanActivity } from "./types"

export type AiLogEntry = { type: 'tool' | 'text' | 'status'; text: string; ts: number; taskId?: string }
export type AiStatus = 'idle' | 'thinking' | 'done' | 'error'

const PROJECT_TOOLS = ['project_update_task', 'project_add_comment', 'project_update_comment']

export function useKanbanAI(onActivityComplete?: (feed: Map<string, AiLogEntry[]>, textOutput: string) => void) {
	const queryClient = useQueryClient()

	const [aiStatus, setAiStatus] = useState<AiStatus>('idle')
	const [aiLog, setAiLog] = useState<AiLogEntry[]>([])
	const [aiTextPreview, setAiTextPreview] = useState('')
	const [aiActiveTaskIds, setAiActiveTaskIds] = useState<Set<string>>(new Set())
	const [aiTaskFeed, setAiTaskFeed] = useState<Map<string, AiLogEntry[]>>(new Map())

	const aiEventSourceRef = useRef<EventSource | null>(null)
	const aiDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const textBufferRef = useRef('')
	// Use a ref so the 'done' handler always has the latest task feed
	const aiTaskFeedRef = useRef<Map<string, AiLogEntry[]>>(new Map())
	const onActivityCompleteRef = useRef(onActivityComplete)
	onActivityCompleteRef.current = onActivityComplete

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			aiEventSourceRef.current?.close()
			if (aiDismissTimerRef.current) clearTimeout(aiDismissTimerRef.current)
		}
	}, [])

	const dismiss = useCallback(() => {
		setAiStatus('idle')
		setAiLog([])
		setAiTextPreview('')
		setAiActiveTaskIds(new Set())
		setAiTaskFeed(new Map())
		aiTaskFeedRef.current = new Map()
		if (aiDismissTimerRef.current) clearTimeout(aiDismissTimerRef.current)
	}, [])

	const stopAI = useCallback(() => {
		if (aiEventSourceRef.current) {
			aiEventSourceRef.current.close()
			aiEventSourceRef.current = null
		}
		if (aiDismissTimerRef.current) clearTimeout(aiDismissTimerRef.current)
		setAiStatus('idle')
		setAiLog([])
		setAiTextPreview('')
		setAiActiveTaskIds(new Set())
		setAiTaskFeed(new Map())
		aiTaskFeedRef.current = new Map()
		textBufferRef.current = ''
	}, [])

	const startWatchingAI = useCallback((projectId: string) => {
		// Clean up any existing stream
		if (aiEventSourceRef.current) {
			aiEventSourceRef.current.close()
			aiEventSourceRef.current = null
		}
		if (aiDismissTimerRef.current) {
			clearTimeout(aiDismissTimerRef.current)
			aiDismissTimerRef.current = null
		}

		setAiStatus('thinking')
		setAiLog([])
		setAiTextPreview('')
		setAiActiveTaskIds(new Set())
		setAiTaskFeed(new Map())
		aiTaskFeedRef.current = new Map()
		textBufferRef.current = ''

		const es = new EventSource(`/api/sessions/project-${projectId}/activity`)
		aiEventSourceRef.current = es

		es.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data)

				if (data.type === 'tool_call') {
					const toolName = data.name || 'unknown_tool'
					const taskId = data.input?.taskId as string | undefined
					const entry: AiLogEntry = { type: 'tool', text: toolName, ts: Date.now(), taskId }

					setAiLog(prev => [...prev, entry])

					// Track active task IDs from project tool calls
					if (taskId && PROJECT_TOOLS.includes(toolName)) {
						setAiActiveTaskIds(prev => new Set(prev).add(taskId))
						const updatedFeed = new Map(aiTaskFeedRef.current)
						const existing = updatedFeed.get(taskId) || []
						updatedFeed.set(taskId, [...existing, entry])
						aiTaskFeedRef.current = updatedFeed
						setAiTaskFeed(updatedFeed)
					}
				} else if (data.type === 'tool_result') {
					// Immediately invalidate projects cache for near-instant UI updates
					if (PROJECT_TOOLS.includes(data.name)) {
						queryClient.invalidateQueries({ queryKey: ['projects'] })
					}
				} else if (data.type === 'chunk' && data.text) {
					textBufferRef.current += data.text
					const buf = textBufferRef.current
					setAiTextPreview(buf.length > 200 ? '...' + buf.slice(-200) : buf)
				} else if (data.type === 'done') {
					setAiStatus('done')
					if (textBufferRef.current.trim()) {
						setAiLog(prev => [...prev, { type: 'status', text: 'Done', ts: Date.now() }])
					}
					es.close()
					aiEventSourceRef.current = null

					// Fire activity-complete callback so callers can persist AI activity to cards
					onActivityCompleteRef.current?.(new Map(aiTaskFeedRef.current), textBufferRef.current)

					// Delay clearing active task indicators so user sees the final state
					aiDismissTimerRef.current = setTimeout(() => {
						setAiActiveTaskIds(new Set())
						setAiTaskFeed(new Map())
						aiTaskFeedRef.current = new Map()
					}, 3000)
					// Auto-dismiss panel after 8 seconds
					setTimeout(() => {
						setAiStatus('idle')
						setAiLog([])
						setAiTextPreview('')
					}, 8000)
				} else if (data.type === 'error') {
					setAiStatus('error')
					setAiLog(prev => [...prev, { type: 'status', text: `Error: ${data.message || 'Unknown error'}`, ts: Date.now() }])
					es.close()
					aiEventSourceRef.current = null
					aiDismissTimerRef.current = setTimeout(() => {
						setAiStatus('idle')
						setAiLog([])
						setAiTextPreview('')
						setAiActiveTaskIds(new Set())
						setAiTaskFeed(new Map())
						aiTaskFeedRef.current = new Map()
					}, 8000)
				}
			} catch { /* ignore malformed */ }
		}

		es.onerror = () => {
			es.close()
			aiEventSourceRef.current = null
		}
	}, [queryClient])

	return {
		aiStatus,
		aiLog,
		aiTextPreview,
		aiActiveTaskIds,
		aiTaskFeed,
		startWatchingAI,
		stopAI,
		dismiss,
	}
}

/** Convert AiLogEntry list to KanbanActivity entries for persistence */
export function logEntriesToActivity(entries: AiLogEntry[]): KanbanActivity[] {
	return entries.map(e => ({
		id: Math.random().toString(36).substring(2, 9),
		type: e.type,
		text: e.text,
		createdAt: e.ts,
	}))
}
