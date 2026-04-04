"use client"

import { useState, useEffect, useCallback } from "react"
import { useToast } from "../_components/ToastProvider"
import { Brain, Search, Plus, Trash2, Tag, Database, FileText, ChevronLeft, ChevronRight, X } from "lucide-react"

interface VectorMemory {
	id: string
	text: string
	source: string
	tags: string[]
	createdAt: string
	score?: number
}

interface VectorStats {
	count: number
	sizeBytes: number
	oldestEntry: string | null
	newestEntry: string | null
	enabled?: boolean
}

interface Filters {
	sources: string[]
	tags: string[]
}

const PAGE_SIZE = 30

export default function MemoryPage() {
	const [activeTab, setActiveTab] = useState<"vectors" | "persona">("vectors")

	// Vector state
	const [memories, setMemories] = useState<VectorMemory[]>([])
	const [total, setTotal] = useState(0)
	const [stats, setStats] = useState<VectorStats | null>(null)
	const [filters, setFilters] = useState<Filters>({ sources: [], tags: [] })
	const [selected, setSelected] = useState<VectorMemory | null>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [isSearchMode, setIsSearchMode] = useState(false)
	const [filterSource, setFilterSource] = useState("")
	const [filterTag, setFilterTag] = useState("")
	const [offset, setOffset] = useState(0)
	const [loading, setLoading] = useState(true)

	// Add modal
	const [showAddModal, setShowAddModal] = useState(false)
	const [addText, setAddText] = useState("")
	const [addSource, setAddSource] = useState("manual")
	const [addTags, setAddTags] = useState("")
	const [addLoading, setAddLoading] = useState(false)

	// Persona state
	const [personaFiles, setPersonaFiles] = useState<string[]>([])
	const [activeFile, setActiveFile] = useState<string | null>(null)
	const [fileContent, setFileContent] = useState("")
	const [fileDirty, setFileDirty] = useState(false)
	const [fileSaving, setFileSaving] = useState(false)

	const { success, error } = useToast()

	const fetchStats = useCallback(async () => {
		try {
			const res = await fetch("/api/vectors/stats")
			if (res.ok) setStats(await res.json())
		} catch { /* ignore */ }
	}, [])

	const fetchMemories = useCallback(async () => {
		setLoading(true)
		try {
			const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) })
			if (filterSource) params.set("source", filterSource)
			if (filterTag) params.set("tag", filterTag)
			const res = await fetch(`/api/vectors?${params}`)
			if (res.ok) {
				const data = await res.json()
				setMemories(data.entries || [])
				setTotal(data.total || 0)
				if (data.filters) setFilters(data.filters)
			}
		} catch { /* ignore */ }
		setLoading(false)
	}, [offset, filterSource, filterTag])

	const doSearch = useCallback(async () => {
		if (!searchQuery.trim()) {
			setIsSearchMode(false)
			fetchMemories()
			return
		}
		setIsSearchMode(true)
		setLoading(true)
		try {
			const params = new URLSearchParams({ q: searchQuery, topK: "20", minScore: "0.2" })
			const res = await fetch(`/api/vectors/search?${params}`)
			if (res.ok) {
				const data = await res.json()
				setMemories(data.results || [])
				setTotal(data.results?.length || 0)
			}
		} catch { /* ignore */ }
		setLoading(false)
	}, [searchQuery, fetchMemories])

	useEffect(() => { fetchStats() }, [fetchStats])
	useEffect(() => {
		if (!isSearchMode) fetchMemories()
	}, [fetchMemories, isSearchMode])

	const handleSearchKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") doSearch()
		if (e.key === "Escape") {
			setSearchQuery("")
			setIsSearchMode(false)
		}
	}

	const handleAdd = async () => {
		if (!addText.trim()) { error("Text is required"); return }
		setAddLoading(true)
		try {
			const tags = addTags.split(",").map(t => t.trim()).filter(Boolean)
			const res = await fetch("/api/vectors", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: addText, source: addSource, tags }),
			})
			if (res.ok) {
				success("Memory saved")
				setShowAddModal(false)
				setAddText("")
				setAddSource("manual")
				setAddTags("")
				fetchStats()
				fetchMemories()
			} else {
				const d = await res.json()
				error(d.error || "Failed to save")
			}
		} catch { error("Failed to save memory") }
		setAddLoading(false)
	}

	const handleDelete = async (id: string) => {
		if (!confirm("Delete this memory permanently?")) return
		try {
			const res = await fetch(`/api/vectors?id=${id}`, { method: "DELETE" })
			if (res.ok) {
				success("Memory deleted")
				if (selected?.id === id) setSelected(null)
				fetchStats()
				fetchMemories()
			} else {
				error("Failed to delete")
			}
		} catch { error("Failed to delete memory") }
	}

	// Persona file handlers
	const fetchPersonaFiles = async () => {
		try {
			const res = await fetch("/api/memory")
			if (res.ok) {
				const data = await res.json()
				setPersonaFiles(data.files || [])
			}
		} catch { /* ignore */ }
	}

	const loadFile = async (file: string) => {
		try {
			const res = await fetch(`/api/memory?file=${file}`)
			if (res.ok) {
				const data = await res.json()
				setFileContent(data.content || "")
				setActiveFile(file)
				setFileDirty(false)
			}
		} catch { error("Failed to load file") }
	}

	const saveFile = async () => {
		if (!activeFile) return
		setFileSaving(true)
		try {
			const res = await fetch("/api/memory", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ file: activeFile, content: fileContent }),
			})
			if (res.ok) {
				success("File saved")
				setFileDirty(false)
			} else {
				error("Failed to save file")
			}
		} catch { error("Failed to save file") }
		setFileSaving(false)
	}

	useEffect(() => {
		if (activeTab === "persona") fetchPersonaFiles()
	}, [activeTab])

	const formatBytes = (b: number) => {
		if (b < 1024) return `${b} B`
		if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
		return `${(b / (1024 * 1024)).toFixed(1)} MB`
	}

	const formatDate = (iso: string | null) => {
		if (!iso) return "—"
		return new Date(iso).toLocaleDateString()
	}

	return (
		<div className="flex flex-col h-full gap-4 p-6 font-mono">
			{/* Stats Bar */}
			{stats && (
				<div className="flex items-center gap-6 px-4 py-3 bg-base-200/50 rounded-box border border-base-300/50 text-xs">
					<div className="flex items-center gap-2">
						<Database className="w-3.5 h-3.5 text-primary opacity-60" />
						<span className="opacity-50">Entries</span>
						<span className="font-bold">{stats.count}</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="opacity-50">Size</span>
						<span className="font-bold">{formatBytes(stats.sizeBytes)}</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="opacity-50">Oldest</span>
						<span className="font-bold">{formatDate(stats.oldestEntry)}</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="opacity-50">Newest</span>
						<span className="font-bold">{formatDate(stats.newestEntry)}</span>
					</div>
				</div>
			)}

			{/* Tabs */}
			<div className="tabs tabs-boxed bg-base-200/50 w-fit">
				<button
					className={`tab tab-sm ${activeTab === "vectors" ? "tab-active" : ""}`}
					onClick={() => setActiveTab("vectors")}
				>
					<Brain className="w-3.5 h-3.5 mr-1.5" /> Vector Memories
				</button>
				<button
					className={`tab tab-sm ${activeTab === "persona" ? "tab-active" : ""}`}
					onClick={() => setActiveTab("persona")}
				>
					<FileText className="w-3.5 h-3.5 mr-1.5" /> Persona Files
				</button>
			</div>

			{/* Content */}
			{activeTab === "vectors" ? (
				<div className="flex flex-1 gap-4 min-h-0">
					{/* Left panel: list */}
					<div className="w-1/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
						{/* Search + filters */}
						<div className="p-3 border-b border-base-200/50 space-y-2">
							<div className="flex items-center gap-2">
								<div className="relative flex-1">
									<Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
									<input
										type="text"
										placeholder="Semantic search..."
										className="input input-bordered input-sm w-full pl-8 text-xs"
										value={searchQuery}
										onChange={e => setSearchQuery(e.target.value)}
										onKeyDown={handleSearchKeyDown}
									/>
									{searchQuery && (
										<button
											className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
											onClick={() => { setSearchQuery(""); setIsSearchMode(false) }}
										>
											<X className="w-3 h-3" />
										</button>
									)}
								</div>
								<button
									className="btn btn-sm btn-primary btn-square"
									onClick={() => setShowAddModal(true)}
									title="Add Memory"
								>
									<Plus className="w-4 h-4" />
								</button>
							</div>

							{!isSearchMode && (
								<div className="flex gap-2">
									<select
										className="select select-bordered select-xs flex-1 text-xs"
										value={filterSource}
										onChange={e => { setFilterSource(e.target.value); setOffset(0) }}
									>
										<option value="">All sources</option>
										{filters.sources.map(s => <option key={s} value={s}>{s}</option>)}
									</select>
									<select
										className="select select-bordered select-xs flex-1 text-xs"
										value={filterTag}
										onChange={e => { setFilterTag(e.target.value); setOffset(0) }}
									>
										<option value="">All tags</option>
										{filters.tags.map(t => <option key={t} value={t}>{t}</option>)}
									</select>
								</div>
							)}
						</div>

						{/* Memory list */}
						<div className="flex-1 overflow-y-auto">
							{loading ? (
								<div className="flex justify-center p-8">
									<span className="loading loading-spinner loading-sm" />
								</div>
							) : memories.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-full text-center p-6 opacity-40">
									<Brain className="w-8 h-8 mb-2" />
									<p className="text-sm">{isSearchMode ? "No matches found" : "No memories yet"}</p>
								</div>
							) : (
								<div className="p-1.5 space-y-0.5">
									{memories.map(m => (
										<button
											key={m.id}
											className={`w-full text-left p-2.5 rounded-lg transition-colors text-xs ${selected?.id === m.id ? "bg-primary/10 border border-primary/20" : "hover:bg-base-200/50 border border-transparent"}`}
											onClick={() => setSelected(m)}
										>
											<p className="line-clamp-2 leading-relaxed">{m.text}</p>
											<div className="flex items-center gap-2 mt-1.5">
												<span className="badge badge-xs badge-ghost">{m.source}</span>
												{m.score !== undefined && (
													<span className="badge badge-xs badge-accent badge-outline">{(m.score * 100).toFixed(0)}%</span>
												)}
												<span className="opacity-30 ml-auto">{m.createdAt?.split("T")[0]}</span>
											</div>
										</button>
									))}
								</div>
							)}
						</div>

						{/* Pagination */}
						{!isSearchMode && total > PAGE_SIZE && (
							<div className="flex items-center justify-between p-2 border-t border-base-200/50 text-xs">
								<button
									className="btn btn-xs btn-ghost"
									disabled={offset === 0}
									onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
								>
									<ChevronLeft className="w-3 h-3" /> Prev
								</button>
								<span className="opacity-40">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
								<button
									className="btn btn-xs btn-ghost"
									disabled={offset + PAGE_SIZE >= total}
									onClick={() => setOffset(offset + PAGE_SIZE)}
								>
									Next <ChevronRight className="w-3 h-3" />
								</button>
							</div>
						)}
					</div>

					{/* Right panel: detail */}
					<div className="w-2/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
						{selected ? (
							<div className="flex flex-col h-full">
								<div className="p-4 border-b border-base-200/50 flex items-start justify-between">
									<div className="space-y-1.5">
										<p className="text-[10px] font-mono opacity-30 select-all">{selected.id}</p>
										<div className="flex items-center gap-2 text-xs">
											<span className="badge badge-sm badge-ghost">{selected.source}</span>
											<span className="opacity-40">{formatDate(selected.createdAt)}</span>
											{selected.score !== undefined && (
												<span className="badge badge-sm badge-accent badge-outline">{(selected.score * 100).toFixed(0)}% match</span>
											)}
										</div>
									</div>
									<button
										className="btn btn-sm btn-error btn-outline"
										onClick={() => handleDelete(selected.id)}
									>
										<Trash2 className="w-3.5 h-3.5" /> Delete
									</button>
								</div>

								{selected.tags.length > 0 && (
									<div className="px-4 py-2 border-b border-base-200/50 flex items-center gap-2 flex-wrap">
										<Tag className="w-3 h-3 opacity-40" />
										{selected.tags.map(t => (
											<span key={t} className="badge badge-sm badge-primary badge-outline">{t}</span>
										))}
									</div>
								)}

								<div className="flex-1 overflow-y-auto p-4">
									<p className="whitespace-pre-wrap text-sm leading-relaxed">{selected.text}</p>
								</div>
							</div>
						) : (
							<div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-40">
								<Brain className="w-12 h-12 mb-3" />
								<h3 className="text-lg font-bold mb-1">Semantic Memory</h3>
								<p className="text-sm max-w-sm">
									Browse and manage the AI&apos;s long-term vector memory. Select a memory from the list to view details, or use semantic search to find relevant entries.
								</p>
							</div>
						)}
					</div>
				</div>
			) : (
				/* Persona Files tab */
				<div className="flex flex-1 gap-4 min-h-0">
					{/* Left panel: file list */}
					<div className="w-1/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
						<div className="p-3 border-b border-base-200/50">
							<h3 className="text-sm font-semibold flex items-center gap-2">
								<FileText className="w-4 h-4 text-primary" /> Template Files
							</h3>
							<p className="text-[10px] opacity-40 mt-1">Persona templates used for system prompt assembly</p>
						</div>
						<div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
							{personaFiles.map(f => (
								<button
									key={f}
									className={`w-full text-left p-2.5 rounded-lg transition-colors text-xs flex items-center gap-2 ${activeFile === f ? "bg-primary/10 border border-primary/20" : "hover:bg-base-200/50 border border-transparent"}`}
									onClick={() => loadFile(f)}
								>
									<FileText className="w-3.5 h-3.5 opacity-40" />
									{f}
								</button>
							))}
							{personaFiles.length === 0 && (
								<p className="text-xs text-center py-8 opacity-30">No template files found</p>
							)}
						</div>
					</div>

					{/* Right panel: editor */}
					<div className="w-2/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
						{activeFile ? (
							<>
								<div className="p-3 border-b border-base-200/50 flex items-center justify-between">
									<div className="flex items-center gap-2 text-sm font-semibold">
										<FileText className="w-4 h-4 text-primary" />
										{activeFile}
										{fileDirty && <span className="badge badge-xs badge-warning">unsaved</span>}
									</div>
									<button
										className="btn btn-sm btn-primary"
										disabled={!fileDirty || fileSaving}
										onClick={saveFile}
									>
										{fileSaving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
									</button>
								</div>
								<textarea
									className="flex-1 p-4 bg-transparent resize-none font-mono text-xs leading-relaxed focus:outline-none"
									value={fileContent}
									onChange={e => { setFileContent(e.target.value); setFileDirty(true) }}
									spellCheck={false}
								/>
							</>
						) : (
							<div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-40">
								<FileText className="w-12 h-12 mb-3" />
								<h3 className="text-lg font-bold mb-1">Persona Templates</h3>
								<p className="text-sm max-w-sm">
									Edit the markdown templates that define the AI&apos;s identity, user profile, protocol, and settings. Select a file from the list.
								</p>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Add Memory Modal */}
			{showAddModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="bg-base-100 rounded-box border border-base-300 w-full max-w-lg p-6 space-y-4">
						<h3 className="font-bold text-lg flex items-center gap-2">
							<Plus className="w-5 h-5 text-primary" /> Add Memory
						</h3>

						<div className="form-control">
							<label className="label"><span className="label-text text-xs">Memory text</span></label>
							<textarea
								className="textarea textarea-bordered text-sm h-32"
								placeholder="Enter the fact, insight, or knowledge to remember..."
								value={addText}
								onChange={e => setAddText(e.target.value)}
							/>
						</div>

						<div className="flex gap-3">
							<div className="form-control flex-1">
								<label className="label"><span className="label-text text-xs">Source</span></label>
								<input
									className="input input-bordered input-sm text-xs"
									placeholder="manual"
									value={addSource}
									onChange={e => setAddSource(e.target.value)}
								/>
							</div>
							<div className="form-control flex-1">
								<label className="label"><span className="label-text text-xs">Tags (comma-separated)</span></label>
								<input
									className="input input-bordered input-sm text-xs"
									placeholder="architecture, decision"
									value={addTags}
									onChange={e => setAddTags(e.target.value)}
								/>
							</div>
						</div>

						<div className="flex justify-end gap-2 pt-2">
							<button className="btn btn-sm btn-ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
							<button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={addLoading}>
								{addLoading ? <span className="loading loading-spinner loading-xs" /> : "Save Memory"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
