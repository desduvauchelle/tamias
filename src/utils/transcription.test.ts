/**
 * Tests for src/utils/transcription.ts (Parakeet / sherpa-onnx backend)
 *
 * Mocking strategy:
 *   - fluent-ffmpeg / ffmpeg-static: mock.module (same as before)
 *   - Bun.spawn: replace _bunSpawn.fn on the exported hook object
 *   - fetch: replace _httpFetch.fn on the exported hook object
 *   - Model files: created on disk in the TAMIAS_CONFIG_PATH temp dir
 *   - Download state: reset via _downloadState.promise = null
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { PassThrough } from 'stream'
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { getConfigFilePath } from './config.ts'

// ── WAV buffer factory (kept from old tests) ──────────────────────────────────

function makeWavBuffer(samples: number[]): Buffer {
	const numChannels = 1
	const sampleRate = 16000
	const bitsPerSample = 16
	const dataSize = samples.length * 2
	const buf = Buffer.alloc(44 + dataSize)
	buf.write('RIFF', 0)
	buf.writeUInt32LE(36 + dataSize, 4)
	buf.write('WAVE', 8)
	buf.write('fmt ', 12)
	buf.writeUInt32LE(16, 16)
	buf.writeUInt16LE(1, 20)
	buf.writeUInt16LE(numChannels, 22)
	buf.writeUInt32LE(sampleRate, 24)
	buf.writeUInt32LE(sampleRate * numChannels * 2, 28)
	buf.writeUInt16LE(numChannels * 2, 32)
	buf.writeUInt16LE(bitsPerSample, 34)
	buf.write('data', 36)
	buf.writeUInt32LE(dataSize, 40)
	for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2)
	return buf
}

// ── ffmpeg mock (unchanged from old tests) ────────────────────────────────────

let wavBufToReturn: Buffer = makeWavBuffer([100, 200, -100, -200])

const mockFfmpegCommand = {
	toFormat(this: any) { return this },
	audioFrequency(this: any) { return this },
	audioChannels(this: any) { return this },
	_endHandler: null as ((...args: any[]) => void) | null,
	_errHandler: null as ((...args: any[]) => void) | null,
	on(this: any, event: string, handler: (...args: any[]) => void) {
		if (event === 'end') this._endHandler = handler
		if (event === 'error') this._errHandler = handler
		return this
	},
	pipe(this: any) {
		const pt = new PassThrough()
		setImmediate(() => {
			pt.write(wavBufToReturn)
			pt.end()
			if (this._endHandler) this._endHandler()
		})
		return pt
	},
}

const ffmpegFactory = function (_input: any) {
	mockFfmpegCommand._endHandler = null
	mockFfmpegCommand._errHandler = null
	return mockFfmpegCommand
} as any
ffmpegFactory.setFfmpegPath = () => { }

mock.module('fluent-ffmpeg', () => ({ default: ffmpegFactory }))
mock.module('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }))

// ── Import module under test ──────────────────────────────────────────────────

const {
	transcribeAudioBuffer,
	ensureModelReady,
	prefetchModelInBackground,
	configureFfmpegPathForRuntime,
	_bunSpawn,
	_httpFetch,
	_downloadState,
	_ffmpegRuntime,
} = await import('./transcription.ts')

// ── Helpers ───────────────────────────────────────────────────────────────────

const REQUIRED_FILES = ['sherpa-onnx-offline', 'encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
const enc = new TextEncoder()

function getParakeetDir(): string {
	return join(dirname(getConfigFilePath()), 'models', 'parakeet')
}

function createModelFiles(): void {
	const dir = getParakeetDir()
	mkdirSync(dir, { recursive: true })
	for (const f of REQUIRED_FILES) writeFileSync(join(dir, f), 'ok')
}

function makeMockProc(stdout: string, exitCode = 0, stderr = '') {
	return {
		stdout: new ReadableStream<Uint8Array>({
			start(c) { if (stdout) c.enqueue(enc.encode(stdout)); c.close() },
		}),
		stderr: new ReadableStream<Uint8Array>({
			start(c) { if (stderr) c.enqueue(enc.encode(stderr)); c.close() },
		}),
		exited: Promise.resolve(exitCode),
	}
}

const originalSpawnFn = _bunSpawn.fn
const originalFetchFn = _httpFetch.fn

beforeEach(() => {
	_bunSpawn.fn = originalSpawnFn
	_httpFetch.fn = originalFetchFn
	_downloadState.promise = null
	_ffmpegRuntime.staticPath = '/usr/bin/ffmpeg'
	_ffmpegRuntime.envPathLookup = () => undefined
	_ffmpegRuntime.pathLookup = () => null
	_ffmpegRuntime.commonPaths = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
	_ffmpegRuntime.pathExists = (path: string) => path === '/usr/bin/ffmpeg'
	_ffmpegRuntime.setPath = () => { }
	_ffmpegRuntime.configured = false
	wavBufToReturn = makeWavBuffer([100, 200, -100, -200])
	// Clean up any model files created by previous tests so ensureModelReady
	// correctly triggers a download in the concurrent-calls test
	rmSync(getParakeetDir(), { recursive: true, force: true })
})

describe('configureFfmpegPathForRuntime', () => {
	test('uses ffmpeg-static path when binary exists', () => {
		const setPathMock = mock(() => { })
		_ffmpegRuntime.staticPath = '/opt/ffmpeg-static/ffmpeg'
		_ffmpegRuntime.pathExists = (path: string) => path === '/opt/ffmpeg-static/ffmpeg'
		_ffmpegRuntime.setPath = setPathMock
		_ffmpegRuntime.configured = false

		configureFfmpegPathForRuntime()

		expect(setPathMock).toHaveBeenCalledTimes(1)
		expect(setPathMock).toHaveBeenCalledWith('/opt/ffmpeg-static/ffmpeg')
		expect(_ffmpegRuntime.configured).toBe(true)
	})

	test('falls back to PATH when ffmpeg-static path is missing', () => {
		const setPathMock = mock(() => { })
		_ffmpegRuntime.staticPath = '/missing/ffmpeg'
		_ffmpegRuntime.pathLookup = () => '/usr/bin/ffmpeg'
		_ffmpegRuntime.pathExists = (path: string) => path === '/usr/bin/ffmpeg'
		_ffmpegRuntime.setPath = setPathMock
		_ffmpegRuntime.configured = false

		configureFfmpegPathForRuntime()

		expect(setPathMock).toHaveBeenCalledTimes(1)
		expect(setPathMock).toHaveBeenCalledWith('/usr/bin/ffmpeg')
		expect(_ffmpegRuntime.configured).toBe(true)
	})

	test('uses FFMPEG_PATH when provided and existing', () => {
		const setPathMock = mock(() => { })
		_ffmpegRuntime.staticPath = null
		_ffmpegRuntime.envPathLookup = () => '/custom/bin/ffmpeg'
		_ffmpegRuntime.pathLookup = () => null
		_ffmpegRuntime.pathExists = (path: string) => path === '/custom/bin/ffmpeg'
		_ffmpegRuntime.setPath = setPathMock
		_ffmpegRuntime.configured = false

		configureFfmpegPathForRuntime()

		expect(setPathMock).toHaveBeenCalledTimes(1)
		expect(setPathMock).toHaveBeenCalledWith('/custom/bin/ffmpeg')
		expect(_ffmpegRuntime.configured).toBe(true)
	})

	test('falls back to common system locations when PATH lookup fails', () => {
		const setPathMock = mock(() => { })
		_ffmpegRuntime.staticPath = null
		_ffmpegRuntime.envPathLookup = () => undefined
		_ffmpegRuntime.pathLookup = () => null
		_ffmpegRuntime.commonPaths = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
		_ffmpegRuntime.pathExists = (path: string) => path === '/opt/homebrew/bin/ffmpeg'
		_ffmpegRuntime.setPath = setPathMock
		_ffmpegRuntime.configured = false

		configureFfmpegPathForRuntime()

		expect(setPathMock).toHaveBeenCalledTimes(1)
		expect(setPathMock).toHaveBeenCalledWith('/opt/homebrew/bin/ffmpeg')
		expect(_ffmpegRuntime.configured).toBe(true)
	})

	test('warns when no ffmpeg candidate exists', () => {
		const setPathMock = mock(() => { })
		const warnSpy = mock((_message?: unknown, ..._args: unknown[]) => { })
		const originalWarn = console.warn
		console.warn = warnSpy as unknown as typeof console.warn
		_ffmpegRuntime.staticPath = null
		_ffmpegRuntime.envPathLookup = () => undefined
		_ffmpegRuntime.pathLookup = () => null
		_ffmpegRuntime.commonPaths = ['/missing/a', '/missing/b']
		_ffmpegRuntime.pathExists = () => false
		_ffmpegRuntime.setPath = setPathMock
		_ffmpegRuntime.configured = false

		try {
			configureFfmpegPathForRuntime()
		} finally {
			console.warn = originalWarn
		}

		expect(setPathMock).not.toHaveBeenCalled()
		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(warnSpy.mock.calls[0][0]).toContain('ffmpeg binary not found')
		expect(_ffmpegRuntime.configured).toBe(false)
	})

	test('is idempotent after first configuration', () => {
		const setPathMock = mock(() => { })
		_ffmpegRuntime.staticPath = '/opt/ffmpeg-static/ffmpeg'
		_ffmpegRuntime.pathExists = (path: string) => path === '/opt/ffmpeg-static/ffmpeg'
		_ffmpegRuntime.setPath = setPathMock
		_ffmpegRuntime.configured = false

		configureFfmpegPathForRuntime()
		configureFfmpegPathForRuntime()

		expect(setPathMock).toHaveBeenCalledTimes(1)
	})

	test('retries configuration later when ffmpeg becomes available after an initial miss', () => {
		const setPathMock = mock(() => { })
		let ffmpegPresent = false
		_ffmpegRuntime.staticPath = null
		_ffmpegRuntime.envPathLookup = () => ffmpegPresent ? '/opt/homebrew/bin/ffmpeg' : undefined
		_ffmpegRuntime.pathLookup = () => null
		_ffmpegRuntime.commonPaths = []
		_ffmpegRuntime.pathExists = (path: string) => path === '/opt/homebrew/bin/ffmpeg' && ffmpegPresent
		_ffmpegRuntime.setPath = setPathMock
		_ffmpegRuntime.configured = false

		configureFfmpegPathForRuntime()
		expect(setPathMock).toHaveBeenCalledTimes(0)
		expect(_ffmpegRuntime.configured).toBe(false)

		ffmpegPresent = true
		configureFfmpegPathForRuntime()
		expect(setPathMock).toHaveBeenCalledTimes(1)
		expect(setPathMock).toHaveBeenCalledWith('/opt/homebrew/bin/ffmpeg')
		expect(_ffmpegRuntime.configured).toBe(true)
	})
})

// ── transcribeAudioBuffer ─────────────────────────────────────────────────────

describe('transcribeAudioBuffer', () => {
	describe('with model files present', () => {
		beforeEach(() => {
			createModelFiles()
		})

		test('happy path: returns transcript stripped of timestamp lines', async () => {
			_bunSpawn.fn = mock(() => makeMockProc('0:00:00.000 --> 0:00:03.000\n Hello world\n'))
			const result = await transcribeAudioBuffer(Buffer.from('fake ogg'))
			expect(result).toBe('Hello world')
		})

		test('happy path: extracts text from JSON output format', async () => {
			const jsonOutput = '{"lang": "", "emotion": "", "event": "", "text": "This is a test.", "timestamps": [0.24], "tokens": [" This"]}\n'
			_bunSpawn.fn = mock(() => makeMockProc(`some config line\nDone!\n\n/path/to/file.wav\n----\nnum threads: 4\n${jsonOutput}`))
			const result = await transcribeAudioBuffer(Buffer.from('fake ogg'))
			expect(result).toBe('This is a test.')
		})

		test('multi-segment output: joins text lines with space', async () => {
			_bunSpawn.fn = mock(() => makeMockProc(
				'0:00:00.000 --> 0:00:02.000\n First part\n0:00:02.000 --> 0:00:05.000\n second part\n'
			))
			const result = await transcribeAudioBuffer(Buffer.from('fake ogg'))
			expect(result).toBe('First part second part')
		})

		test('empty stdout returns empty string', async () => {
			_bunSpawn.fn = mock(() => makeMockProc(''))
			const result = await transcribeAudioBuffer(Buffer.from('fake ogg'))
			expect(result).toBe('')
		})

		test('subprocess non-zero exit rejects with descriptive error', async () => {
			_bunSpawn.fn = mock(() => makeMockProc('', 1, 'model file not found'))
			await expect(transcribeAudioBuffer(Buffer.from('fake ogg')))
				.rejects.toThrow('sherpa-onnx-offline failed')
		})

		test('deletes binary and resets download state on dylib load failure', async () => {
			_bunSpawn.fn = mock(() => makeMockProc('', 134,
				'dyld[123]: Library not loaded: @rpath/libonnxruntime.1.23.2.dylib'))

			const dir = getParakeetDir()

			await expect(transcribeAudioBuffer(Buffer.from('fake ogg')))
				.rejects.toThrow('sherpa-onnx-offline failed')

			// Binary should have been deleted so next call re-downloads the static build
			expect(existsSync(join(dir, 'sherpa-onnx-offline'))).toBe(false)
			expect(_downloadState.promise).toBeNull()
		})

		test('temp wav file is deleted even when subprocess throws', async () => {
			_bunSpawn.fn = mock(() => { throw new Error('spawn failed') })

			const tmpFilesBefore = readdirSync(tmpdir()).filter(f => f.startsWith('tamias-audio-'))
			await expect(transcribeAudioBuffer(Buffer.from('fake ogg'))).rejects.toThrow()
			const tmpFilesAfter = readdirSync(tmpdir()).filter(f => f.startsWith('tamias-audio-'))

			expect(tmpFilesAfter).toEqual(tmpFilesBefore)
		})
	})
})

// ── ensureModelReady ──────────────────────────────────────────────────────────

describe('ensureModelReady', () => {
	test('returns immediately and skips fetch when all 5 files are present', async () => {
		createModelFiles()
		const mockFetchFn = mock(async () => new Response('{}'))
		_httpFetch.fn = mockFetchFn

		await ensureModelReady()
		await ensureModelReady()

		expect(mockFetchFn).not.toHaveBeenCalled()
	})

	test('concurrent calls before model ready trigger only one download', () => {
		_downloadState.promise = null

		let fetchCallCount = 0
		_httpFetch.fn = mock(async () => {
			fetchCallCount++
			return new Promise<Response>(() => { }) // never resolves — holds download open
		})

		// Start two concurrent calls (no await — we're inspecting mid-flight state)
		void ensureModelReady()
		void ensureModelReady()

		// Only one fetch should have been initiated
		expect(fetchCallCount).toBe(1)
		// Both calls share the same pending promise
		expect(_downloadState.promise).not.toBeNull()
	})

	test('triggers download when model files are absent and fetch is called', async () => {
		// Model dir is empty (beforeEach already cleaned it)
		let calledUrls: string[] = []

		_httpFetch.fn = mock(async (url: string | URL | Request) => {
			calledUrls.push(typeof url === 'string' ? url : url.toString())

			// First call: GitHub releases API — return a fake release with a matching asset
			if (typeof url === 'string' && url.includes('api.github.com')) {
				return new Response(JSON.stringify({
					assets: [{ name: 'sherpa-onnx-v1.0.0-osx-arm64.tar.bz2', browser_download_url: 'https://example.com/bin.tar.bz2' }]
				}), { status: 200 })
			}

			// Subsequent calls (binary + model downloads) — return an empty ok response
			return new Response(new Uint8Array(0), { status: 200 })
		})

		// Mock tar extraction and find to succeed without real files
		_bunSpawn.fn = mock(() => makeMockProc('some/path/sherpa-onnx-offline'))

		// This will fail because Bun.write can't write to a real path and find returns a fake path,
		// but we only care that _httpFetch was called with the GitHub API URL
		try {
			await ensureModelReady()
		} catch {
			// Expected — the fake extraction path doesn't exist
		}

		expect(calledUrls[0]).toContain('api.github.com')
	})

	test('treats zero-byte model files as invalid and re-downloads', async () => {
		const dir = getParakeetDir()
		mkdirSync(dir, { recursive: true })
		for (const f of REQUIRED_FILES) writeFileSync(join(dir, f), '')

		const calledUrls: string[] = []
		_httpFetch.fn = mock(async (url: string | URL | Request) => {
			const stringUrl = typeof url === 'string' ? url : url.toString()
			calledUrls.push(stringUrl)
			if (stringUrl.includes('api.github.com')) {
				return new Response(JSON.stringify({
					assets: [{ name: 'sherpa-onnx-v1.0.0-osx-arm64.tar.bz2', browser_download_url: 'https://example.com/bin.tar.bz2' }]
				}), { status: 200 })
			}
			return new Response(new Uint8Array(0), { status: 200 })
		})
		_bunSpawn.fn = mock(() => makeMockProc('some/path/sherpa-onnx-offline'))

		try {
			await ensureModelReady()
		} catch {
			// Expected due to mocked extraction path.
		}

		expect(calledUrls[0]).toContain('api.github.com')
	})

	test('accepts modern darwin-arm64 asset names from sherpa releases', async () => {
		let calledUrls: string[] = []

		_httpFetch.fn = mock(async (url: string | URL | Request) => {
			calledUrls.push(typeof url === 'string' ? url : url.toString())

			if (typeof url === 'string' && url.includes('api.github.com')) {
				return new Response(JSON.stringify({
					assets: [{ name: 'sherpa-onnx-v1.0.0-darwin-arm64.tar.bz2', browser_download_url: 'https://example.com/bin.tar.bz2' }]
				}), { status: 200 })
			}

			return new Response(new Uint8Array(0), { status: 200 })
		})

		_bunSpawn.fn = mock(() => makeMockProc('some/path/sherpa-onnx-offline'))

		try {
			await ensureModelReady()
		} catch {
			// Expected — mocked extraction path does not exist on disk.
		}

		expect(calledUrls[0]).toContain('api.github.com')
		expect(calledUrls).toContain('https://example.com/bin.tar.bz2')
	})
})

// ── prefetchModelInBackground ─────────────────────────────────────────────────

describe('prefetchModelInBackground', () => {
	test('does nothing when all model files are already present', () => {
		createModelFiles()
		const mockFetchFn = mock(async () => new Response('{}'))
		_httpFetch.fn = mockFetchFn

		prefetchModelInBackground()

		expect(mockFetchFn).not.toHaveBeenCalled()
		expect(_downloadState.promise).toBeNull()
	})

	test('sets _downloadState.promise when model files are absent', () => {
		_httpFetch.fn = mock(async () => new Promise<Response>(() => { })) // never resolves

		prefetchModelInBackground()

		expect(_downloadState.promise).not.toBeNull()
	})

	test('does not start a second download if one is already in progress', () => {
		let fetchCallCount = 0
		_httpFetch.fn = mock(async () => {
			fetchCallCount++
			return new Promise<Response>(() => { })
		})

		prefetchModelInBackground()
		prefetchModelInBackground()

		expect(fetchCallCount).toBe(1)
	})

	test('clears _downloadState.promise on network failure (allows retry)', async () => {
		_httpFetch.fn = mock(async () => { throw new Error('network down') })

		prefetchModelInBackground()
		expect(_downloadState.promise).not.toBeNull()

		await _downloadState.promise?.catch(() => { })
		await new Promise(r => setTimeout(r, 0))

		expect(_downloadState.promise).toBeNull()
	})
})
