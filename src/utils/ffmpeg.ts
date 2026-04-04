type PlatformName = NodeJS.Platform

export const _ffmpegLaunchRuntime: {
	getCommandPath: (binary: string) => string | null
	getPlatform: () => PlatformName
	installWithBrew: (brewPath: string) => Promise<{ code: number; stderr: string }>
} = {
	getCommandPath: (binary: string) => Bun.which(binary),
	getPlatform: () => process.platform,
	installWithBrew: async (brewPath: string) => {
		const proc = Bun.spawn([brewPath, 'install', 'ffmpeg'], { stdout: 'ignore', stderr: 'pipe' })
		const code = await proc.exited
		const stderr = await new Response(proc.stderr ?? new ReadableStream()).text()
		return { code, stderr }
	},
}

export async function ensureFfmpegAvailableOnLaunch(): Promise<boolean> {
	const existingPath = _ffmpegLaunchRuntime.getCommandPath('ffmpeg')
	if (existingPath) {
		process.env.FFMPEG_PATH = existingPath
		return true
	}

	console.warn('[Transcription] ffmpeg not found — attempting automatic install...')
	if (_ffmpegLaunchRuntime.getPlatform() !== 'darwin') {
		console.warn('[Transcription] Automatic ffmpeg install is currently supported on macOS with Homebrew.')
		return false
	}

	const brewPath = _ffmpegLaunchRuntime.getCommandPath('brew')
	if (!brewPath) {
		console.warn('[Transcription] Homebrew not found. Install ffmpeg manually (e.g. `brew install ffmpeg`).')
		return false
	}

	const installResult = await _ffmpegLaunchRuntime.installWithBrew(brewPath)
	if (installResult.code !== 0) {
		console.warn(`[Transcription] Failed to install ffmpeg via Homebrew (exit ${installResult.code}). ${installResult.stderr}`.trim())
		return false
	}

	const installedPath = _ffmpegLaunchRuntime.getCommandPath('ffmpeg')
	if (!installedPath) {
		console.warn('[Transcription] ffmpeg install command succeeded, but ffmpeg is still not in PATH.')
		return false
	}

	process.env.FFMPEG_PATH = installedPath
	console.log(`[Transcription] ffmpeg installed and detected at ${installedPath}`)
	return true
}
