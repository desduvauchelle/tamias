"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { Menu, FolderOpen, Check } from "lucide-react"
import Nav from "./Nav"
import { useToast } from "./ToastProvider"
import UpdateBanner from "./UpdateBanner"

export default function LayoutClient({ children }: { children: React.ReactNode }) {
	const pathname = usePathname()
	const { success, error } = useToast()

	// Onboarding gets a clean layout — no sidebar, no drawer
	if (pathname?.startsWith('/onboarding')) {
		return <>{children}</>
	}
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [channels, setChannels] = useState<{ id: string, name: string, guildName: string, guildId: string }[]>([])

	// Form State
	const [formName, setFormName] = useState("")
	const [formPath, setFormPath] = useState("")
	const [pathManuallyEdited, setPathManuallyEdited] = useState(false)
	const [formDesc, setFormDesc] = useState("")
	const [formChannel, setFormChannel] = useState("")
	const [formContext, setFormContext] = useState("readme.md")

	useEffect(() => {
		if (isModalOpen) {
			fetch('/api/discord/channels')
				.then(r => r.json())
				.then(data => setChannels(data.channels || []))
				.catch(console.error)
		}
	}, [isModalOpen])

	const handleNameChange = (value: string) => {
		setFormName(value)
		if (!pathManuallyEdited) {
			const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
			setFormPath(slug || '')
		}
	}

	const handleSaveProject = async () => {
		if (!formName || !formPath) {
			error("Name and Path are required")
			return
		}

		const selectedChannel = channels.find(c => c.id === formChannel)

		try {
			const res = await fetch(`/api/projects`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: formName,
					description: formDesc,
					path: formPath,
					discordChannelId: selectedChannel?.id || undefined,
					discordServerId: selectedChannel?.guildId || undefined,
					contextFile: formContext
				})
			})

			if (res.ok) {
				success("Project saved!")
				setIsModalOpen(false)
				setFormName("")
				setFormPath("")
				setPathManuallyEdited(false)
				setFormDesc("")
				setFormChannel("")
				setFormContext("readme.md")
				// Notify Nav to refresh its list
				window.dispatchEvent(new CustomEvent('refreshProjects'))
			} else {
				const errorData = await res.json()
				error(errorData.error || "Failed to save project")
			}
		} catch (err: any) {
			error(err.message || "An error occurred")
		}
	}

	return (
		<div className="drawer lg:drawer-open h-screen w-full overflow-hidden bg-base-100">
			<input id="nav-drawer" type="checkbox" className="drawer-toggle" />
			<div className="drawer-content flex flex-col h-full overflow-hidden relative">
				{/* Update Banner */}
				<UpdateBanner />

				{/* Mobile Header */}
				<header className="lg:hidden flex items-center justify-between p-4 bg-base-200 border-b border-base-300">
					<div className="flex items-center gap-2">
						<label htmlFor="nav-drawer" className="btn btn-ghost btn-sm btn-square">
							<Menu className="w-5 h-5" />
						</label>
						<span className="font-bold text-base-content font-mono tracking-tight">TamiasOS</span>
					</div>
				</header>

				<main className="flex-1 overflow-y-auto w-full">
					{children}
				</main>
			</div>

			<div className="drawer-side z-40 h-full overflow-hidden">
				<label htmlFor="nav-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
				<Nav onNewProject={() => setIsModalOpen(true)} />
			</div>

			{/* Project Creation Modal - Global Position */}
			{isModalOpen && (
				<dialog data-testid="project-create-modal" className="modal modal-open z-[100]" open>
					<div className="modal-box bg-base-100 border border-base-300 w-full max-w-lg shadow-2xl">
						<h3 className="text-xl font-bold mb-6 text-primary flex items-center gap-3">
							<FolderOpen className="w-6 h-6" />
							Create New Project
						</h3>

						<div className="space-y-5">
							<div className="form-control">
								<label className="label"><span className="label-text font-medium">Project Name *</span></label>
								<input data-testid="project-name-input" value={formName} onChange={e => handleNameChange(e.target.value)} type="text" className="input input-bordered w-full focus:input-primary" placeholder="e.g. My Awesome Startup" />
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text font-medium">Folder Name *</span></label>
								<div className="flex items-center gap-0 input input-bordered w-full font-mono text-sm overflow-hidden p-0">
									<span className="px-3 py-2 bg-base-300 border-r border-base-300 text-base-content/50 text-xs shrink-0">~/.tamias/workspace/</span>
									<input
										data-testid="project-path-input"
										value={formPath}
										onChange={e => { setPathManuallyEdited(true); setFormPath(e.target.value) }}
										type="text"
										className="flex-1 bg-transparent px-3 py-2 outline-none text-sm"
										placeholder="my-project"
									/>
								</div>
								<label className="label">
									<span className="label-text-alt text-base-content/50 italic">
										{pathManuallyEdited ? "Custom folder name" : "Auto-generated from project name — edit to override"}
									</span>
								</label>
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text font-medium">Description</span></label>
								<textarea data-testid="project-desc-input" value={formDesc} onChange={e => setFormDesc(e.target.value)} className="textarea textarea-bordered h-24 text-sm focus:textarea-primary" placeholder="Brief context about this project" />
							</div>

							<div className="divider opacity-30">Discord Integration</div>

							<div className="form-control">
								<label className="label py-1"><span className="label-text flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-60">Link Discord Channel</span></label>
								<select value={formChannel} onChange={e => setFormChannel(e.target.value)} className="select select-bordered w-full text-sm">
									<option value="">-- No Channel Linked --</option>
									{channels.map(c => (
										<option key={c.id} value={c.id}>
											{c.guildName} / #{c.name}
										</option>
									))}
								</select>
							</div>

							{formChannel && (
								<div className="form-control bg-base-200/30 p-4 rounded-xl border border-base-300/50 mt-2">
									<label className="label pt-0"><span className="label-text font-bold text-xs">Context File Path (Relative)</span></label>
									<input value={formContext} onChange={e => setFormContext(e.target.value)} type="text" className="input input-bordered w-full input-sm font-mono text-xs" placeholder="readme.md" />
								</div>
							)}
						</div>

						<div className="modal-action gap-3 mt-8 border-t border-base-300/50 pt-5">
							<button data-testid="project-cancel-btn" onClick={() => { setIsModalOpen(false); setPathManuallyEdited(false) }} className="btn btn-ghost hover:bg-base-300">Cancel</button>
							<button data-testid="project-save-btn" onClick={handleSaveProject} className="btn btn-primary px-8">
								<Check className="w-4 h-4 mr-2" /> Save Project
							</button>
						</div>
					</div>
					<div className="modal-backdrop bg-black/60 backdrop-blur-sm" onClick={() => { setIsModalOpen(false); setPathManuallyEdited(false) }}>
						<button className="cursor-default">close</button>
					</div>
				</dialog>
			)}
		</div>
	)
}
