import { pipeline, env } from '@xenova/transformers'
import wavefilePkg from 'wavefile'
const WaveFile = wavefilePkg.WaveFile
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { Readable } from 'stream'

// Set ffmpeg path using the statically compiled binary
if (ffmpegStatic) {
	ffmpeg.setFfmpegPath(ffmpegStatic)
}

// Allow local models (it will cache them to node_modules/.cache by default)
env.allowLocalModels = true

let transcriber: any = null

export async function initTranscriptionModel() {
	if (!transcriber) {
		console.log('[Transcription] Loading Whisper model (Xenova/whisper-tiny)...')
		transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny')
		console.log('[Transcription] Model loaded.')
	}
}

/**
 * Converts an arbitrary audio buffer (like OGG from Telegram) to a 16kHz WAV buffer
 * suitable for Transformers.js
 */
function convertToWav(inputBuffer: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const inputStream = new Readable()
		inputStream.push(inputBuffer)
		inputStream.push(null)

		const buffers: Buffer[] = []

		const command = ffmpeg(inputStream)
			.toFormat('wav')
			// Whisper expects 16kHz sample rate
			.audioFrequency(16000)
			// Whisper expects mono audio
			.audioChannels(1)
			.on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
			.on('end', () => resolve(Buffer.concat(buffers)))

		// Pipe the output stream directly to collect buffers
		const ffStream = command.pipe()
		ffStream.on('data', (chunk) => buffers.push(chunk))
	})
}

/**
 * Transcribes an audio buffer and returns the text.
 * @param buffer The input audio buffer in any format supported by FFmpeg (e.g. OGG)
 * @returns The transcribed text
 */
export async function transcribeAudioBuffer(buffer: Buffer): Promise<string> {
	await initTranscriptionModel()

	// 1. Convert input audio to 16kHz WAV using FFmpeg
	const wavBuffer = await convertToWav(buffer)

	// 2. Parse WAV to get raw PCM float32 samples
	const wav = new WaveFile(wavBuffer)

	// Ensure it's 32-bit float as expected by Transformers.js
	wav.toBitDepth('32f')
	wav.toSampleRate(16000)

	let audioData: any = wav.getSamples()

	if (Array.isArray(audioData)) {
		audioData = audioData.length > 0 ? audioData[0] : new Float32Array(0)
	}

	let float32Data = new Float32Array(audioData.length)
	let maxAmp = 0
	for (let i = 0; i < audioData.length; i++) {
		float32Data[i] = audioData[i]
		if (Math.abs(audioData[i]) > maxAmp) maxAmp = Math.abs(audioData[i])
	}

	console.log(`[Transcription] PCM Samples: ${float32Data.length}, Max Amplitude: ${maxAmp}`)

	if (float32Data.length === 0) {
		console.warn(`[Transcription] Audio data length is 0!`)
		return ""
	}

	if (maxAmp === 0) {
		console.warn(`[Transcription] Audio is completely silent (max amplitude 0).`)
		return ""
	}

	// 3. Run transcription
	const output = await transcriber(float32Data)

	// pipeline returns commonly either { text: string } or an array of { text: string }, wait, whisper returns { text: string }
	if (Array.isArray(output)) {
		return output.map((o: any) => o.text).join(' ').trim()
	}

	return output.text?.trim() || ''
}
