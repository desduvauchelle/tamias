import { readFileSync } from 'fs'
import { transcribeAudioBuffer } from './src/utils/transcription'

async function run() {
	try {
		console.log("Reading test_audio.ogg...")
		const buf = readFileSync('test_audio.ogg')
		console.log(`Read ${buf.length} bytes.`)

		console.log("Transcribing...")
		const result = await transcribeAudioBuffer(buf)
		console.log("RESULT:", result)
	} catch (err) {
		console.error("Test Error:", err)
	}
}

run()
