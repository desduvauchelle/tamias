import { NextResponse } from 'next/server'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
	try {
		const { command } = await request.json()
		if (!command || typeof command !== 'string') {
			return NextResponse.json({ available: false, error: 'No command provided' })
		}

		try {
			execSync(`which ${command}`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' })
			return NextResponse.json({ available: true })
		} catch {
			return NextResponse.json({ available: false })
		}
	} catch {
		return NextResponse.json({ available: false, error: 'Invalid request' }, { status: 400 })
	}
}
