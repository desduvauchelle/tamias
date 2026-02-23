import fs from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { VERSION } from './version.ts'
import type { BridgeManager } from '../bridge/index.ts'

const REPO = 'desduvauchelle/tamias'

export interface UpdateProgress {
	message: string
	type: 'info' | 'warn' | 'error' | 'success'
}

export interface UpdateResult {
	success: boolean
	currentVersion: string
	latestVersion?: string
	error?: string
}

export type ProgressCallback = (progress: UpdateProgress) => void

export async function checkForUpdate(): Promise<{ currentVersion: string; latestVersion: string; release: any } | null> {
	const currentVersion = VERSION
	const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`
	const res = await fetch(LATEST_RELEASE_URL)

	if (!res.ok) {
		throw new Error(`GitHub API returned: ${res.statusText}`)
	}

	const release = await res.json()
	const latestVersionStr = release.tag_name as string
	if (!latestVersionStr) {
		throw new Error('Could not parse latest version.')
	}

	const latestVersion = latestVersionStr.replace(/^v/, '')
	return { currentVersion, latestVersion, release }
}

/**
 * Downloads the pre-built dashboard standalone tarball from a GitHub release and
 * extracts it into ~/.tamias/src/dashboard/, replacing the .next/standalone dir.
 * No `bun install` or `bun run build` required on the server.
 */
export async function installDashboardTarball(downloadUrl: string, onProgress: ProgressCallback = () => { }): Promise<void> {
	const dashboardDir = join(homedir(), '.tamias', 'src', 'dashboard')
	const standaloneDir = join(dashboardDir, '.next', 'standalone')
	const tmpTar = join(homedir(), '.tamias', 'tamias-dashboard.tmp.tar.gz')
	try {
		onProgress({ message: 'Downloading dashboard tarball...', type: 'info' })
		const res = await fetch(downloadUrl)
		if (!res.ok) throw new Error(`Download failed: ${res.statusText}`)
		const buf = Buffer.from(await res.arrayBuffer())
		fs.writeFileSync(tmpTar, buf)

		onProgress({ message: 'Installing dashboard...', type: 'info' })
		if (fs.existsSync(standaloneDir)) fs.rmSync(standaloneDir, { recursive: true, force: true })
		fs.mkdirSync(standaloneDir, { recursive: true })
		// Tarball contains the standalone dir contents; extract into dashboardDir so .next/standalone is recreated
		execSync(`tar -xzf "${tmpTar}" -C "${dashboardDir}"`, { stdio: 'ignore' })
		onProgress({ message: 'Dashboard updated.', type: 'success' })
	} finally {
		if (fs.existsSync(tmpTar)) fs.rmSync(tmpTar, { force: true })
	}
}

export async function performUpdate(onProgress: ProgressCallback = () => { }, { force = false }: { force?: boolean } = {}): Promise<UpdateResult> {
	try {
		const updateInfo = await checkForUpdate()
		if (!updateInfo) {
			return { success: false, currentVersion: VERSION, error: 'Could not check for updates.' }
		}

		const { currentVersion, latestVersion, release } = updateInfo
		const latestVersionStr = release.tag_name

		if (currentVersion === latestVersion && !force) {
			onProgress({ message: `Already up to date (v${currentVersion}).`, type: 'info' })
			return { success: true, currentVersion, latestVersion }
		}

		onProgress({ message: force && currentVersion === latestVersion ? `Re-installing v${currentVersion}...` : `New version found: v${latestVersion}.`, type: 'info' })

		// 1. Determine OS and Arch for binary
		const sysOS = process.platform
		const sysArch = process.arch

		let osName = ''
		if (sysOS === 'darwin') osName = 'darwin'
		else if (sysOS === 'linux') osName = 'linux'

		let archName = ''
		if (sysArch === 'arm64' || (sysArch as string) === 'aarch64') archName = 'arm64'
		else if (sysArch === 'x64') archName = 'x64'

		const assetName = `tamias-${osName}-${archName}`
		const binaryAsset = release.assets?.find((a: any) => a.name === assetName)

		// 2. Binary Update
		const currentExecPath = process.execPath
		// A compiled binary's basename is "tamias"; the bun/node runtimes are named "bun" or "node"
		const execBasename = basename(currentExecPath)
		const isCompiled = !['bun', 'node', 'bun.exe', 'node.exe'].includes(execBasename)

		if (isCompiled && binaryAsset) {
			onProgress({ message: `Downloading binary for ${osName}-${archName}...`, type: 'info' })
			const downloadRes = await fetch(binaryAsset.browser_download_url)
			if (downloadRes.ok) {
				const arrayBuffer = await downloadRes.arrayBuffer()
				const buffer = Buffer.from(arrayBuffer)
				const tmpPath = `${currentExecPath}.tmp.update`
				fs.writeFileSync(tmpPath, buffer)
				fs.chmodSync(tmpPath, 0o755)
				fs.renameSync(tmpPath, currentExecPath)
				onProgress({ message: 'Binary updated.', type: 'info' })
			} else {
				onProgress({ message: 'Binary download failed, but continuing with dashboard update...', type: 'warn' })
			}
		}

		// 3. Dashboard Update — download pre-built standalone tarball (no bun install/build needed)
		const dashboardAsset = release.assets?.find((a: any) => a.name === 'tamias-dashboard.tar.gz')
		if (dashboardAsset) {
			onProgress({ message: 'Downloading pre-built dashboard...', type: 'info' })
			try {
				await installDashboardTarball(dashboardAsset.browser_download_url, onProgress)
			} catch (e) {
				onProgress({ message: `Dashboard update failed: ${String(e)}`, type: 'error' })
			}
		} else {
			onProgress({ message: 'No pre-built dashboard found in release — skipping dashboard update.', type: 'warn' })
		}

		return { success: true, currentVersion, latestVersion }
	} catch (err) {
		return { success: false, currentVersion: VERSION, error: String(err) }
	}
}

/**
 * Checks GitHub for the latest release, downloads it if newer than current version,
 * replaces the current binary, and notifies all channels on the bridge manager before exiting.
 */
export async function autoUpdateDaemon(bridgeManager: BridgeManager) {
	try {
		const currentVersion = VERSION

		const currentExecPath = process.execPath
		// A compiled binary's basename is "tamias"; the bun/node runtimes are named "bun" or "node"
		const execBasename = basename(currentExecPath)
		const isCompiled = !['bun', 'node', 'bun.exe', 'node.exe'].includes(execBasename)

		// Only auto-update if running as a compiled binary
		if (!isCompiled) return

		const sysOS = process.platform
		const sysArch = process.arch

		let osName = ''
		if (sysOS === 'darwin') osName = 'darwin'
		else if (sysOS === 'linux') osName = 'linux'
		else return // unsupported

		let archName = ''
		if (sysArch === 'arm64' || (sysArch as string) === 'aarch64') archName = 'arm64'
		else if (sysArch === 'x64') archName = 'x64'
		else return // unsupported

		// 2. Fetch latest release
		const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`
		const res = await fetch(LATEST_RELEASE_URL)
		if (!res.ok) return

		const release = await res.json()
		const latestVersionStr = release.tag_name as string
		if (!latestVersionStr) return

		const latestVersion = latestVersionStr.replace(/^v/, '')

		// If we are already on latest version, do nothing
		if (currentVersion === latestVersion) return

		const assetName = `tamias-${osName}-${archName}`
		const asset = release.assets?.find((a: any) => a.name === assetName)
		if (!asset) return // no asset yet

		console.log(`[AutoUpdate] Found new version v${latestVersion}. Downloading...`)

		// Notify channels
		const msg = `🐿️ **Tamias Update Available**\nA new version of Tamias (v${latestVersion}) was found.\nI am downloading it and will reboot momentarily...`
		for (const channelId of bridgeManager.getActiveChannelIds()) {
			await bridgeManager.broadcastToChannel(channelId, msg).catch((e: Error) => console.error(`[AutoUpdate] Broadcast failed:`, e))
		}

		// 3. Download and replace
		const downloadRes = await fetch(asset.browser_download_url)
		if (!downloadRes.ok) throw new Error('Download failed')

		const arrayBuffer = await downloadRes.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)

		const tmpPath = `${currentExecPath}.tmp.update`

		fs.writeFileSync(tmpPath, buffer)
		fs.chmodSync(tmpPath, 0o755)

		// replace in place
		fs.renameSync(tmpPath, currentExecPath)

		console.log(`[AutoUpdate] Updated to v${latestVersion}. Exiting for reboot...`)

		// 4. Update dashboard tarball
		const dashboardAsset = release.assets?.find((a: any) => a.name === 'tamias-dashboard.tar.gz')
		if (dashboardAsset) {
			try {
				await installDashboardTarball(dashboardAsset.browser_download_url)
				console.log('[AutoUpdate] Dashboard updated.')
			} catch (e) {
				console.error('[AutoUpdate] Dashboard update failed:', e)
			}
		}

		// 5. Give the broadcast a bit of time, then exit
		setTimeout(() => {
			process.exit(0)
		}, 3000)

	} catch (err) {
		console.error(`[AutoUpdate] Error during auto-update:`, err)
	}
}
