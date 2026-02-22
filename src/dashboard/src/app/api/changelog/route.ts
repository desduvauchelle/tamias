import { NextResponse } from 'next/server'
import { join } from 'path'
import { readFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		// CHANGELOG.md is in the project root
		const projectRoot = join(process.cwd(), '..', '..')
		const changelogPath = join(projectRoot, 'CHANGELOG.md')

		const content = await readFile(changelogPath, 'utf-8')
		return NextResponse.json({ content })
	} catch (error) {
		console.error('Error reading CHANGELOG:', error)
		return NextResponse.json({ error: 'Could not read CHANGELOG.md' }, { status: 500 })
	}
}
