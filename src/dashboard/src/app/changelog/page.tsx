'use client'

import { useEffect, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import Link from 'next/link'

export default function ChangelogPage() {
	const [content, setContent] = useState<string>('')
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		fetch('/api/changelog')
			.then(r => r.json())
			.then(data => {
				if (data.content) {
					// Configure marked for better output
					marked.setOptions({
						breaks: true,
						gfm: true
					})
					const html = marked.parse(data.content) as string
					setContent(DOMPurify.sanitize(html))
				}
			})
			.catch(err => console.error('Failed to load CHANGELOG:', err))
			.finally(() => setLoading(false))
	}, [])

	if (loading) {
		return (
			<div className="p-8 flex items-center justify-center min-h-[50vh]">
				<span className="loading loading-spinner loading-lg text-primary"></span>
			</div>
		)
	}

	return (
		<div className="p-8 max-w-4xl mx-auto">
			<div className="flex items-center justify-between mb-8">
				<h1 className="text-3xl font-bold text-primary">Changelog</h1>
				<Link href="/docs" className="btn btn-ghost btn-sm">
					Back to Docs
				</Link>
			</div>

			<div className="card bg-base-100 shadow-xl border border-base-300">
				<div className="card-body">
					<article className="prose prose-slate max-w-none dark:prose-invert prose-headings:text-primary prose-a:text-primary prose-img:rounded-xl">
						<div
							dangerouslySetInnerHTML={{ __html: content }}
						/>
					</article>
				</div>
			</div>
		</div>
	)
}
