import fs from 'node:fs'
import { join } from 'node:path'
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

export async function performUpdate(onProgress: ProgressCallback = () => { }): Promise<UpdateResult> {
	try {
		const updateInfo = await checkForUpdate()
		if (!updateInfo) {
			return { success: false, currentVersion: VERSION, error: 'Could not check for updates.' }
		}

		const { currentVersion, latestVersion, release } = updateInfo
		const latestVersionStr = release.tag_name

		if (currentVersion === latestVersion) {
			onProgress({ message: `Already up to date (v${currentVersion}).`, type: 'info' })
			return { success: true, currentVersion, latestVersion }
		}

		onProgress({ message: `New version found: v${latestVersion}.`, type: 'info' })

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
		const isCompiled = !currentExecPath.includes('/bun') && !currentExecPath.includes('/node')

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

		// 3. Dashboard Update
		const candidatePaths = [
			join(homedir(), '.tamias', 'src', 'dashboard'),
			join(process.cwd(), 'src', 'dashboard'),
		]
		const dashboardDir = candidatePaths.find((path) => fs.existsSync(path)) ?? ''

		if (dashboardDir) {
			onProgress({ message: `Updating dashboard source at ${dashboardDir}...`, type: 'info' })
			const tmpDir = join(homedir(), '.tamias', 'tmp-update')
			if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
			fs.mkdirSync(tmpDir, { recursive: true })

			try {
				// Download source ZIP
				const zipUrl = `https://github.com/${REPO}/archive/refs/tags/${latestVersionStr}.zip`
				execSync(`curl -fsSL "${zipUrl}" -o "${tmpDir}/src.zip"`)
				execSync(`unzip -q "${tmpDir}/src.zip" -d "${tmpDir}/extracted"`)

				// Find dashboard in ZIP
				const extractedDirs = fs.readdirSync(join(tmpDir, 'extracted'))
				let newDashSrc = ''

				for (const dir of extractedDirs) {
					const candidate = join(tmpDir, 'extracted', dir, 'src', 'dashboard')
					if (fs.existsSync(candidate)) {
						newDashSrc = candidate
						break
					}
					const candidate2 = join(tmpDir, 'extracted', dir, 'dashboard')
					if (fs.existsSync(candidate2)) {
						newDashSrc = candidate2
						break
					}
				}

				if (fs.existsSync(newDashSrc)) {
					fs.rmSync(dashboardDir, { recursive: true, force: true })
					fs.cpSync(newDashSrc, dashboardDir, { recursive: true })

					// Copy README.md for the dashboard docs page
					const zipRoot = join(newDashSrc, '..', '..')
					if (fs.existsSync(join(zipRoot, 'README.md'))) {
						fs.copyFileSync(join(zipRoot, 'README.md'), join(homedir(), '.tamias', 'README.md'))
					}

					if (fs.existsSync(join(dashboardDir, 'package.json'))) {
						onProgress({ message: 'Installing dashboard dependencies...', type: 'info' })
						execSync(`bun install`, { cwd: dashboardDir, stdio: 'ignore' })

						onProgress({ message: 'Building dashboard...', type: 'info' })
						try {
							execSync(`bun run build`, { cwd: dashboardDir, stdio: 'ignore' })
							onProgress({ message: 'Dashboard updated and built.', type: 'info' })
						} catch (buildError) {
							onProgress({ message: 'Dashboard build failed. It will run in dev mode.', type: 'warn' })
							throw buildError // Rethrow to trigger the outer catch
						}
					} else {
						onProgress({ message: `No package.json found in ${dashboardDir}. Skipping install/build.`, type: 'warn' })
					}
				}
			} catch (e) {
				onProgress({ message: `Dashboard update failed: ${String(e)}`, type: 'error' })
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true })
			}
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
		const isCompiled = !currentExecPath.includes('/bun') && !currentExecPath.includes('/node')

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

		// 4. Give the broadcast a bit of time, then exit
		setTimeout(() => {
			process.exit(0)
		}, 3000)

	} catch (err) {
		console.error(`[AutoUpdate] Error during auto-update:`, err)
	}
}
