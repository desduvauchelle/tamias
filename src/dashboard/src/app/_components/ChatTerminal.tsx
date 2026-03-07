'use client'

import { useState, useEffect, useRef } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

interface ToolDisplayPart {
	type: string
	toolName: string
	state: string
}

interface ReceivedFile {
	__tamias_file__: true
	name: string
	base64: string
	mimeType?: string
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

export default function ChatTerminal({ sessionId, initialHistory = [] }: { sessionId: string, initialHistory?: UIMessage[] }) {
	const [input, setInput] = useState('')
	const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; mimeType: string; base64: string; previewUrl?: string }>>([])
	const fileInputRef = useRef<HTMLInputElement>(null)
	const chatEndRef = useRef<HTMLDivElement>(null)

	const chatHook = useChat({
		transport: new DefaultChatTransport({ api: `/api/chat?sessionId=${sessionId}` }),
		messages: initialHistory,
	})
	const { messages, setMessages, sendMessage, status } = chatHook

	// Load history on mount
	useEffect(() => {
		if (initialHistory.length > 0) return // Already loaded via props
		let mounted = true
		fetch(`/api/sessions/${sessionId}`)
			.then(res => res.json())
			.then(data => {
				if (!mounted || !data.messages || data.messages.length === 0) return

				// Transform db messages to UIMessages
				const uiMessages: UIMessage[] = data.messages.map((m: any) => ({
					id: m.id || Math.random().toString(36).slice(2),
					role: m.role || 'user',
					parts: [{ type: 'text', text: m.content || m.text || '' }]
				}))
				setMessages(uiMessages)
			})
			.catch(err => console.error('Failed to load chat history:', err))
		return () => { mounted = false }
	}, [sessionId, initialHistory, setMessages])

	// Files received from the AI (via 2: data parts in the stream)
	const chatHookWithData = chatHook as typeof chatHook & { data?: ReceivedFile[] }
	const receivedFiles = chatHookWithData.data?.filter(d => d.__tamias_file__ === true) ?? []

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
	}, [messages, receivedFiles])

	return (
		<div className="card h-full bg-base-100 flex flex-col min-h-0 overflow-hidden">
			<div className="card-body flex flex-col p-0 min-h-0">
				<div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth custom-scrollbar">
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
								{message.parts?.filter(p => p.type === 'text').map((part: any, idx) => (
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

				<form onSubmit={handleSubmit} className="p-4 border-t border-base-300 flex gap-2 shrink-0 bg-base-300/5">
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
						className="input input-bordered input-sm grow font-mono text-xs focus:input-success transition-all bg-base-300/20"
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
