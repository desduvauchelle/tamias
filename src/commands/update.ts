import * as p from '@clack/prompts'
import pc from 'picocolors'
import fs from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { VERSION } from '../utils/version.ts'

const REPO = 'desduvauchelle/tamias'

export const runUpdateCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias CLI Update ')))

	try {
		const currentVersion = VERSION
		p.note(`Current version: v${currentVersion}`)

		const s = p.spinner()
		s.start('Checking for updates...')

		const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`
		const res = await fetch(LATEST_RELEASE_URL)

		if (!res.ok) {
			s.stop('Failed to check for updates.')
			p.cancel(pc.red(`GitHub API returned: ${res.statusText}`))
			process.exit(1)
		}

		const release = await res.json()
		const latestVersionStr = release.tag_name as string

		if (!latestVersionStr) {
			s.stop('Could not parse latest version.')
			process.exit(1)
		}

		const latestVersion = latestVersionStr.replace(/^v/, '')
		if (currentVersion === latestVersion) {
			s.stop(`Already up to date. (v${currentVersion})`)
			const shouldForce = await p.confirm({
				message: 'Re-install current version (includes dashboard rebuild)?',
				initialValue: false
			})
			if (!shouldForce || p.isCancel(shouldForce)) {
				p.outro(pc.green('No update required.'))
				process.exit(0)
			}
			s.start('Re-installing...')
		}

		s.message(`New version found: v${latestVersion}.`)

		// 1. Determine OS and Arch for binary
		const sysOS = process.platform
		const sysArch = process.arch

		let osName = ''
		if (sysOS === 'darwin') osName = 'darwin'
		else if (sysOS === 'linux') osName = 'linux'

		let archName = ''
		if (sysArch === 'arm64' || (sysArch as string) === 'aarch64') archName = 'arm64'
		else if (sysArch === 'x64') archName = 'x64'

		const hasBinary = osName && archName
		const assetName = `tamias-${osName}-${archName}`
		const binaryAsset = release.assets?.find((a: any) => a.name === assetName)

		// 2. Binary Update
		const currentExecPath = process.execPath
		const isCompiled = !currentExecPath.includes('/bun') && !currentExecPath.includes('/node')

		if (isCompiled && binaryAsset) {
			s.message(`Downloading binary for ${osName}-${archName}...`)
			const downloadRes = await fetch(binaryAsset.browser_download_url)
			if (downloadRes.ok) {
				const arrayBuffer = await downloadRes.arrayBuffer()
				const buffer = Buffer.from(arrayBuffer)
				const tmpPath = `${currentExecPath}.tmp.update`
				fs.writeFileSync(tmpPath, buffer)
				fs.chmodSync(tmpPath, 0o755)
				fs.renameSync(tmpPath, currentExecPath)
				s.message('Binary updated.')
			} else {
				p.log.warn('Binary download failed, but continuing with dashboard update...')
			}
		} else if (isCompiled && !binaryAsset) {
			p.log.warn(`No binary asset found for ${osName}-${archName}. Skipping binary update.`)
		} else {
			p.log.info('Running in development/uncompiled mode. Skipping binary update.')
		}

		// 3. Dashboard Update
		const candidatePaths = [
			join(homedir(), '.tamias', 'src', 'dashboard'),
			join(process.cwd(), 'src', 'dashboard'),
		]
		const dashboardDir = candidatePaths.find((path) => fs.existsSync(path)) ?? ''

		if (dashboardDir) {
			s.message(`Updating dashboard source at ${dashboardDir}...`)
			const tmpDir = join(homedir(), '.tamias', 'tmp-update')
			if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
			fs.mkdirSync(tmpDir, { recursive: true })

			try {
				// Download source ZIP
				const zipUrl = `https://github.com/${REPO}/archive/refs/tags/${latestVersionStr}.zip`
				execSync(`curl -fsSL "${zipUrl}" -o "${tmpDir}/src.zip"`)
				execSync(`unzip -q "${tmpDir}/src.zip" -d "${tmpDir}/extracted"`)

				// Find dashboard in ZIP - be robust about the root directory name
				const extractedDirs = fs.readdirSync(join(tmpDir, 'extracted'))
				let newDashSrc = ''

				for (const dir of extractedDirs) {
					const candidate = join(tmpDir, 'extracted', dir, 'src', 'dashboard')
					if (fs.existsSync(candidate)) {
						newDashSrc = candidate
						break
					}
					// Also check if dashboard is at the root of the extracted dir (older versions?)
					const candidate2 = join(tmpDir, 'extracted', dir, 'dashboard')
					if (fs.existsSync(candidate2)) {
						newDashSrc = candidate2
						break
					}
				}

				if (fs.existsSync(newDashSrc)) {
					// Backup current dashboard just in case? Or just replace.
					// Let's replace.
					fs.rmSync(dashboardDir, { recursive: true, force: true })
					fs.cpSync(newDashSrc, dashboardDir, { recursive: true })

					if (fs.existsSync(join(dashboardDir, 'package.json'))) {
						s.message('Installing dashboard dependencies...')
						execSync(`bun install`, { cwd: dashboardDir, stdio: 'ignore' })

						s.message('Building dashboard...')
						execSync(`bun run build`, { cwd: dashboardDir, stdio: 'ignore' })

						s.message('Dashboard updated and built.')
					} else {
						p.log.warn(`No package.json found in ${dashboardDir}. Skipping install/build.`)
					}
				}
			} catch (e) {
				p.log.error(`Dashboard update failed: ${String(e)}`)
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true })
			}
		}

		s.stop(`Successfully updated to v${latestVersion}!`)
		p.outro(pc.green('Update complete.'))

	} catch (err) {
		p.cancel(pc.red(`Update failed: ${String(err)}`))
	}
}
