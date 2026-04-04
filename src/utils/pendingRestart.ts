// src/utils/pendingRestart.ts
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import type { BridgeManager } from '../bridge/index.ts'

export interface PendingRestart {
	channelId: string
	channelUserId?: string
	fromVersion: string
	toVersion: string
	changelog: string
	requestedAt: string
}

/** Resolves at call time so tests can override process.env.TAMIAS_DIR */
function getPendingRestartPath(): string {
	return join(process.env.TAMIAS_DIR ?? join(homedir(), '.tamias'), 'pending-restart.json')
}

export function writePendingRestart(info: PendingRestart): void {
	writeFileSync(getPendingRestartPath(), JSON.stringify(info, null, 2), 'utf-8')
}

export function readPendingRestart(): PendingRestart | null {
	const path = getPendingRestartPath()
	if (!existsSync(path)) return null
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as PendingRestart
	} catch {
		return null
	}
}

export function clearPendingRestart(): void {
	const path = getPendingRestartPath()
	if (existsSync(path)) unlinkSync(path)
}

/**
 * Called after bridgeManager.initializeAll() on daemon boot.
 * Reads pending-restart.json, sends notification to the stored channel, then deletes the file.
 * @param settlementDelayMs How long to wait for bridges to settle before sending. Default 2000ms.
 *   Pass 0 in tests to skip the delay.
 */
export async function checkPendingRestart(
	bridgeManager: BridgeManager,
	settlementDelayMs = 2000,
): Promise<void> {
	const info = readPendingRestart()
	if (!info) return

	await new Promise(r => setTimeout(r, settlementDelayMs))

	const message = `✅ Updated from v${info.fromVersion} to v${info.toVersion}!\n\n${info.changelog}`.trim()

	try {
		await bridgeManager.broadcastToChannel(info.channelId, message, info.channelUserId)
	} catch (err) {
		console.error('[PendingRestart] Failed to send restart notification:', err)
	} finally {
		clearPendingRestart()
	}
}
