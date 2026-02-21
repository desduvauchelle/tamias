import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

if (ffmpegStatic) {
	ffmpeg.setFfmpegPath(ffmpegStatic)
}

ffmpeg('temp.aiff')
	.outputOptions(['-c:a libvorbis'])
	.save('test_audio.ogg')
	.on('end', () => console.log('OGG created'))
	.on('error', (err) => console.error('Error:', err))
