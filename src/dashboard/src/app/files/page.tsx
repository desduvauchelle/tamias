'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, useCallback } from 'react'
import { RefreshCw, Folder, File, Image, FileText, FileCode, Download, Edit3, X, ChevronRight, FolderOpen, Pencil, Trash2, Copy, Check } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Modal } from '../_components/Modal'

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileEntry {
	name: string
	isDirectory: boolean
	isFile: boolean
	size: number | null
	path: string
}

interface DirData {
	items: FileEntry[]
	path: string
}

interface FileContent {
	type: 'image' | 'markdown' | 'json' | 'code' | 'text'
	content?: string
	base64?: string
	mimeType?: string
	ext?: string
	size?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
	if (bytes === null) return ''
	if (bytes < 1024) return `${bytes}B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
	return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

function getFileIcon(entry: FileEntry) {
	if (entry.isDirectory) return <Folder className="w-4 h-4 text-warning/80 shrink-0" />
	const ext = entry.name.split('.').pop()?.toLowerCase() || ''
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext))
		return <Image className="w-4 h-4 text-info/80 shrink-0" />
	if (['md', 'markdown'].includes(ext))
		return <FileText className="w-4 h-4 text-success/80 shrink-0" />
	if (['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'yaml', 'yml', 'toml', 'json', 'env'].includes(ext))
		return <FileCode className="w-4 h-4 text-primary/80 shrink-0" />
	return <File className="w-4 h-4 text-base-content/40 shrink-0" />
}

// ─── Column Component ─────────────────────────────────────────────────────────

function Column({
	path,
	selectedIndex,
	isFocused,
	onSelectIndex,
	onFocus,
	onRemove,
	columnRef,
}: {
	path: string
	selectedIndex: number
	isFocused: boolean
	onSelectIndex: (i: number, entry: FileEntry) => void
	onFocus: () => void
	onRemove: (entry: FileEntry) => void
	columnRef: React.RefObject<HTMLDivElement | null>
}) {
	const qc = useQueryClient()
	const queryKey = ['files', path]

	const { data, isLoading, isError } = useQuery<DirData>({
		queryKey,
		queryFn: () =>
			fetch(`/api/files?path=${encodeURIComponent(path)}`).then(r => {
				if (!r.ok) throw new Error('Failed to fetch')
				return r.json()
			}),
		staleTime: 10_000,
	})

	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const [renamingPath, setRenamingPath] = useState<string | null>(null)
	const [renameValue, setRenameValue] = useState('')

	// Scroll selected item into view
	useEffect(() => {
		const el = itemRefs.current[selectedIndex]
		if (el && isFocused) {
			el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
		}
	}, [selectedIndex, isFocused])

	const commitRename = useCallback(async (entryPath: string, value: string) => {
		setRenamingPath(null)
		const trimmed = value.trim()
		if (!trimmed) return
		try {
			const res = await fetch(`/api/files?path=${encodeURIComponent(entryPath)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newName: trimmed }),
			})
			if (!res.ok) throw new Error('Rename failed')
			await qc.invalidateQueries({ queryKey })
		} catch { /* ignore */ }
	}, [qc, queryKey])

	const headerLabel = path === '' ? '~/.tamias' : path.split('/').pop() || path

	return (
		<div
			className={`flex flex-col w-56 shrink-0 border-r border-base-300 h-full ${isFocused ? 'bg-base-200' : 'bg-base-100'}`}
			onClick={onFocus}
		>
			{/* Column header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
				<span className="text-xs font-mono font-bold text-base-content/60 truncate">{headerLabel}</span>
				<button
					className="btn btn-ghost btn-xs p-1 h-auto min-h-0"
					title="Refresh"
					onClick={e => {
						e.stopPropagation()
						qc.invalidateQueries({ queryKey })
					}}
				>
					<RefreshCw className="w-3 h-3" />
				</button>
			</div>

			{/* Items */}
			<div className="flex-1 overflow-y-auto" ref={columnRef}>
				{isLoading && (
					<div className="flex items-center justify-center h-16">
						<span className="loading loading-xs" />
					</div>
				)}
				{isError && (
					<p className="text-xs text-error p-3">Failed to load</p>
				)}
				{data?.items.map((entry, i) => {
					const isActive = i === selectedIndex && isFocused
					const isSelectedUnfocused = i === selectedIndex && !isFocused
					const isRenaming = renamingPath === entry.path
					return (
						<div
							key={entry.path}
							ref={el => { itemRefs.current[i] = el }}
							role="button"
							tabIndex={-1}
							className={`group/row w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors cursor-pointer select-none
								${isActive
									? 'bg-primary text-primary-content'
									: isSelectedUnfocused
										? 'bg-base-300 text-base-content'
										: 'hover:bg-base-200 text-base-content/80'}`}
							onClick={e => {
								if (isRenaming) return
								e.stopPropagation()
								onFocus()
								onSelectIndex(i, entry)
							}}
						>
							{isActive && entry.isDirectory && !isRenaming
								? <FolderOpen className="w-4 h-4 text-warning/80 shrink-0" />
								: getFileIcon(entry)}

							{isRenaming ? (
								<input
									className="flex-1 bg-base-300 text-xs font-mono px-1 py-0.5 rounded border border-primary/60 outline-none text-base-content min-w-0"
									value={renameValue}
									onChange={e => setRenameValue(e.target.value)}
									onKeyDown={e => {
										if (e.key === 'Enter') { e.preventDefault(); void commitRename(entry.path, renameValue) }
										if (e.key === 'Escape') { e.preventDefault(); setRenamingPath(null) }
									}}
									onBlur={() => void commitRename(entry.path, renameValue)}
									onClick={e => e.stopPropagation()}
									autoFocus
								/>
							) : (
								<span className="truncate flex-1">{entry.name}</span>
							)}

							{!isRenaming && (
								<>
									<span className={`text-[10px] font-mono shrink-0 group-hover/row:hidden ${isActive ? 'text-primary-content/50' : 'opacity-40'}`}>
										{formatSize(entry.size)}
									</span>
									{entry.isDirectory && (
										<ChevronRight className={`w-3 h-3 shrink-0 group-hover/row:hidden ${isActive ? 'text-primary-content/50' : 'opacity-40'}`} />
									)}
									<div className="hidden group-hover/row:flex items-center gap-0.5 shrink-0 ml-auto">
										<button
											title="Rename"
											className={`p-0.5 rounded transition-colors ${isActive ? 'hover:bg-primary-content/20 text-primary-content/60 hover:text-primary-content' : 'hover:bg-base-content/15 text-base-content/40 hover:text-base-content'}`}
											onClick={e => {
												e.stopPropagation()
												setRenamingPath(entry.path)
												setRenameValue(entry.name)
											}}
										>
											<Pencil className="w-3 h-3" />
										</button>
										<button
											title="Remove"
											className="p-0.5 rounded hover:bg-error/20 text-base-content/40 hover:text-error transition-colors"
											onClick={e => {
												e.stopPropagation()
												onRemove(entry)
											}}
										>
											<Trash2 className="w-3 h-3" />
										</button>
									</div>
								</>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}

// ─── File Modal ───────────────────────────────────────────────────────────────

function FileModal({
	path,
	name,
	onClose,
}: {
	path: string
	name: string
	onClose: () => void
}) {
	const qc = useQueryClient()
	const queryKey = ['file-content', path]
	const [editing, setEditing] = useState(false)
	const [editContent, setEditContent] = useState('')
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	const fullPath = `~/.tamias/${path}`

	const handleCopyPath = useCallback(() => {
		void navigator.clipboard.writeText(fullPath).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		})
	}, [fullPath])

	const { data, isLoading, isError } = useQuery<FileContent>({
		queryKey,
		queryFn: () =>
			fetch(`/api/files/content?path=${encodeURIComponent(path)}`).then(r => {
				if (!r.ok) throw new Error('Failed to fetch')
				return r.json()
			}),
	})

	const handleDownload = useCallback(() => {
		if (!data) return
		if (data.type === 'image' && data.base64 && data.mimeType) {
			const a = document.createElement('a')
			a.href = `data:${data.mimeType};base64,${data.base64}`
			a.download = name
			a.click()
		} else if (data.content !== undefined) {
			const blob = new Blob([data.content], { type: 'text/plain' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = name
			a.click()
			URL.revokeObjectURL(url)
		}
	}, [data, name])

	const handleSave = useCallback(async () => {
		setSaving(true)
		setSaveError(null)
		try {
			const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: editContent }),
			})
			if (!res.ok) throw new Error('Save failed')
			await qc.invalidateQueries({ queryKey })
			setEditing(false)
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : 'Save failed')
		} finally {
			setSaving(false)
		}
	}, [editContent, path, qc, queryKey])

	const canEdit = data && (data.type === 'markdown' || data.type === 'json' || data.type === 'code' || data.type === 'text')
	const isEditable = canEdit && !editing

	return (
		<Modal
			isOpen={true}
			onClose={onClose}
			className="w-[90vw] max-w-4xl h-[85vh]"
			title={
				<div className="flex items-center gap-3">
					<span className="font-mono text-sm font-bold truncate flex-1 text-base-content/80">{name}</span>
					<div className="flex items-center gap-2 shrink-0">
						{data?.size !== undefined && (
							<span className="text-[10px] font-mono text-base-content/30">{formatSize(data.size)}</span>
						)}
						{canEdit && !editing && (
							<button
								className="btn btn-ghost btn-xs gap-1"
								onClick={() => {
									setEditContent(data?.content || '')
									setEditing(true)
								}}
							>
								<Edit3 className="w-3.5 h-3.5" />
								Edit
							</button>
						)}
						{editing && (
							<>
								<button
									className="btn btn-primary btn-xs gap-1"
									disabled={saving}
									onClick={handleSave}
								>
									{saving ? <span className="loading loading-xs" /> : 'Save'}
								</button>
								<button
									className="btn btn-ghost btn-xs"
									onClick={() => setEditing(false)}
								>
									Cancel
								</button>
							</>
						)}
						<button
							className="btn btn-ghost btn-xs gap-1"
							onClick={handleDownload}
							disabled={isLoading}
						>
							<Download className="w-3.5 h-3.5" />
							Download
						</button>
					</div>
				</div>
			}
			footer={
				<div className="flex items-center gap-2">
					<span className="font-mono text-[11px] text-base-content/40 truncate flex-1">{fullPath}</span>
					<button
						className="btn btn-ghost btn-xs gap-1 shrink-0"
						onClick={handleCopyPath}
						title="Copy path"
					>
						{copied
							? <><Check className="w-3 h-3 text-success" /> Copied!</>
							: <><Copy className="w-3 h-3" /> Copy path</>}
					</button>
				</div>
			}
		>
			<div className="flex-1 flex flex-col min-h-0">
				{isLoading && (
					<div className="flex items-center justify-center h-full">
						<span className="loading loading-md" />
					</div>
				)}
				{isError && <p className="text-error text-sm">Failed to load file content.</p>}
				{saveError && <p className="text-error text-xs mb-2">{saveError}</p>}

				{data && !editing && (
					<>
						{data.type === 'image' && data.base64 && data.mimeType && (
							<div className="flex items-center justify-center h-full">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={`data:${data.mimeType};base64,${data.base64}`}
									alt={name}
									className="max-w-full max-h-full object-contain rounded-lg"
								/>
							</div>
						)}
						{data.type === 'markdown' && data.content !== undefined && (
							<div
								className="prose prose-sm prose-invert max-w-none"
								dangerouslySetInnerHTML={{
									__html: DOMPurify.sanitize(marked.parse(data.content) as string)
								}}
							/>
						)}
						{data.type === 'json' && data.content !== undefined && (
							<pre className="text-xs font-mono text-base-content/80 whitespace-pre-wrap break-words">
								{(() => {
									try { return JSON.stringify(JSON.parse(data.content), null, 2) }
									catch { return data.content }
								})()}
							</pre>
						)}
						{(data.type === 'code' || data.type === 'text') && data.content !== undefined && (
							<pre className="text-xs font-mono text-base-content/80 whitespace-pre-wrap break-words">
								{data.content}
							</pre>
						)}
					</>
				)}

				{data && editing && (
					<textarea
						className="w-full flex-1 font-mono text-xs bg-base-300 rounded-lg p-3 text-base-content resize-none focus:outline-none focus:ring-1 focus:ring-primary border border-base-content/10"
						value={editContent}
						onChange={e => setEditContent(e.target.value)}
						spellCheck={false}
						autoFocus
					/>
				)}
			</div>
		</Modal>
	)
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FilesPage() {
	// columns[i] = { path: string, selectedIndex: number }
	const [columns, setColumns] = useState<{ path: string; selectedIndex: number }[]>([
		{ path: '', selectedIndex: 0 }
	])
	const [focusedCol, setFocusedCol] = useState(0)
	const [modal, setModal] = useState<{ path: string; name: string } | null>(null)
	const [confirmRemove, setConfirmRemove] = useState<{ entry: FileEntry; colPath: string } | null>(null)
	const [removing, setRemoving] = useState(false)
	const columnRefs = useRef<(React.RefObject<HTMLDivElement | null>)[]>([])
	const containerRef = useRef<HTMLDivElement>(null)

	// Keep columnRefs in sync
	while (columnRefs.current.length < columns.length) {

		columnRefs.current.push({ current: null })
	}
	columnRefs.current = columnRefs.current.slice(0, columns.length)

	// Query client for keyboard-triggered refreshes
	const qc = useQueryClient()

	// Get items for focused column from cache
	const getFocusedItems = useCallback(() => {
		const col = columns[focusedCol]
		if (!col) return []
		const cached = qc.getQueryData<DirData>(['files', col.path])
		return cached?.items || []
	}, [columns, focusedCol, qc])

	const openEntry = useCallback((colIndex: number, itemIndex: number, entry: FileEntry) => {
		if (entry.isDirectory) {
			// Add or replace next column
			setColumns(prev => {
				const next = prev.slice(0, colIndex + 1)
				next[colIndex] = { ...next[colIndex], selectedIndex: itemIndex }
				next.push({ path: entry.path, selectedIndex: 0 })
				return next
			})
			setFocusedCol(colIndex + 1)
		} else {
			// Open file modal
			setColumns(prev => {
				const next = [...prev]
				next[colIndex] = { ...next[colIndex], selectedIndex: itemIndex }
				return next.slice(0, colIndex + 1)
			})
			setModal({ path: entry.path, name: entry.name })
		}
	}, [])

	const handleConfirmRemove = useCallback(async () => {
		if (!confirmRemove) return
		setRemoving(true)
		try {
			const res = await fetch(`/api/files?path=${encodeURIComponent(confirmRemove.entry.path)}`, {
				method: 'DELETE',
			})
			if (!res.ok) throw new Error('Remove failed')
			await qc.invalidateQueries({ queryKey: ['files', confirmRemove.colPath] })
			// Trim any open child columns that were inside the removed entry
			const entryPath = confirmRemove.entry.path
			setColumns(prev => {
				const cutIdx = prev.findIndex(c => c.path === entryPath || c.path.startsWith(entryPath + '/'))
				return cutIdx >= 0 ? prev.slice(0, cutIdx) : prev
			})
			setConfirmRemove(null)
		} catch { /* ignore */ } finally {
			setRemoving(false)
		}
	}, [confirmRemove, qc])

	// Keyboard navigation
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			// Don't interfere if modal is open
			if (modal) return
			// Let confirm modal handle Escape
			if (confirmRemove) {
				if (e.key === 'Escape') setConfirmRemove(null)
				return
			}
			const tag = (e.target as HTMLElement).tagName
			if (tag === 'INPUT' || tag === 'TEXTAREA') return

			const col = columns[focusedCol]
			if (!col) return
			const items = getFocusedItems()

			if (e.key === 'ArrowDown') {
				e.preventDefault()
				const next = Math.min(col.selectedIndex + 1, items.length - 1)
				setColumns(prev => {
					const updated = [...prev]
					updated[focusedCol] = { ...updated[focusedCol], selectedIndex: next }
					// Remove columns to the right if selection changed
					return updated.slice(0, focusedCol + 1)
				})
			} else if (e.key === 'ArrowUp') {
				e.preventDefault()
				const next = Math.max(col.selectedIndex - 1, 0)
				setColumns(prev => {
					const updated = [...prev]
					updated[focusedCol] = { ...updated[focusedCol], selectedIndex: next }
					return updated.slice(0, focusedCol + 1)
				})
			} else if (e.key === 'ArrowRight') {
				e.preventDefault()
				const entry = items[col.selectedIndex]
				if (entry?.isDirectory) {
					openEntry(focusedCol, col.selectedIndex, entry)
				} else if (entry?.isFile) {
					setModal({ path: entry.path, name: entry.name })
				}
			} else if (e.key === 'ArrowLeft') {
				e.preventDefault()
				if (focusedCol > 0) {
					setFocusedCol(focusedCol - 1)
					setColumns(prev => prev.slice(0, focusedCol))
				}
			} else if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault()
				const entry = items[col.selectedIndex]
				if (entry?.isDirectory) {
					openEntry(focusedCol, col.selectedIndex, entry)
				} else if (entry?.isFile) {
					setModal({ path: entry.path, name: entry.name })
				}
			} else if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				qc.invalidateQueries({ queryKey: ['files', col.path] })
			} else if (e.key === 'Delete') {
				e.preventDefault()
				const entry = items[col.selectedIndex]
				if (entry) setConfirmRemove({ entry, colPath: col.path })
			}
		}

		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [modal, confirmRemove, columns, focusedCol, getFocusedItems, openEntry, qc, setConfirmRemove])

	// Auto-scroll container so focused column is visible
	useEffect(() => {
		const colEl = columnRefs.current[focusedCol]?.current
		if (colEl && containerRef.current) {
			colEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
		}
	}, [focusedCol])

	return (
		<div className="flex flex-col h-full">
			{/* Page header */}
			<div className="px-6 py-4 border-b border-base-300 shrink-0">
				<h1 className="text-lg font-bold font-mono text-base-content">
					File Navigator
					<span className="ml-3 text-xs font-normal text-base-content/30">~/.tamias</span>
				</h1>
				<p className="text-xs text-base-content/40 mt-0.5">
					Arrow keys to navigate · Enter / Space to open · ← to go back · ⌘R to refresh · Del to remove · hover item for rename / remove
				</p>
			</div>

			{/* Columns */}
			<div
				ref={containerRef}
				className="flex-1 flex flex-row overflow-x-auto overflow-y-hidden"
				tabIndex={-1}
				onFocus={() => {
					// focus capture on container doesn't steal from children
				}}
			>
				{columns.map((col, colIndex) => (
					<Column
						key={`col-${colIndex}-${col.path}`}
						path={col.path}
						selectedIndex={col.selectedIndex}
						isFocused={colIndex === focusedCol}
						columnRef={columnRefs.current[colIndex]}
						onFocus={() => setFocusedCol(colIndex)}
						onSelectIndex={(i, entry) => {
							openEntry(colIndex, i, entry)
						}}
						onRemove={entry => {
							setConfirmRemove({ entry, colPath: col.path })
						}}
					/>
				))}

				{/* Empty space filler */}
				<div className="flex-1 min-w-[2rem] bg-base-100" />
			</div>

			{/* File modal */}
			{modal && (
				<FileModal
					path={modal.path}
					name={modal.name}
					onClose={() => setModal(null)}
				/>
			)}

			{/* Confirm remove modal */}
			<Modal
				isOpen={!!confirmRemove}
				onClose={() => setConfirmRemove(null)}
				className="w-96"
				title={
					<h3 className="font-bold text-sm font-mono">
						Remove {confirmRemove?.entry.isDirectory ? 'folder' : 'file'}?
					</h3>
				}
				footer={
					<div className="flex justify-end gap-2">
						<button
							className="btn btn-ghost btn-sm"
							onClick={() => setConfirmRemove(null)}
							disabled={removing}
						>
							Cancel
						</button>
						<button
							className="btn btn-error btn-sm"
							onClick={() => void handleConfirmRemove()}
							disabled={removing}
						>
							{removing ? <span className="loading loading-xs" /> : 'Remove'}
						</button>
					</div>
				}
			>
				{confirmRemove && (
					<div>
						<p className="text-xs text-base-content/60 mb-1">
							<span className="font-mono text-base-content/80 break-all">{confirmRemove.entry.name}</span>
							{' '}will be permanently deleted.
						</p>
						{confirmRemove.entry.isDirectory && (
							<p className="text-xs text-warning/80 mb-4">All contents inside will be removed.</p>
						)}
						{!confirmRemove.entry.isDirectory && <div className="mb-4" />}
					</div>
				)}
			</Modal>
		</div>
	)
}
