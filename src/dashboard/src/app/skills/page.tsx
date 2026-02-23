"use client"

import { useState, useEffect } from "react"
import { useToast } from "../_components/ToastProvider"
import { HelpCircle, Lightbulb, FileCode, Terminal, Plus } from "lucide-react"

export default function SkillsPage() {
	const [skills, setSkills] = useState<any[]>([])
	const [loading, setLoading] = useState(true)
	const [activeSkill, setActiveSkill] = useState<any | null>(null)
	const [isEditing, setIsEditing] = useState(false)

	const [formName, setFormName] = useState("")
	const [formDescription, setFormDescription] = useState("")
	const [formContent, setFormContent] = useState("")
	const [showDetails, setShowDetails] = useState(false)
	const { toast, success, error } = useToast()

	useEffect(() => {
		fetchSkills()
	}, [])

	const fetchSkills = async () => {
		try {
			const res = await fetch("/api/skills")
			if (res.ok) {
				const data = await res.json()
				setSkills(data)
			}
		} catch (error) {
			console.error("Failed to list skills", error)
		} finally {
			setLoading(false)
		}
	}

	const handleSave = async () => {
		if (!formName || !formContent) {
			error("Name and Content are required")
			return
		}

		try {
			const res = await fetch("/api/skills", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: formName,
					description: formDescription,
					content: formContent
				})
			})

			if (res.ok) {
				success("Skill saved!")
				setIsEditing(false)
				fetchSkills()
				setActiveSkill({ name: formName, description: formDescription, content: formContent })
			} else {
				const errorData = await res.json()
				error(errorData.error || "Failed to save skill")
			}
		} catch (err: any) {
			error(err.message || "An error occurred")
		}
	}

	const handleDelete = async (folder: string) => {
		if (!confirm(`Are you sure you want to delete this skill?`)) return

		try {
			const res = await fetch(`/api/skills/${folder}`, { method: "DELETE" })
			if (res.ok) {
				success("Skill deleted")
				setActiveSkill(null)
				fetchSkills()
			} else {
				error("Failed to delete skill")
			}
		} catch (err) {
			error("An error occurred")
		}
	}

	const openEditor = (skill?: any) => {
		if (skill && skill.isBuiltIn) {
			error("Built-in skills cannot be edited")
			return
		}
		if (skill) {
			setFormName(skill.name)
			setFormDescription(skill.description)
			setFormContent(skill.content)
		} else {
			setFormName("")
			setFormDescription("")
			setFormContent("")
		}
		setIsEditing(true)
		setActiveSkill(skill || null)
	}

	return (
		<div className="flex h-full gap-6">
			{/* Left Sidebar */}
			<div className="w-1/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
				<div className="p-4 border-b border-base-200/50 flex items-center justify-between">
					<h2 className="font-semibold text-lg flex items-center gap-2">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-primary">
							<path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
						</svg>
						Skills
					</h2>
					<button
						onClick={() => openEditor()}
						className="btn btn-sm btn-ghost btn-circle"
						title="New Skill"
					>
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
							<path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
						</svg>
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-2 space-y-1">
					{loading ? (
						<div className="p-4 text-center text-base-content/50">Loading skills...</div>
					) : skills.length === 0 ? (
						<div className="p-4 text-center text-base-content/50">No skills found.</div>
					) : (
						skills.map(skill => (
							<button
								key={skill.folder}
								onClick={() => {
									setActiveSkill(skill)
									setIsEditing(false)
								}}
								className={`w-full text-left p-3 rounded-xl transition-all ${activeSkill?.folder === skill.folder ? 'bg-primary/10 text-primary' : 'hover:bg-base-200'}`}
							>
								<div className="flex items-center justify-between mb-1">
									<div className="font-medium truncate">{skill.name}</div>
									{skill.isBuiltIn && (
										<span className="text-[10px] uppercase font-bold text-accent/70 bg-accent/10 px-2 py-0.5 rounded-full">Built-in</span>
									)}
								</div>
								<div className="text-sm opacity-70 truncate" title={skill.description}>
									{skill.description}
								</div>
							</button>
						))
					)}
				</div>
			</div>

			{/* Main Content Area */}
			<div className="w-2/3 bg-base-100/50 backdrop-blur rounded-box border border-base-200/50 flex flex-col overflow-hidden">
				{isEditing ? (
					<div className="flex flex-col h-full p-6 p-6">
						<h3 className="text-lg font-semibold mb-4 text-primary">
							{activeSkill ? 'Edit Skill' : 'Create New Skill'}
						</h3>
						<div className="space-y-4 flex-1 flex flex-col overflow-y-auto">
							<div className="form-control">
								<label className="label"><span className="label-text">Skill Name</span></label>
								<input
									type="text"
									className="input input-bordered focus:input-primary transition-colors"
									placeholder="e.g. summarize-texts"
									value={formName}
									onChange={e => setFormName(e.target.value)}
									disabled={activeSkill && activeSkill.isBuiltIn}
								/>
							</div>
							<div className="form-control">
								<label className="label"><span className="label-text">Description</span></label>
								<input
									type="text"
									className="input input-bordered focus:input-primary transition-colors"
									placeholder="Briefly describe what this skill does"
									value={formDescription}
									onChange={e => setFormDescription(e.target.value)}
									disabled={activeSkill && activeSkill.isBuiltIn}
								/>
							</div>
							<div className="form-control flex-1 flex flex-col">
								<label className="label"><span className="label-text">Prompt / Content (Markdown)</span></label>
								<textarea
									className="textarea textarea-bordered flex-1 font-mono text-sm leading-relaxed p-4 focus:textarea-primary transition-colors resize-none"
									placeholder="Enter the system prompt instructions for this skill..."
									value={formContent}
									onChange={e => setFormContent(e.target.value)}
									disabled={activeSkill && activeSkill.isBuiltIn}
								/>
							</div>
						</div>
						<div className="flex justify-end gap-2 pt-6 mt-4 border-t border-base-200/50">
							<button onClick={() => setIsEditing(false)} className="btn btn-ghost">Cancel</button>
							{!activeSkill?.isBuiltIn && (
								<button onClick={handleSave} className="btn btn-primary gap-2">
									<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
										<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
									</svg>
									Save Skill
								</button>
							)}
						</div>
					</div>
				) : activeSkill ? (
					<div className="flex flex-col h-full">
						<div className="p-6 border-b border-base-200/50 flex justify-between items-start">
							<div>
								<div className="flex items-center gap-3 mb-1">
									<h2 className="text-2xl font-bold">{activeSkill.name}</h2>
									{activeSkill.isBuiltIn && (
										<span className="badge badge-accent badge-outline text-xs">Built-in</span>
									)}
								</div>
								<div className="text-xs font-mono text-base-content/40 mb-3 truncate max-w-lg" title={activeSkill.filePath}>
									{activeSkill.filePath}
								</div>
								<p className="text-base-content/70">{activeSkill.description}</p>
							</div>
							<div className="flex gap-2">
								{!activeSkill.isBuiltIn && (
									<>
										<button onClick={() => openEditor(activeSkill)} className="btn btn-square btn-ghost btn-sm text-info hover:bg-info/10">
											<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
												<path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
											</svg>
										</button>
										<button onClick={() => handleDelete(activeSkill.folder)} className="btn btn-square btn-ghost btn-sm text-error hover:bg-error/10">
											<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
												<path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
											</svg>
										</button>
									</>
								)}
							</div>
						</div>
						<div className="flex-1 p-6 overflow-y-auto bg-base-300/20">
							<h4 className="text-xs uppercase font-bold text-base-content/50 mb-3 tracking-wider">SKILL.md Source</h4>
							<pre className="text-sm font-mono whitespace-pre-wrap leading-relaxed text-base-content/80 bg-base-100 p-6 rounded-xl border border-base-200/50 shadow-inner">
								{activeSkill.content}
							</pre>
						</div>
					</div>
				) : (
					<div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
						<div className="max-w-2xl w-full space-y-8 py-12">
							<div className="text-center space-y-4">
								<div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
									<HelpCircle className="w-10 h-10 text-primary" />
								</div>
								<h3 className="text-3xl font-bold text-base-content">What are Skills?</h3>
								<p className="text-lg text-base-content/70 leading-relaxed">
									Skills are modular sets of instructions that define how Tamias handles specific tasks or workflows.
									They allow you to extend the agent's intelligence by providing specialized context and guidance for any scenario.
								</p>
							</div>

							<div className={`collapse bg-base-200/50 border border-base-300/50 rounded-2xl transition-all ${showDetails ? 'collapse-open' : ''}`}>
								<div
									className="collapse-title flex items-center justify-between p-4 cursor-pointer hover:bg-base-300/30 transition-colors"
									onClick={() => setShowDetails(!showDetails)}
								>
									<div className="flex items-center gap-3">
										<Lightbulb className="w-5 h-5 text-warning" />
										<span className="font-semibold text-base-content/80">Learn more about how skills work</span>
									</div>
									<div className={`transition-transform duration-300 ${showDetails ? 'rotate-180' : ''}`}>
										<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 opacity-50">
											<path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
										</svg>
									</div>
								</div>

								<div className="collapse-content">
									<div className="pt-4 space-y-6">
										<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
											<div className="space-y-2">
												<div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-base-content/40">
													<FileCode className="w-3.5 h-3.5" />
													<span>Instruction Based</span>
												</div>
												<p className="text-sm text-base-content/60">
													Skills are defined using Markdown files. You can specify system prompts, constraints, and behavior patterns.
												</p>
											</div>
											<div className="space-y-2">
												<div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-base-content/40">
													<Terminal className="w-3.5 h-3.5" />
													<span>Extendable</span>
												</div>
												<p className="text-sm text-base-content/60">
													Create your own library of specialized agents. Combine different skills to create complex agent personas.
												</p>
											</div>
										</div>

										<div className="space-y-4">
											<div className="font-bold text-xs uppercase tracking-wider text-base-content/40">Sample Use Cases</div>
											<div className="grid grid-cols-1 gap-2">
												{[
													{ title: "Customer Support", desc: "Handle inquiries with a specific tone and knowledge base.", icon: "💬" },
													{ title: "Code Reviewer", desc: "Analyze pull requests for security and style tips.", icon: "🔍" },
													{ title: "Content Creator", desc: "Generate blog posts matching your specific brand voice.", icon: "✍️" }
												].map((sample, i) => (
													<div key={i} className="flex items-center gap-4 p-3 bg-base-100/50 rounded-xl border border-base-200/50">
														<div className="w-10 h-10 bg-base-200 rounded-lg flex items-center justify-center text-xl shadow-sm">
															{sample.icon}
														</div>
														<div>
															<div className="font-bold text-sm">{sample.title}</div>
															<div className="text-xs text-base-content/50">{sample.desc}</div>
														</div>
													</div>
												))}
											</div>
										</div>
									</div>
								</div>
							</div>

							<div className="flex flex-col items-center gap-4 pt-4 text-center">
								<button onClick={() => openEditor()} className="btn btn-primary btn-lg px-8 gap-3 shadow-lg shadow-primary/20 rounded-2xl">
									<Plus className="w-5 h-5" />
									Create New Skill
								</button>
								<p className="text-sm text-base-content/40">
									Or select an existing one from the sidebar
								</p>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
