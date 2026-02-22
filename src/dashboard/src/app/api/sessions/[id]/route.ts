import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { Database } from 'bun:sqlite'

const DB_PATH = join(homedir(), '.tamias', 'data.sqlite')

export async function GET(req: Request, { params }: { params: { id: string } }) {
	const sessionId = (await params).id

	try {
		// We use bun:sqlite directly since we know the path and the dashboard runs in bun
		const db = new Database(DB_PATH)

		const messages = db.query('SELECT role, content FROM messages WHERE sessionId = ? ORDER BY id ASC').all(sessionId)

		db.close()

		return NextResponse.json({ messages })
	} catch (err) {
		console.error(`Failed to load history for ${sessionId}:`, err)
		return NextResponse.json({ messages: [], error: String(err) })
	}
}
