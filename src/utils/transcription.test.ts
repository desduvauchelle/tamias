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
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs'
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
ffmpegFactory.setFfmpegPath = () => {}

mock.module('fluent-ffmpeg', () => ({ default: ffmpegFactory }))
mock.module('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }))

// ── Import module under test ──────────────────────────────────────────────────

const {
	transcribeAudioBuffer,
	ensureModelReady,
	_bunSpawn,
	_httpFetch,
	_downloadState,
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
	for (const f of REQUIRED_FILES) writeFileSync(join(dir, f), '')
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
	wavBufToReturn = makeWavBuffer([100, 200, -100, -200])
	// Clean up any model files created by previous tests so ensureModelReady
	// correctly triggers a download in the concurrent-calls test
	rmSync(getParakeetDir(), { recursive: true, force: true })
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
			return new Promise<Response>(() => {}) // never resolves — holds download open
		})

		// Start two concurrent calls (no await — we're inspecting mid-flight state)
		void ensureModelReady()
		void ensureModelReady()

		// Only one fetch should have been initiated
		expect(fetchCallCount).toBe(1)
		// Both calls share the same pending promise
		expect(_downloadState.promise).not.toBeNull()
	})
})
