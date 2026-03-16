import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'

const TAMIAS_DIR = join(homedir(), '.tamias')
const ENV_PATH = join(TAMIAS_DIR, '.env')
const DAEMON_FILE = join(TAMIAS_DIR, 'daemon.json')

export const dynamic = 'force-dynamic'

async function getOrCreateToken(): Promise<string> {
	// Check if token already exists in .env
	try {
		const envContent = await readFile(ENV_PATH, 'utf-8')
		for (const line of envContent.split('\n')) {
			const clean = line.trim()
			if (clean.startsWith('TAMIAS_DASHBOARD_TOKEN=')) {
				const val = clean.slice('TAMIAS_DASHBOARD_TOKEN='.length).trim()
				if (val) return val
			}
		}
	} catch { /* file may not exist */ }

	// Generate new token
	const token = randomBytes(32).toString('hex')
	await mkdir(TAMIAS_DIR, { recursive: true })

	// Append to .env
	let envContent = ''
	try {
		envContent = await readFile(ENV_PATH, 'utf-8')
	} catch { /* file may not exist */ }

	const lines = envContent.split('\n').filter(l => !l.startsWith('TAMIAS_DASHBOARD_TOKEN='))
	lines.push(`TAMIAS_DASHBOARD_TOKEN=${token}`)
	await writeFile(ENV_PATH, lines.filter(l => l.trim()).join('\n') + '\n', 'utf-8')

	return token
}

export async function POST() {
	try {
		const token = await getOrCreateToken()

		// Try to notify running daemon to restart
		try {
			if (existsSync(DAEMON_FILE)) {
				const info = JSON.parse(await readFile(DAEMON_FILE, 'utf-8'))
				if (info.port) {
					await fetch(`http://127.0.0.1:${info.port}/reload`, { method: 'POST' }).catch(() => { })
				}
			}
		} catch { /* daemon may not be running */ }

		return NextResponse.json({ success: true, token })
	} catch (error) {
		console.error('[onboarding/complete] Error:', error)
		return NextResponse.json(
			{ error: 'Failed to complete onboarding' },
			{ status: 500 }
		)
	}
}
