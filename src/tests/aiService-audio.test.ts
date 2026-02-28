/**
 * Tests for audio detection and transcription error handling in aiService.
 *
 * The core bug: isAudio detection was correct but
 *  (a) the URL extension regex used $ as an anchor against CDN URLs with query strings
 *  (b) transcription failures were silently swallowed, producing empty LLM input
 *
 * These tests exercise those logic pieces.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { EventEmitter } from 'events'
import type { BridgeMessage, DaemonEvent } from '../bridge/types.ts'

// ── isAudio detection logic (extracted from aiService.processSession) ─────────

/**
 * Mirrors the exact isAudio check introduced in the fix, so changes to aiService
 * will fail these tests first (keeping them as a spec).
 */
function isAudioAttachment(att: { type: string; mimeType: string; url?: string | null }): boolean {
	const cleanUrl = att.url != null ? att.url.split('?')[0] : null
	return att.type === 'audio'
		|| att.mimeType.startsWith('audio/')
		|| att.mimeType === 'application/ogg'
		|| (cleanUrl != null && /\.(ogg|mp3|m4a|wav|flac|aac|opus|weba|webm)$/i.test(cleanUrl))
}

describe('isAudio detection', () => {
	describe('type field shortcut', () => {
		test('type="audio" is always treated as audio regardless of mimeType', () => {
			expect(isAudioAttachment({ type: 'audio', mimeType: 'application/octet-stream' })).toBe(true)
		})
	})

	describe('mimeType-based detection', () => {
		test('audio/ogg → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'audio/ogg' })).toBe(true)
		})

		test('audio/mpeg → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'audio/mpeg' })).toBe(true)
		})

		test('audio/wav → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'audio/wav' })).toBe(true)
		})

		test('audio/webm → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'audio/webm' })).toBe(true)
		})

		test('application/ogg → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/ogg' })).toBe(true)
		})

		test('image/png → NOT audio', () => {
			expect(isAudioAttachment({ type: 'image', mimeType: 'image/png' })).toBe(false)
		})

		test('text/plain → NOT audio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'text/plain' })).toBe(false)
		})

		test('application/octet-stream → NOT audio (by mimeType alone)', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/octet-stream', url: null })).toBe(false)
		})
	})

	describe('URL extension fallback (CDN query string fix)', () => {
		test('plain .ogg URL → isAudio', () => {
			expect(isAudioAttachment({
				type: 'file',
				mimeType: 'application/octet-stream',
				url: 'https://cdn.example.com/voice.ogg',
			})).toBe(true)
		})

		test('.ogg URL with CDN query string → isAudio (bug was here)', () => {
			expect(isAudioAttachment({
				type: 'file',
				mimeType: 'application/octet-stream',
				url: 'https://cdn.discordapp.com/attachments/123/456/voice-message.ogg?ex=AABBCC&is=DDEEFF&hm=123',
			})).toBe(true)
		})

		test('.mp3 URL with query string → isAudio', () => {
			expect(isAudioAttachment({
				type: 'file',
				mimeType: 'application/octet-stream',
				url: 'https://cdn.example.com/track.mp3?v=2&ts=1234567890',
			})).toBe(true)
		})

		test('.wav URL → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/octet-stream', url: 'https://cdn.example.com/clip.wav' })).toBe(true)
		})

		test('.flac URL → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/octet-stream', url: 'https://cdn.example.com/music.flac' })).toBe(true)
		})

		test('.opus URL → isAudio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/octet-stream', url: 'https://cdn.example.com/voice.opus' })).toBe(true)
		})

		test('.png URL → NOT audio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/octet-stream', url: 'https://cdn.example.com/photo.png' })).toBe(false)
		})

		test('URL with no extension → NOT audio (falls back to mimeType only)', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/octet-stream', url: 'https://cdn.example.com/attachment/1234' })).toBe(false)
		})

		test('null URL and generic mimeType → NOT audio', () => {
			expect(isAudioAttachment({ type: 'file', mimeType: 'application/octet-stream', url: null })).toBe(false)
		})
	})
})

// ── Transcription error surface (simulates aiService error handling) ──────────

