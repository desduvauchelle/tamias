import Link from 'next/link'

export default function ConfigsPage() {
	return (
		<div className="p-6 max-w-2xl mx-auto mt-12 text-center">
			<h1 className="text-3xl font-bold font-mono text-base-content mb-4">Settings Moved</h1>
			<p className="text-base-content/60 font-mono mb-8">
				All configurations have been split into their respective dedicated pages.
			</p>
			<div className="flex justify-center gap-4">
				<Link href="/models" className="btn btn-primary font-mono">Go to text Models</Link>
				<Link href="/memory" className="btn btn-secondary font-mono">Go to Memory</Link>
				<Link href="/communication" className="btn btn-accent font-mono">Go to Communication</Link>
			</div>
		</div>
	)
}
