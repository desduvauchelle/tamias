'use client'

import { useState, useEffect, useRef } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

export default function ChatPage() {
	const [logs, setLogs] = useState('')
	const [sessions, setSessions] = useState<{ id: string; messageCount: number }[]>([])
	const [selectedSession, setSelectedSession] = useState('web')
	const [history, setHistory] = useState<UIMessage[]>([])
	const [loadingHistory, setLoadingHistory] = useState(false)
	const [showNewSessionModal, setShowNewSessionModal] = useState(false)
	const [newSessionName, setNewSessionName] = useState('')
	const [newSessionModel, setNewSessionModel] = useState('')
	const [availableModels, setAvailableModels] = useState<string[]>([])

	// Fetch logs
	useEffect(() => {
		const interval = setInterval(() => {
			fetch('/api/logs')
				.then(res => res.json())
				.then(data => {
					if (data.logs) {
						const logText = data.logs.slice(0, 50).map((l: any) => {
							const time = new Date(l.timestamp).toLocaleTimeString()
							return `[${time}] ${l.sessionId}: ${l.prompt}\n -> ${l.response}`
						}).join('\n\n')
						setLogs(logText)
					}
				})
		}, 3000)
		return () => clearInterval(interval)
	}, [])

	// Fetch sessions list
	useEffect(() => {
		fetchSessions()
		const interval = setInterval(fetchSessions, 5000)
		return () => clearInterval(interval)
	}, [])

	// Fetch available models
	useEffect(() => {
		fetch('/api/models')
			.then(res => res.json())
			.then(data => {
				const models: string[] = []
				for (const conn of data.connections) {
					if (conn.models) {
						models.push(...conn.models.split(',').map((m: string) => m.trim()))
					}
				}
				setAvailableModels([...new Set(models)])
				if (models.length > 0) setNewSessionModel(models[0])
			})
	}, [])

	// Load history when session changes
	useEffect(() => {
		loadSessionHistory(selectedSession)
	}, [selectedSession])

	const fetchSessions = async () => {
		try {
			const res = await fetch('/api/sessions')
			const data = await res.json()
			if (data.sessions) {
				// Sort by updatedAt if available, or just keep order
				setSessions(data.sessions)
			}
		} catch (e) {
			console.error('Failed to fetch sessions:', e)
		}
	}

	const loadSessionHistory = async (sid: string) => {
		setLoadingHistory(true)
		try {
			const res = await fetch(`/api/sessions/${sid}`)
			const data = await res.json()
			if (data.messages) {
				const uiMsgs: UIMessage[] = data.messages.map((m: any, idx: number) => {
					let parts: any[] = []
					if (typeof m.content === 'string') {
						parts = [{ type: 'text', text: m.content }]
					} else if (Array.isArray(m.content)) {
						parts = m.content
					} else if (m.parts) {
						parts = m.parts
					}
					return {
						id: `${sid}-${idx}-${Date.now()}`,
						role: m.role,
						parts,
						createdAt: new Date(),
					}
				})
				setHistory(uiMsgs)
			} else {
				setHistory([])
			}
		} catch (e) {
			console.error('Failed to load history:', e)
			setHistory([])
		} finally {
			setLoadingHistory(false)
		}
	}

	const handleCreateSession = () => {
		if (!newSessionName.trim()) return
		const sid = newSessionName.trim()
		setSelectedSession(sid)
		setShowNewSessionModal(false)
		setNewSessionName('')
	}

	return (
		<div className="h-full flex flex-col p-6 gap-4">
			<div className="flex items-center justify-between shrink-0">
				<h1 className="text-2xl font-bold text-success font-mono">TamiasOS Terminal</h1>
				<div className="badge badge-outline gap-2 font-mono text-xs uppercase opacity-60">
					Session: {selectedSession}
				</div>
			</div>

			<div className="flex flex-1 gap-4 min-h-0">
				{/* Sessions Sidebar */}
				<div className="card w-60 bg-base-200 border border-base-300 flex flex-col shrink-0 overflow-hidden shadow-xl">
					<div className="card-body p-0 flex flex-col min-h-0">
						<div className="px-5 py-3 border-b border-base-300 flex items-center justify-between shrink-0 bg-base-300/30">
							<h2 className="text-xs text-base-content/50 uppercase tracking-wider font-mono font-bold">Sessions</h2>
							<button
								className="btn btn-ghost btn-xs btn-square hover:text-success"
								onClick={() => setShowNewSessionModal(true)}
								title="Start New Session"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-2">
							<ul className="menu menu-sm gap-1">
								{/* Ensure selected session is visible if not in list yet */}
								{!sessions.find(s => s.id === selectedSession) && (
									<li key={selectedSession}>
										<button className="active flex items-center justify-between transition-all">
											<span className="truncate max-w-[120px]">{selectedSession}</span>
											<span className="badge badge-xs bg-base-300 border-none opacity-50">0</span>
										</button>
									</li>
								)}
								{sessions.map(s => (
									<li key={s.id}>
										<button
											className={`${selectedSession === s.id ? 'active' : ''} flex items-center justify-between transition-all`}
											onClick={() => setSelectedSession(s.id)}
										>
											<span className="truncate max-w-[120px]">{s.id}</span>
											<span className="badge badge-xs bg-base-300 border-none opacity-50">{s.messageCount}</span>
										</button>
									</li>
								))}
								{sessions.length === 0 && !selectedSession && (
									<div className="text-[10px] text-base-content/30 p-4 text-center italic">No active sessions</div>
								)}
							</ul>
						</div>
					</div>
				</div>

				{/* Chat Loop - Re-keyed on session switch to ensure hook reset */}
				<div className="flex-1 min-w-0 h-full">
					{loadingHistory ? (
						<div className="card h-full bg-base-200 border border-base-300 flex items-center justify-center">
							<span className="loading loading-spinner text-success" />
						</div>
					) : (
						<ChatTerminal key={selectedSession} sessionId={selectedSession} initialHistory={history} />
					)}
				</div>

				{/* Log Panel */}
				<div className="card w-72 bg-base-200 border border-base-300 flex flex-col shrink-0 overflow-hidden shadow-xl">
					<div className="card-body flex flex-col p-0 min-h-0">
						<div className="px-5 py-3 border-b border-base-300 shrink-0 text-center bg-base-300/30">
							<h2 className="card-title text-sm text-base-content/50 uppercase tracking-wider font-mono inline-block">Episodic Log</h2>
						</div>
						<div className="flex-1 overflow-y-auto bg-base-300/50 p-4 text-[10px] text-success font-mono whitespace-pre-wrap leading-relaxed animate-in fade-in duration-500">
							{logs || 'Waiting for agent activity...'}
						</div>
					</div>
				</div>
			</div>

			{/* New Session Modal */}
			{showNewSessionModal && (
				<div className="modal modal-open">
					<div className="modal-box border border-base-300 shadow-2xl bg-base-200">
						<h3 className="font-bold text-lg mb-4 font-mono text-success">Initialize New Context</h3>
						<div className="space-y-4">
							<div className="form-control">
								<label className="label">
									<span className="label-text font-mono text-xs uppercase opacity-60">Context Identifier</span>
								</label>
								<input
									type="text"
									placeholder="e.g. workspace-analysis"
									className="input input-bordered font-mono focus:input-success bg-base-300"
									value={newSessionName}
									onChange={e => setNewSessionName(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && handleCreateSession()}
									autoFocus
								/>
							</div>
							<div className="form-control">
								<label className="label">
									<span className="label-text font-mono text-xs uppercase opacity-60">Model Protocol (Recommended)</span>
								</label>
								<select
									className="select select-bordered font-mono bg-base-300"
									value={newSessionModel}
									onChange={e => setNewSessionModel(e.target.value)}
								>
									{availableModels.map(m => (
										<option key={m} value={m}>{m}</option>
									))}
								</select>
							</div>
						</div>
						<div className="modal-action">
							<button className="btn btn-ghost font-mono btn-sm" onClick={() => setShowNewSessionModal(false)}>Abort</button>
							<button className="btn btn-success font-mono btn-sm" onClick={handleCreateSession} disabled={!newSessionName.trim()}>Initialize</button>
						</div>
					</div>
					<div className="modal-backdrop bg-black/60 backdrop-blur-sm" onClick={() => setShowNewSessionModal(false)}></div>
				</div>
			)}
		</div>
	)
}

function ChatTerminal({ sessionId, initialHistory }: { sessionId: string, initialHistory: UIMessage[] }) {
	const [input, setInput] = useState('')
	const chatEndRef = useRef<HTMLDivElement>(null)

	const { messages, sendMessage, status } = useChat({
		transport: new DefaultChatTransport({ api: `/api/chat?sessionId=${sessionId}` }),
		messages: initialHistory,
	})

	const isLoading = status === 'submitted' || status === 'streaming'

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!input?.trim() || isLoading) return
		const text = input.trim()
		setInput('')
		await sendMessage({ text })
	}

	useEffect(() => {
		chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages])

	return (
		<div className="card h-full bg-base-200 border border-base-300 flex flex-col min-h-0 overflow-hidden shadow-xl">
			<div className="card-body flex flex-col p-0 min-h-0">
				<div className="px-5 py-3 border-b border-base-300 shrink-0 bg-base-300/30">
					<h2 className="card-title text-sm text-base-content/50 uppercase tracking-wider font-mono">Conversation Context</h2>
				</div>

				<div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
					{messages.length === 0 ? (
						<div className="h-full flex flex-col items-center justify-center text-center opacity-40">
							<div className="text-4xl mb-3">⚡</div>
							<p className="text-xs font-mono">Session "{sessionId}" initialized.</p>
						</div>
					) : (
						messages.map((message: UIMessage) => (
							<div key={message.id} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'} animate-in slide-in-from-bottom-2 duration-300`}>
								<div className="chat-header text-[10px] text-base-content/50 mb-1 uppercase font-bold tracking-tighter">
									{message.role === 'user' ? 'YOU' : 'TAMIASOS'}
								</div>

								{/* Tool invocations */}
								{message.parts?.filter(p => p.type.startsWith('tool-') || p.type === 'dynamic-tool').map((toolInv: any, idx) => (
									<div key={idx} className="chat-bubble chat-bubble-warning text-[10px] font-mono mb-1 py-1 px-3 min-h-0 max-w-sm">
										<span className="opacity-70 lowercase">executing: </span>
										<span className="font-bold underline decoration-dotted">{toolInv.toolName}</span>
										<span className={`ml-2 ${toolInv.state === 'output-available' ? 'text-success' : 'text-warning'}`}>
											{toolInv.state === 'output-available' ? '✓' : '⟳'}
										</span>
									</div>
								))}

								{/* Text parts */}
								{message.parts?.filter(p => p.type === 'text').map((part: any, idx) => (
									<div key={idx} className={`chat-bubble font-mono text-xs whitespace-pre-wrap leading-relaxed shadow-sm ${message.role === 'user' ? 'bg-primary text-primary-content' : 'chat-bubble-success'}`}>
										{typeof part.text === 'string' ? part.text : JSON.stringify(part.text)}
									</div>
								))}
							</div>
						))
					)}
					{isLoading && (
						<div className="chat chat-start">
							<div className="chat-header text-[10px] text-base-content/50 mb-1 uppercase font-bold tracking-tighter">TAMIASOS</div>
							<div className="chat-bubble chat-bubble-success py-2">
								<span className="loading loading-dots loading-xs" />
							</div>
						</div>
					)}
					<div ref={chatEndRef} />
				</div>

				<form onSubmit={handleSubmit} className="p-4 border-t border-base-300 flex gap-2 shrink-0 bg-base-300/10">
					<input
						className="input input-bordered input-sm flex-grow font-mono text-xs focus:input-success transition-all bg-base-300/50"
						value={input}
						onChange={e => setInput(e.target.value)}
						placeholder={`Command input for [${sessionId}]...`}
						disabled={isLoading}
					/>
					<button
						type="submit"
						disabled={isLoading || !input?.trim()}
						className="btn btn-success btn-sm font-mono text-xs uppercase"
					>
						Send
					</button>
				</form>
			</div>
		</div>
	)
}