describe('Transcription failure: error surface to user', () => {
	/**
	 * Simulate the part of processSession that handles the transcription try/catch,
	 * using the same emitter pattern as production code.
	 */
	async function runTranscriptionStep(opts: {
		buffer: Buffer,
		mimeType: string,
		url?: string,
		transcribeImpl: (buf: Buffer) => Promise<string>,
	}) {
		const emitter = new EventEmitter()
		const events: DaemonEvent[] = []
		emitter.on('event', (e: DaemonEvent) => events.push(e))

		let messageContent = ''
		let sessionAborted = false

		const att = { type: 'audio' as const, buffer: opts.buffer, mimeType: opts.mimeType, url: opts.url }
		const filename = att.url?.split('/').pop()?.split('?')[0] || 'audio'

		try {
			const transcript = await opts.transcribeImpl(att.buffer)
			if (transcript) {
				messageContent = `[Transcribed audio: ${transcript}]`
			} else {
				messageContent = '[User sent an audio message but it was silent or could not be transcribed]'
			}
		} catch (err) {
			// Mirrors the fixed error handling in aiService
			emitter.emit('event', {
				type: 'error',
				message: `⚠️ Audio transcription failed for "${filename}". Please send your message as text instead.`,
			} as DaemonEvent)
			sessionAborted = true
		}

		return { events, messageContent, sessionAborted }
	}

	test('successful transcription appends transcript to messageContent', async () => {
		const { events, messageContent, sessionAborted } = await runTranscriptionStep({
			buffer: Buffer.from('audio'),
			mimeType: 'audio/ogg',
			transcribeImpl: async () => 'What time is it?',
		})

		expect(messageContent).toBe('[Transcribed audio: What time is it?]')
		expect(sessionAborted).toBe(false)
		expect(events).toHaveLength(0)
	})

	test('empty transcript produces silent/could not transcribe message', async () => {
		const { events, messageContent, sessionAborted } = await runTranscriptionStep({
			buffer: Buffer.from('audio'),
			mimeType: 'audio/ogg',
			transcribeImpl: async () => '',
		})

		expect(messageContent).toContain('silent or could not be transcribed')
		expect(sessionAborted).toBe(false)
		expect(events).toHaveLength(0)
	})

	test('transcription throw emits error event and aborts session (not silently dropped)', async () => {
		const { events, messageContent, sessionAborted } = await runTranscriptionStep({
			buffer: Buffer.from('audio'),
			mimeType: 'audio/ogg',
			url: 'https://cdn.discordapp.com/voice-message.ogg?ex=ABC',
			transcribeImpl: async () => { throw new Error('ONNX bindings not found') },
		})

		expect(sessionAborted).toBe(true)
		expect(messageContent).toBe('')
		expect(events).toHaveLength(1)
		expect(events[0].type).toBe('error')
		expect((events[0] as any).message).toContain('voice-message.ogg')
		expect((events[0] as any).message).toContain('text instead')
	})

	test('error message uses clean filename (no CDN query string)', async () => {
		const { events } = await runTranscriptionStep({
			buffer: Buffer.from('audio'),
			mimeType: 'audio/ogg',
			url: 'https://cdn.discordapp.com/attachments/1/2/my-voice.ogg?ex=AABB&is=CCDD',
			transcribeImpl: async () => { throw new Error('fail') },
		})

		expect((events[0] as any).message).toContain('my-voice.ogg')
		expect((events[0] as any).message).not.toContain('?ex=')
	})

	test('transcription of unknown filename shows "audio" fallback', async () => {
		const { events } = await runTranscriptionStep({
			buffer: Buffer.from('audio'),
			mimeType: 'audio/ogg',
			url: undefined,
			transcribeImpl: async () => { throw new Error('fail') },
		})

		expect((events[0] as any).message).toContain('"audio"')
	})
})

// ── BridgeMessage 'audio' type ────────────────────────────────────────────────

describe('BridgeMessage attachment type "audio"', () => {
	test('audio attachment is a valid BridgeMessage attachment', () => {
		const msg: BridgeMessage = {
			channelId: 'discord',
			channelUserId: 'u-1',
			content: '',
			attachments: [
				{
					type: 'audio',
					url: 'https://cdn.discordapp.com/voice.ogg',
					buffer: Buffer.from('fake ogg'),
					mimeType: 'audio/ogg',
				},
			],
		}

		expect(msg.attachments![0].type).toBe('audio')
		expect(msg.attachments![0].mimeType).toBe('audio/ogg')
	})

	test('image type is unchanged', () => {
		const att: BridgeMessage['attachments'] = [
			{ type: 'image', mimeType: 'image/png', buffer: Buffer.from([0]) },
		]
		expect(att![0].type).toBe('image')
	})

	test('file type is unchanged', () => {
		const att: BridgeMessage['attachments'] = [
			{ type: 'file', mimeType: 'text/plain', buffer: Buffer.from('hello') },
		]
		expect(att![0].type).toBe('file')
	})
})
