import { NextResponse } from 'next/server'
import { join } from 'path'
import { readFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		// README.md is in the project root, which is 3 levels up from this file
		// src/dashboard/src/app/api/readme/route.ts -> src/dashboard/src/app/api/readme -> src/dashboard/src/app/api -> src/dashboard/src/app -> src/dashboard/src -> src/dashboard -> project root
		// Actually, in Next.js app dir, the project root is usually where package.json is.
		// Let's use process.cwd() or similar, but since this is a monorepo-ish structure,
		// let's try to find it relative to the dashboard root.
		const projectRoot = join(process.cwd(), '..', '..')
		const readmePath = join(projectRoot, 'README.md')

		const content = await readFile(readmePath, 'utf-8')
		return NextResponse.json({ content })
	} catch (error) {
		console.error('Error reading README:', error)
		return NextResponse.json({ error: 'Could not read README.md' }, { status: 500 })
	}
}
