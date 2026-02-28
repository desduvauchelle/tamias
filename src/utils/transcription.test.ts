/**
 * Tests for src/utils/transcription.ts
 *
 * @xenova/transformers and fluent-ffmpeg are mocked so tests run without
 * native binaries or model downloads.  The real wavefile package is used with
 * a valid WAV buffer returned by the ffmpeg mock, so WaveFile parses real data
 * without needing its own mock.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { PassThrough } from 'stream'

// ── WAV buffer factory ────────────────────────────────────────────────────────

/**
 * Build a minimal valid PCM WAV (16-bit, 16kHz, mono) from signed-16 samples.
 */
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
	buf.writeUInt16LE(1, 20)           // PCM
	buf.writeUInt16LE(numChannels, 22)
	buf.writeUInt32LE(sampleRate, 24)
	buf.writeUInt32LE(sampleRate * numChannels * 2, 28) // ByteRate
	buf.writeUInt16LE(numChannels * 2, 32)              // BlockAlign
	buf.writeUInt16LE(bitsPerSample, 34)
	buf.write('data', 36)
	buf.writeUInt32LE(dataSize, 40)
	for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2)
	return buf
}

// ── Mock @xenova/transformers ─────────────────────────────────────────────────

const mockTranscriber = mock(async (_data: Float32Array) => ({ text: 'hello world' })) as any
const mockPipeline = mock(async (_task: string, _model: string) => mockTranscriber) as any

mock.module('@xenova/transformers', () => ({
	pipeline: mockPipeline,
	env: { allowLocalModels: true },
}))

// ── Mock fluent-ffmpeg ────────────────────────────────────────────────────────
// Returns a valid WAV buffer so the real WaveFile can parse it.

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('transcription.ts', () => {
	beforeEach(() => {
		mockTranscriber.mockClear()
		mockTranscriber.mockImplementation(async (_data: Float32Array) => ({ text: 'hello world' }))
		wavBufToReturn = makeWavBuffer([100, 200, -100, -200])
	})

	describe('transcribeAudioBuffer — happy path', () => {
		test('returns transcript text from a normal audio buffer', async () => {
			const { transcribeAudioBuffer } = await import('./transcription.ts')
			const result = await transcribeAudioBuffer(Buffer.from('fake audio'))
			expect(result).toBe('hello world')
		})

		test('trims leading/trailing whitespace from transcript', async () => {
			mockTranscriber.mockImplementation(async () => ({ text: '  trimmed  ' }))
			const { transcribeAudioBuffer } = await import('./transcription.ts')
			const result = await transcribeAudioBuffer(Buffer.from('fake audio'))
			expect(result).toBe('trimmed')
		})

		test('handles array output from pipeline (joins with space)', async () => {
			mockTranscriber.mockImplementation(async () => [{ text: 'part one' }, { text: 'part two' }])
			const { transcribeAudioBuffer } = await import('./transcription.ts')
			const result = await transcribeAudioBuffer(Buffer.from('fake audio'))
			expect(result).toBe('part one part two')
		})
	})

	describe('transcribeAudioBuffer — silent audio', () => {
		test('returns empty string for completely silent audio', async () => {
			wavBufToReturn = makeWavBuffer([0, 0, 0, 0])
			const { transcribeAudioBuffer } = await import('./transcription.ts')
			const result = await transcribeAudioBuffer(Buffer.from('silent audio'))
			expect(result).toBe('')
		})

		test('returns empty string when pipeline returns empty text', async () => {
			mockTranscriber.mockImplementation(async () => ({ text: '' }))
			const { transcribeAudioBuffer } = await import('./transcription.ts')
			const result = await transcribeAudioBuffer(Buffer.from('fake audio'))
			expect(result).toBe('')
		})
	})

	describe('transcribeAudioBuffer — error paths', () => {
		test('propagates ffmpeg error as a rejected promise', async () => {
			const originalPipe = mockFfmpegCommand.pipe
			mockFfmpegCommand.pipe = function (this: any) {
				const pt = new PassThrough()
				setImmediate(() => {
					if (this._errHandler) this._errHandler(new Error('FFmpeg error: codec not found'))
					else pt.destroy(new Error('FFmpeg error: codec not found'))
				})
				return pt
			}

			const { transcribeAudioBuffer } = await import('./transcription.ts')
			await expect(transcribeAudioBuffer(Buffer.from('bad audio'))).rejects.toThrow('FFmpeg error')

			mockFfmpegCommand.pipe = originalPipe
		})
	})

	describe('initTranscriptionModel — idempotent', () => {
		test('model is loaded only once across multiple calls', async () => {
			const { initTranscriptionModel } = await import('./transcription.ts')
			const callsBefore = mockPipeline.mock.calls.length
			await initTranscriptionModel()
			await initTranscriptionModel()
			expect(mockPipeline.mock.calls.length).toBe(callsBefore)
		})
	})
})
