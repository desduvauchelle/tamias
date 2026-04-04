import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { _ffmpegLaunchRuntime, ensureFfmpegAvailableOnLaunch } from './ffmpeg.ts'

const originalGetCommandPath = _ffmpegLaunchRuntime.getCommandPath
const originalGetPlatform = _ffmpegLaunchRuntime.getPlatform
const originalInstallWithBrew = _ffmpegLaunchRuntime.installWithBrew
const originalFfmpegEnv = process.env.FFMPEG_PATH

beforeEach(() => {
	_ffmpegLaunchRuntime.getCommandPath = originalGetCommandPath
	_ffmpegLaunchRuntime.getPlatform = originalGetPlatform
	_ffmpegLaunchRuntime.installWithBrew = originalInstallWithBrew
	delete process.env.FFMPEG_PATH
})

afterAll(() => {
	_ffmpegLaunchRuntime.getCommandPath = originalGetCommandPath
	_ffmpegLaunchRuntime.getPlatform = originalGetPlatform
	_ffmpegLaunchRuntime.installWithBrew = originalInstallWithBrew
	if (originalFfmpegEnv === undefined) {
		delete process.env.FFMPEG_PATH
	} else {
		process.env.FFMPEG_PATH = originalFfmpegEnv
	}
})

describe('ensureFfmpegAvailableOnLaunch', () => {
	test('happy path: uses existing ffmpeg from PATH', async () => {
		_ffmpegLaunchRuntime.getCommandPath = (binary: string) => binary === 'ffmpeg' ? '/usr/bin/ffmpeg' : null
		const installed = await ensureFfmpegAvailableOnLaunch()
		expect(installed).toBe(true)
		expect(process.env.FFMPEG_PATH).toBe('/usr/bin/ffmpeg')
	})

	test('missing ffmpeg on non-macos returns false', async () => {
		_ffmpegLaunchRuntime.getPlatform = () => 'linux'
		_ffmpegLaunchRuntime.getCommandPath = () => null
		const installed = await ensureFfmpegAvailableOnLaunch()
		expect(installed).toBe(false)
		expect(process.env.FFMPEG_PATH).toBeUndefined()
	})

	test('missing brew on macos returns false', async () => {
		_ffmpegLaunchRuntime.getPlatform = () => 'darwin'
		_ffmpegLaunchRuntime.getCommandPath = () => null
		const installed = await ensureFfmpegAvailableOnLaunch()
		expect(installed).toBe(false)
		expect(process.env.FFMPEG_PATH).toBeUndefined()
	})

	test('brew install failure returns false', async () => {
		_ffmpegLaunchRuntime.getPlatform = () => 'darwin'
		_ffmpegLaunchRuntime.getCommandPath = (binary: string) => binary === 'brew' ? '/opt/homebrew/bin/brew' : null
		_ffmpegLaunchRuntime.installWithBrew = mock(async () => ({ code: 1, stderr: 'error' }))

		const installed = await ensureFfmpegAvailableOnLaunch()
		expect(installed).toBe(false)
		expect(process.env.FFMPEG_PATH).toBeUndefined()
	})

	test('brew install success sets FFMPEG_PATH', async () => {
		let ffmpegInstalled = false
		_ffmpegLaunchRuntime.getPlatform = () => 'darwin'
		_ffmpegLaunchRuntime.getCommandPath = (binary: string) => {
			if (binary === 'brew') return '/opt/homebrew/bin/brew'
			if (binary === 'ffmpeg') return ffmpegInstalled ? '/opt/homebrew/bin/ffmpeg' : null
			return null
		}
		_ffmpegLaunchRuntime.installWithBrew = mock(async () => {
			ffmpegInstalled = true
			return { code: 0, stderr: '' }
		})

		const installed = await ensureFfmpegAvailableOnLaunch()
		expect(installed).toBe(true)
		expect(process.env.FFMPEG_PATH).toBe('/opt/homebrew/bin/ffmpeg')
	})
})
