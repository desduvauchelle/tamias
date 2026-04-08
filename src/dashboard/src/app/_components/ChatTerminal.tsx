'use client'

import { useState, useEffect, useRef } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

interface ToolDisplayPart {
	type: string
	toolName: string
	state: string
}

interface UIMessageWithImages extends UIMessage {
	_pendingImages?: string[]
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

function formatTimestamp(date: Date): string {
	const now = new Date()
	const isToday = date.toDateString() === now.toDateString()
	const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	if (isToday) return `Today at ${timeStr}`
	const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString()
	if (isYesterday) return `Yesterday at ${timeStr}`
	return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${timeStr}`
}

function UserAvatar() {
	return (
		<div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0 select-none">
			Y
		</div>
	)
}

function AiAvatar() {
	return (
		<div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shrink-0 select-none">
			T
		</div>
	)
}

export default function ChatTerminal({ sessionId, initialHistory = [] }: { sessionId: string, initialHistory?: UIMessage[] }) {
	const [input, setInput] = useState('')
	const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; mimeType: string; base64: string; previewUrl?: string }>>([])
	const fileInputRef = useRef<HTMLInputElement>(null)
	const chatEndRef = useRef<HTMLDivElement>(null)
	const messageTimestamps = useRef<Map<string, Date>>(new Map())

	const chatHook = useChat({
		transport: new DefaultChatTransport({ api: `/api/chat?sessionId=${sessionId}` }),
		messages: initialHistory,
	})
	const { messages, setMessages, sendMessage, status } = chatHook

	// Load history on mount
	const hasLoadedSessionId = useRef<string | null>(null)

	useEffect(() => {
		if (initialHistory.length > 0) return // Already loaded via props
		if (hasLoadedSessionId.current === sessionId) return // Already loaded this session

		let mounted = true
		hasLoadedSessionId.current = sessionId

		fetch(`/api/sessions/${sessionId}`)
			.then(res => res.json())
			.then(data => {
				if (!mounted || !data.messages || data.messages.length === 0) return

				// Transform db messages to UIMessages, spreading timestamps ~1s apart
				const baseTime = Date.now() - (data.messages.length * 1000)
				const uiMessages: UIMessage[] = data.messages.map((m: any, i: number) => {
					const id = m.id || Math.random().toString(36).slice(2)
					messageTimestamps.current.set(id, new Date(baseTime + i * 1000))
					return {
						id,
						role: m.role || 'user',
						parts: [{ type: 'text', text: m.content || m.text || '' }]
					}
				})
				setMessages(uiMessages)
			})
			.catch(err => console.error('Failed to load chat history:', err))

		return () => { mounted = false }
	}, [sessionId]) // removed initialHistory and setMessages as they cause infinite loops

	// Stamp new messages as they arrive
	useEffect(() => {
		for (const msg of messages) {
			if (!messageTimestamps.current.has(msg.id)) {
				messageTimestamps.current.set(msg.id, new Date())
			}
		}
	}, [messages])

	const isLoading = status === 'submitted' || status === 'streaming'

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? [])
		const parsed = await Promise.all(files.map(async (file) => {
			const arrayBuffer = await file.arrayBuffer()
			const base64 = typeof window !== 'undefined' ? btoa(String.fromCharCode(...new Uint8Array(arrayBuffer))) : ''
			const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
			return { name: file.name, mimeType: file.type || 'application/octet-stream', base64, previewUrl }
		}))
		setPendingFiles(prev => [...prev, ...parsed])
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
	}, [messages])

	return (
		<div className="h-full flex flex-col min-h-0 overflow-hidden bg-base-100">
			{/* Message list */}
			<div className="flex-1 overflow-y-auto scroll-smooth custom-scrollbar">
				{messages.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center text-center opacity-40">
						<div className="text-4xl mb-3">⚡</div>
						<p className="text-xs font-mono">Session &quot;{sessionId}&quot; initialized.</p>
					</div>
				) : (
					<div className="py-4">
						{messages.map((message: UIMessage, i: number) => {
							const prevMsg = messages[i - 1]
							const isGrouped = prevMsg?.role === message.role
							const ts = messageTimestamps.current.get(message.id)
							const displayName = message.role === 'user' ? 'You' : 'Tamias'

							return (
								<div
									key={message.id}
									className={`flex gap-4 px-4 hover:bg-base-200/30 transition-colors group ${isGrouped ? 'pt-0.5 pb-0.5' : 'pt-4 pb-0.5'}`}
								>
									{/* Avatar column — always 40px wide */}
									<div className="w-10 shrink-0 flex flex-col items-center pt-0.5">
										{!isGrouped ? (
											message.role === 'user' ? <UserAvatar /> : <AiAvatar />
										) : (
											/* Timestamp hint on hover for grouped messages */
											<span className="text-[10px] text-base-content/30 opacity-0 group-hover:opacity-100 transition-opacity pt-1 w-10 text-center leading-tight">
												{ts ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
											</span>
										)}
									</div>

									{/* Content column */}
									<div className="flex-1 min-w-0">
										{/* Name + timestamp header — only on first in group */}
										{!isGrouped && (
											<div className="flex items-baseline gap-2 mb-1">
												<span className={`font-semibold text-sm ${message.role === 'user' ? 'text-indigo-400' : 'text-emerald-400'}`}>
													{displayName}
												</span>
												{ts && (
													<span className="text-xs text-base-content/35 font-normal">
														{formatTimestamp(ts)}
													</span>
												)}
											</div>
										)}

										{/* Tool invocations */}
										{message.parts?.filter(p => p.type.startsWith('tool-') || p.type === 'dynamic-tool').map((part, idx) => {
											const toolInv = part as unknown as ToolDisplayPart
											const isDone = toolInv.state === 'output-available'
											return (
												<div key={idx} className="flex items-center gap-2 py-0.5 my-0.5 text-xs font-mono text-base-content/60">
													<span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm shrink-0 ${isDone ? 'text-emerald-400' : 'text-amber-400'}`}>
														{isDone ? (
															<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><polyline points="1.5,6 4.5,9 10.5,3" /></svg>
														) : (
															<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3 h-3 animate-spin"><circle cx="6" cy="6" r="4.5" strokeDasharray="7 7" /></svg>
														)}
													</span>
													<span className="opacity-60">Used</span>
													<span className="text-base-content/80 decoration-dotted underline">{toolInv.toolName}</span>
												</div>
											)
										})}

										{/* Text parts */}
										{message.parts?.filter(p => p.type === 'text').map((part: any, idx) => {
											const text = typeof part.text === 'string' ? sanitizeText(part.text) : JSON.stringify(part.text)
											if (!text) return null
											return (
												<p key={idx} className="text-sm text-base-content/90 whitespace-pre-wrap leading-relaxed">
													{text}
												</p>
											)
										})}

										{/* File parts in assistant messages (data-tamias-file) */}
										{message.parts?.filter(p => p.type === 'data-tamias-file').map((part: any, idx) => {
											const { name, mimeType, url } = (part.data ?? {})
											return mimeType?.startsWith('image/') ? (
												<img key={idx} src={url} alt={name} className="max-w-xs max-h-64 rounded-lg mt-2 shadow border border-base-300/30" />
											) : (
												<a
													key={idx}
													href={url}
													download={name}
													className="inline-flex items-center gap-2 mt-1 px-3 py-1.5 rounded-md bg-base-300/40 hover:bg-base-300/70 text-xs font-mono text-base-content/80 transition-colors border border-base-300/30"
												>
													<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
													{name}
												</a>
											)
										})}

										{/* Image attachments on user messages */}
										{message.role === 'user' && (message as UIMessageWithImages)._pendingImages?.map((src: string, idx: number) => (
											<img key={idx} src={src} alt="attachment" className="max-w-xs max-h-48 rounded-lg mt-2 shadow border border-base-300/30" />
										))}
									</div>
								</div>
							)
						})}

						{/* Typing indicator */}
						{isLoading && (
							<div className="flex gap-4 px-4 pt-4 pb-0.5">
								<div className="w-10 shrink-0 flex items-start pt-0.5">
									<AiAvatar />
								</div>
								<div className="flex-1">
									<div className="flex items-baseline gap-2 mb-2">
										<span className="font-semibold text-sm text-emerald-400">Tamias</span>
									</div>
									<div className="flex items-center gap-1 h-5">
										<span className="w-2 h-2 rounded-full bg-base-content/40 animate-bounce" style={{ animationDelay: '0ms' }} />
										<span className="w-2 h-2 rounded-full bg-base-content/40 animate-bounce" style={{ animationDelay: '150ms' }} />
										<span className="w-2 h-2 rounded-full bg-base-content/40 animate-bounce" style={{ animationDelay: '300ms' }} />
									</div>
								</div>
							</div>
						)}
					</div>
				)}
				<div ref={chatEndRef} />
			</div>

			{/* Pending file previews */}
			{pendingFiles.length > 0 && (
				<div className="px-4 pt-2 pb-2 flex flex-wrap gap-2 border-t border-base-300/50 bg-base-200/20">
					{pendingFiles.map((f, idx) => (
						<div key={idx} className="relative group">
							{f.previewUrl ? (
								<img src={f.previewUrl} alt={f.name} className="w-14 h-14 object-cover rounded-lg border border-base-300 shadow" />
							) : (
								<div className="w-14 h-14 rounded-lg border border-base-300 bg-base-300/50 flex flex-col items-center justify-center text-center px-1 shadow">
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

			{/* Input bar */}
			<form onSubmit={handleSubmit} className="px-4 py-3 border-t border-base-300/50 flex gap-2 shrink-0 bg-base-200/10">
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
					className="btn btn-ghost btn-sm btn-square shrink-0 opacity-50 hover:opacity-100"
					title="Attach file"
					disabled={isLoading}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
				</button>
				<input
					type="text"
					className="input input-bordered input-sm grow text-sm focus:input-primary transition-all bg-base-300/20"
					value={input}
					onChange={e => setInput(e.target.value)}
					placeholder={`Message ${sessionId}…`}
					disabled={isLoading}
				/>
				<button
					type="submit"
					disabled={isLoading || !input?.trim()}
					className="btn btn-primary btn-sm text-xs uppercase"
				>
					Send
				</button>
			</form>
		</div>
	)
}
