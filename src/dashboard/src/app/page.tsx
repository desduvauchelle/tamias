'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

interface SessionSummary {
	id: string
	name?: string
	channelName?: string
	model?: string
	summary?: string
	messageCount?: number
	queueLength?: number
}

interface HistoryMatchEntry {
	sessionId?: string
}

interface RawMessage {
	id?: string
	role: 'user' | 'assistant' | 'system'
	content: string | unknown[]
	parts?: unknown[]
}

interface ReceivedFile {
	__tamias_file__: true
	name: string
	base64: string
	mimeType?: string
}

interface ToolDisplayPart {
	type: string
	toolName: string
	state: string
}

interface UIMessageWithImages extends UIMessage {
	_pendingImages?: string[]
}

export default function ChatPage() {
	const [sessions, setSessions] = useState<SessionSummary[]>([])
	const [selectedSession, setSelectedSession] = useState('')
	const [history, setHistory] = useState<UIMessage[]>([])
	const [loadingHistory, setLoadingHistory] = useState(false)
	const [sessionSearch, setSessionSearch] = useState('')
	const [mentionMatchedSessionIds, setMentionMatchedSessionIds] = useState<Set<string>>(new Set())
	const [showNewSessionModal, setShowNewSessionModal] = useState(false)
	const [newSessionName, setNewSessionName] = useState('')
	const [newSessionModel, setNewSessionModel] = useState('')
	const [availableModels, setAvailableModels] = useState<string[]>([])
	const [tokenRequired, setTokenRequired] = useState(false)
	const [tokenInput, setTokenInput] = useState('')

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

	useEffect(() => {
		const query = sessionSearch.trim()
		if (!query) {
			setMentionMatchedSessionIds(new Set())
			return
		}

		const controller = new AbortController()
		const timeout = setTimeout(async () => {
			try {
				const res = await fetch(`/api/history?q=${encodeURIComponent(query)}`, { signal: controller.signal })
				const data = await res.json()
				const ids = new Set<string>(
					((data.logs ?? []) as HistoryMatchEntry[])
						.map((entry: HistoryMatchEntry) => entry.sessionId)
						.filter((id: string | undefined): id is string => typeof id === 'string' && id.length > 0)
				)
				setMentionMatchedSessionIds(ids)
			} catch (error) {
				if (!(error instanceof DOMException && error.name === 'AbortError')) {
					console.error('Failed to search history mentions:', error)
					setMentionMatchedSessionIds(new Set())
				}
			}
		}, 250)

		return () => {
			controller.abort()
			clearTimeout(timeout)
		}
	}, [sessionSearch])

	const filteredSessions = useMemo(() => {
		const query = sessionSearch.trim().toLowerCase()
		if (!query) return sessions

		return sessions.filter((session) => {
			const metadata = [
				session.id,
				session.name,
				session.channelName,
				session.model,
				session.summary,
			]
			const metadataMatch = metadata.some(value => value?.toLowerCase().includes(query))
			const mentionMatch = mentionMatchedSessionIds.has(session.id)
			return metadataMatch || mentionMatch
		})
	}, [sessions, sessionSearch, mentionMatchedSessionIds])

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
		if (!sid) {
			setHistory([])
			return
		}
		setLoadingHistory(true)
		try {
			const res = await fetch(`/api/sessions/${sid}`)
			const data = await res.json()
			if (data.messages) {
				const uiMsgs: UIMessage[] = data.messages.map((m: RawMessage, idx: number) => {
					let parts: unknown[] = []
					if (typeof m.content === 'string') {
						parts = [{ type: 'text', text: m.content }]
					} else if (Array.isArray(m.content)) {
						parts = m.content
					} else if (m.parts) {
						parts = m.parts
					}
					return {
						id: m.id ?? String(idx),
						role: m.role,
						content: typeof m.content === 'string' ? m.content : '',
						parts,
					} as UIMessage
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

	const getSessionPrimaryLabel = (session: SessionSummary) => session.name || session.channelName || session.id

	const getSessionSecondaryLabel = (session: SessionSummary) => {
		const contextBits = [session.channelName, session.model].filter(Boolean)
		contextBits.push(session.id)
		return contextBits.join(' • ')
	}

	if (tokenRequired) {
		return (
			<div className="flex flex-col items-center justify-center h-full">
				<div className="bg-base-200 p-6 rounded shadow-lg max-w-md w-full">
					<h2 className="text-xl font-bold mb-4">Token Required</h2>
					<p className="mb-2 text-sm">To access the dashboard, paste the authentication token shown in your terminal after running <code>tamias start</code>.</p>
					<p className="mb-4 text-xs text-base-content/50">You can also run <code>tamias token</code> at any time to retrieve it.</p>
					<input
						className="input input-bordered w-full mb-4 font-mono"
						type="text"
						placeholder="Paste token here..."
						value={tokenInput}
						onChange={e => setTokenInput(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Enter' && tokenInput) {
								document.cookie = `tamias_token=${tokenInput}; path=/; max-age=${60 * 60 * 24 * 7}`
								window.location.reload()
							}
						}}
					/>
					<button
						className="btn btn-primary w-full"
						disabled={!tokenInput.trim()}
						onClick={() => {
							document.cookie = `tamias_token=${tokenInput}; path=/; max-age=${60 * 60 * 24 * 7}`
							window.location.reload()
						}}
					>Submit Token</button>
				</div>
			</div>
		)
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
						<div className="px-3 py-2 border-b border-base-300 shrink-0 bg-base-300/10">
							<input
								type="text"
								placeholder="Search sessions & mentions..."
								className="input input-bordered input-xs w-full font-mono"
								value={sessionSearch}
								onChange={e => setSessionSearch(e.target.value)}
							/>
						</div>
						<div className="flex-1 overflow-y-auto p-2">
							<ul className="menu menu-sm gap-1">
								{/* Ensure selected session is visible if not in list yet */}
								{selectedSession && !filteredSessions.find(s => s.id === selectedSession) && (
									<li key={selectedSession}>
										<button className="active flex items-center justify-between transition-all gap-2">
											<div className="min-w-0 text-left">
												<div className="truncate max-w-32 font-medium">{selectedSession}</div>
												<div className="truncate max-w-32 text-[10px] opacity-60">{selectedSession}</div>
											</div>
											<span className="badge badge-xs bg-base-300 border-none opacity-50">0</span>
										</button>
									</li>
								)}
								{filteredSessions.map(s => (
									<li key={s.id}>
										<button
											className={`${selectedSession === s.id ? 'active' : ''} flex items-center justify-between transition-all gap-2`}
											onClick={() => setSelectedSession(s.id)}
										>
											<div className="min-w-0 text-left">
												<div className="truncate max-w-32 font-medium">{getSessionPrimaryLabel(s)}</div>
												<div className="truncate max-w-32 text-[10px] opacity-60">{getSessionSecondaryLabel(s)}</div>
											</div>
											<span className="badge badge-xs bg-base-300 border-none opacity-50">{s.messageCount ?? s.queueLength ?? 0}</span>
										</button>
									</li>
								))}
								{sessions.length === 0 && !selectedSession && (
									<div className="text-[10px] text-base-content/30 p-4 text-center italic">No active sessions</div>
								)}
								{sessions.length > 0 && filteredSessions.length === 0 && (
									<div className="text-[10px] text-base-content/30 p-4 text-center italic">No sessions match search</div>
								)}
							</ul>
						</div>
					</div>
				</div>

				{/* Main Content Area */}
				<div className="flex-1 min-w-0">
					{!selectedSession ? (
						<div className="flex-1 card bg-base-200 border border-base-300 border-dashed flex flex-col items-center justify-center p-12 text-center shadow-inner">
							<div className="w-16 h-16 rounded-2xl bg-base-300 flex items-center justify-center mb-6 opacity-50">
								<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-base-content"><path d="M21 15a2 2 0 0 1-2 2H7l4-4V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v10z" /><path d="M3 20v-8a2 2 0 0 1 2-2h4l4 4" /><path d="m7 15-4 4" /></svg>
							</div>
							<h3 className="font-bold font-mono text-base-content/70 mb-2">Initialize Connection</h3>
							<p className="text-xs text-base-content/40 font-mono max-w-xs leading-relaxed mb-8">
								Select an active session from the sidebar or initialize a new context to begin communication.
							</p>
							<button
								className="btn btn-outline btn-success btn-sm font-mono uppercase tracking-widest"
								onClick={() => setShowNewSessionModal(true)}
							>
								New Session
							</button>
						</div>
					) : (
						<div className="flex-1 min-w-0 h-full">
							{loadingHistory ? (
								<div className="card h-full bg-base-200 border border-base-300 flex items-center justify-center">
									<span className="loading loading-spinner text-success" />
								</div>
							) : (
								<ChatTerminal key={selectedSession} sessionId={selectedSession} initialHistory={history} />
							)}
						</div>
					)}
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

/** Strip XML-namespace tags injected by some models (e.g. <grok:render …>…</grok:render>) */
function sanitizeText(text: string): string {
	return text
		// Remove paired namespace tags with their content: <ns:tag ...>...</ns:tag>
		.replace(/<[a-z][a-z0-9]*:[a-z][a-z0-9_-]*(?:\s[^>]*)?>[\s\S]*?<\/[a-z][a-z0-9]*:[a-z][a-z0-9_-]*>/g, '')
		// Remove self-closing namespace tags: <ns:tag ... />
		.replace(/<[a-z][a-z0-9]*:[a-z][a-z0-9_-]*(?:\s[^>]*)?\/>/g, '')
		.trim()
}

function ChatTerminal({ sessionId, initialHistory }: { sessionId: string, initialHistory: UIMessage[] }) {
	const [input, setInput] = useState('')
	const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; mimeType: string; base64: string; previewUrl?: string }>>([])
	const fileInputRef = useRef<HTMLInputElement>(null)
	const chatEndRef = useRef<HTMLDivElement>(null)

	const chatHook = useChat({
		transport: new DefaultChatTransport({ api: `/api/chat?sessionId=${sessionId}` }),
		messages: initialHistory,
	})
	const { messages, sendMessage, status } = chatHook

	// Files received from the AI (via 2: data parts in the stream)
	const chatHookWithData = chatHook as typeof chatHook & { data?: ReceivedFile[] }
	const receivedFiles = chatHookWithData.data?.filter(d => d.__tamias_file__ === true) ?? []

	const isLoading = status === 'submitted' || status === 'streaming'

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? [])
		const parsed = await Promise.all(files.map(async (file) => {
			const arrayBuffer = await file.arrayBuffer()
			const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
			const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
			return { name: file.name, mimeType: file.type || 'application/octet-stream', base64, previewUrl }
		}))
		setPendingFiles(prev => [...prev, ...parsed])
		// Reset the input so the same file can be re-attached
		e.target.value = ''
	}

	const removePendingFile = (idx: number) => {
		setPendingFiles(prev => {
			const copy = [...prev]
			if (copy[idx]?.previewUrl) URL.revokeObjectURL(copy[idx].previewUrl!)
			copy.splice(idx, 1)
			return copy
		})
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!input?.trim() || isLoading) return
		const text = input.trim()
		const attachments = pendingFiles.map(f => ({ name: f.name, mimeType: f.mimeType, base64: f.base64 }))
		setInput('')
		setPendingFiles([])
		await sendMessage(
			{ text },
			attachments.length > 0 ? { body: { data: { attachments } } } : undefined
		)
	}

	useEffect(() => {
		chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages, receivedFiles])

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
							<p className="text-xs font-mono">Session &quot;{sessionId}&quot; initialized.</p>
						</div>
					) : (
						messages.map((message: UIMessage) => (
							<div key={message.id} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'} animate-in slide-in-from-bottom-2 duration-300`}>
								<div className="chat-header text-[10px] text-base-content/50 mb-1 uppercase font-bold tracking-tighter">
									{message.role === 'user' ? 'YOU' : 'TAMIASOS'}
								</div>

								{/* Tool invocations */}
								{message.parts?.filter(p => p.type.startsWith('tool-') || p.type === 'dynamic-tool').map((part, idx) => {
									const toolInv = part as unknown as ToolDisplayPart
									return (
										<div key={idx} className="chat-bubble chat-bubble-warning text-[10px] font-mono mb-1 py-1 px-3 min-h-0 max-w-sm">
											<span className="opacity-70 lowercase">executing: </span>
											<span className="font-bold underline decoration-dotted">{toolInv.toolName}</span>
											<span className={`ml-2 ${toolInv.state === 'output-available' ? 'text-success' : 'text-warning'}`}>
												{toolInv.state === 'output-available' ? '✓' : '⟳'}
											</span>
										</div>
									)
								})}

								{/* Text parts */}
								{message.parts?.filter(p => p.type === 'text').map((part, idx) => (
									<div key={idx} className={`chat-bubble font-mono text-xs whitespace-pre-wrap leading-relaxed shadow-sm ${message.role === 'user' ? 'bg-primary text-primary-content' : 'chat-bubble-success'}`}>
										{typeof part.text === 'string' ? sanitizeText(part.text) : JSON.stringify(part.text)}
									</div>
								))}

								{/* Image attachments on user messages */}
								{message.role === 'user' && (message as UIMessageWithImages)._pendingImages?.map((src: string, idx: number) => (
									<img key={idx} src={src} alt="attachment" className="max-w-xs max-h-48 rounded-xl mt-1 shadow" />
								))}
							</div>
						))
					)}

					{/* Files received from AI */}
					{receivedFiles.map((f: ReceivedFile, idx: number) => (
						<div key={idx} className="chat chat-start animate-in slide-in-from-bottom-2 duration-300">
							<div className="chat-header text-[10px] text-base-content/50 mb-1 uppercase font-bold tracking-tighter">TAMIASOS — FILE</div>
							{f.mimeType?.startsWith('image/') ? (
								<img
									src={`data:${f.mimeType};base64,${f.base64}`}
									alt={f.name}
									className="max-w-xs max-h-64 rounded-xl shadow"
								/>
							) : (
								<a
									href={`data:${f.mimeType ?? 'application/octet-stream'};base64,${f.base64}`}
									download={f.name}
									className="chat-bubble chat-bubble-success font-mono text-xs flex items-center gap-2"
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
									{f.name}
								</a>
							)}
						</div>
					))}

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

				{/* Pending file previews */}
				{pendingFiles.length > 0 && (
					<div className="px-4 pt-2 flex flex-wrap gap-2 border-t border-base-300 bg-base-300/10">
						{pendingFiles.map((f, idx) => (
							<div key={idx} className="relative group">
								{f.previewUrl ? (
									<img src={f.previewUrl} alt={f.name} className="w-14 h-14 object-cover rounded-lg border border-base-300 shadow" />
								) : (
									<div className="w-14 h-14 rounded-lg border border-base-300 bg-base-300 flex flex-col items-center justify-center text-center px-1 shadow">
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
										<span className="text-[8px] mt-0.5 truncate w-full text-center">{f.name.slice(0, 8)}</span>
									</div>
								)}
								<button
									type="button"
									onClick={() => removePendingFile(idx)}
									className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-error text-error-content text-[10px] items-center justify-center hidden group-hover:flex shadow"
								>✕</button>
							</div>
						))}
					</div>
				)}

				<form onSubmit={handleSubmit} className="p-4 border-t border-base-300 flex gap-2 shrink-0 bg-base-300/10">
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept="image/*,text/*,application/json,.pdf,.csv,.md,.ts,.js,.py"
						className="hidden"
						onChange={handleFileChange}
					/>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						className="btn btn-ghost btn-sm btn-square shrink-0 opacity-60 hover:opacity-100"
						title="Attach file"
						disabled={isLoading}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
					</button>
					<input
						className="input input-bordered input-sm grow font-mono text-xs focus:input-success transition-all bg-base-300/50"
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
