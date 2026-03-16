import { NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { getTamiasConfig } from '../../tamias'

export const dynamic = 'force-dynamic'

export async function GET() {
	const TAMIAS_DIR = join(homedir(), '.tamias')
	const MEMORY_DIR = join(TAMIAS_DIR, 'memory')

	const hasIdentity = existsSync(join(MEMORY_DIR, 'IDENTITY.md'))
	const hasUser = existsSync(join(MEMORY_DIR, 'USER.md'))

	const config = await getTamiasConfig()
	const connections = Object.keys(config.connections || {})
	const hasConnections = connections.length > 0
	const hasBridges = Object.keys(config.bridges || {}).some(
		k => k !== 'terminal' && config.bridges[k]?.enabled
	)

	return NextResponse.json({
		onboarded: hasIdentity && hasConnections,
		hasIdentity,
		hasUser,
		hasConnections,
		hasBridges,
	})
}
