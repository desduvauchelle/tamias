import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import fs from 'node:fs'

const REPO = 'desduvauchelle/tamias'

export const runUpdateCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias CLI Update ')))

	try {
		// Read current version from package.json
		const pkgJsonStr = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
		const pkg = JSON.parse(pkgJsonStr)
		const currentVersion = pkg.version

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

		// naive version check: if v1.0.1 != 1.0.0
		const latestVersion = latestVersionStr.replace(/^v/, '')
		if (currentVersion === latestVersion) {
			s.stop(`Already up to date. (v${currentVersion})`)
			p.outro(pc.green('No update required.'))
			process.exit(0)
		}

		s.message(`New version found: v${latestVersion}. Downloading...`)

		// Determine OS and Arch
		const sysOS = process.platform // 'darwin' | 'linux' | 'win32'
		const sysArch = process.arch // 'arm64' | 'x64'

		let osName = ''
		if (sysOS === 'darwin') osName = 'darwin'
		else if (sysOS === 'linux') osName = 'linux'
		else {
			s.stop('Unsupported OS.')
			p.cancel(pc.red(`Auto-update is not supported on ${sysOS}.`))
			process.exit(1)
		}

		let archName = ''
		if (sysArch === 'arm64' || (sysArch as string) === 'aarch64') archName = 'arm64'
		else if (sysArch === 'x64') archName = 'x64'
		else {
			s.stop('Unsupported architecture.')
			p.cancel(pc.red(`Auto-update is not supported on architecture ${sysArch}.`))
			process.exit(1)
		}

		const assetName = `tamias-${osName}-${archName}`
		const asset = release.assets?.find((a: any) => a.name === assetName)

		if (!asset) {
			s.stop(`Version v${latestVersion} is out, but there's no binary for ${osName}-${archName} yet.`)
			p.cancel(pc.yellow('Please try again later. Build artifacts might still be generating.'))
			process.exit(1)
		}

		// Download
		const downloadRes = await fetch(asset.browser_download_url)
		if (!downloadRes.ok) {
			s.stop('Download failed.')
			p.cancel(pc.red(`Failed to download asset: ${downloadRes.statusText}`))
			process.exit(1)
		}

		const arrayBuffer = await downloadRes.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)

		// Write to temporary location, then move it
		const currentExecPath = process.execPath // Typically /User/x/.bun/bin/tamias or /usr/local/bin/tamias

		// Let's rely on the location currently actually being executed from
		const tmpPath = `${currentExecPath}.tmp.update`

		fs.writeFileSync(tmpPath, buffer)
		fs.chmodSync(tmpPath, 0o755)

		// overwrite existing
		fs.renameSync(tmpPath, currentExecPath)

		s.stop(`Successfully updated to v${latestVersion}!`)
		p.outro(pc.green('Run `tamias` to use the new version.'))

	} catch (err) {
		p.cancel(pc.red(`Update failed: ${String(err)}`))
	}
}
