import fs from 'node:fs'
import type { BridgeManager } from '../bridge/index.ts'

const REPO = 'desduvauchelle/tamias'

/**
 * Checks GitHub for the latest release, downloads it if newer than current version,
 * replaces the current binary, and notifies all channels on the bridge manager before exiting.
 */
export async function autoUpdateDaemon(bridgeManager: BridgeManager) {
	try {
		// 1. Read current version
		const pkgJsonStr = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
		const pkg = JSON.parse(pkgJsonStr)
		const currentVersion = pkg.version as string

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

		const currentExecPath = process.execPath
		const tmpPath = `${currentExecPath}.tmp.update`

		fs.writeFileSync(tmpPath, buffer)
		fs.chmodSync(tmpPath, 0o755)

		// replace in place
		fs.renameSync(tmpPath, currentExecPath)

		console.log(`[AutoUpdate] Updated to v${latestVersion}. Exiting for reboot...`)

		// 4. Give the broadcast a bit of time, then exit
		setTimeout(() => {
			process.exit(0)
		}, 3000)

	} catch (err) {
		console.error(`[AutoUpdate] Error during auto-update:`, err)
	}
}
