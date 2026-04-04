import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { Readable } from 'stream'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, unlinkSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { getConfigFilePath } from './config.ts'

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic)

const REQUIRED_FILES = [
	'sherpa-onnx-offline',
	'encoder.int8.onnx',
	'decoder.int8.onnx',
	'joiner.int8.onnx',
	'tokens.txt',
] as const

const MODEL_ARCHIVE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'
const BINARY_RELEASES_URL = 'https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/latest'

// ── Minimal subprocess interface (only the fields we actually use) ────────────

interface SpawnResult {
	stdout: ReadableStream<Uint8Array> | null
	stderr: ReadableStream<Uint8Array> | null
	exited: Promise<number>
}

// ── Test injection hooks (exported objects — ESM-safe mutable properties) ─────

export const _bunSpawn: { fn: (cmd: string[], opts?: any) => SpawnResult } = {
	fn: (cmd: string[], opts?: any) => Bun.spawn(cmd as [string, ...string[]], opts) as unknown as SpawnResult,
}
export const _httpFetch: { fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response> } = {
	fn: fetch,
}

export const _downloadState: { promise: Promise<void> | null } = { promise: null }

// ── Path helper ───────────────────────────────────────────────────────────────

function getParakeetDir(): string {
	// Derives from TAMIAS_CONFIG_PATH so tests are automatically isolated
	return join(dirname(getConfigFilePath()), 'models', 'parakeet')
}

// ── Model readiness ───────────────────────────────────────────────────────────

export async function ensureModelReady(): Promise<void> {
	const dir = getParakeetDir()
	if (REQUIRED_FILES.every(f => existsSync(join(dir, f)))) return
	if (_downloadState.promise) return _downloadState.promise
	_downloadState.promise = _downloadParakeet(dir).catch(err => {
		_downloadState.promise = null // allow retry after failure
		throw err
	})
	return _downloadState.promise
}

// ── Download logic ────────────────────────────────────────────────────────────

async function _downloadParakeet(dir: string): Promise<void> {
	console.log('[Transcription] Downloading Parakeet model (~640MB), this may take a few minutes...')
	mkdirSync(dir, { recursive: true })

	// 1. Resolve latest binary URL via GitHub API
	const releaseRes = await _httpFetch.fn(BINARY_RELEASES_URL, {
		headers: { 'User-Agent': 'tamias' },
	})
	if (!releaseRes.ok) throw new Error(`GitHub API error: ${releaseRes.status}`)
	const release = await releaseRes.json() as {
		assets: Array<{ name: string; browser_download_url: string }>
	}
	const binaryAsset = release.assets.find(a => /osx-arm64\.tar\.bz2$/.test(a.name))
	if (!binaryAsset) throw new Error('No macOS arm64 binary found in latest sherpa-onnx release')

	// 2. Download and extract binary
	console.log(`[Transcription] Downloading binary (${binaryAsset.name})...`)
	const tmpBin = join(tmpdir(), `tamias-sherpa-bin-${randomBytes(4).toString('hex')}.tar.bz2`)
	try {
		await _fetchToFile(binaryAsset.browser_download_url, tmpBin)
		await _extractBinary(tmpBin, dir)
	} finally {
		try { unlinkSync(tmpBin) } catch {}
	}

	// 3. Download and extract model weights
	console.log('[Transcription] Downloading model weights (~640MB)...')
	const tmpModel = join(tmpdir(), `tamias-sherpa-model-${randomBytes(4).toString('hex')}.tar.bz2`)
	try {
		await _fetchToFile(MODEL_ARCHIVE_URL, tmpModel)
		await _extractModelFiles(tmpModel, dir)
	} finally {
		try { unlinkSync(tmpModel) } catch {}
	}

	console.log('[Transcription] Parakeet model download complete.')
}

async function _fetchToFile(url: string, dest: string): Promise<void> {
	const res = await _httpFetch.fn(url)
	if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`)
	await Bun.write(dest, await res.arrayBuffer())
}

async function _extractBinary(tarPath: string, dir: string): Promise<void> {
	// Extract full archive to a temp dir, then find and copy the binary
	const tmpExtract = join(tmpdir(), `tamias-sherpa-ext-${randomBytes(4).toString('hex')}`)
	mkdirSync(tmpExtract, { recursive: true })
	try {
		const extractProc = _bunSpawn.fn(['tar', '-xjf', tarPath, '-C', tmpExtract], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const extractCode = await extractProc.exited
		if (extractCode !== 0) {
			throw new Error(`tar extraction failed (${extractCode}): ${await new Response(extractProc.stderr!).text()}`)
		}

		// Locate the binary anywhere in the extracted tree
		const findProc = _bunSpawn.fn(
			['find', tmpExtract, '-name', 'sherpa-onnx-offline', '-type', 'f'],
			{ stdout: 'pipe' }
		)
		await findProc.exited
		const foundPath = (await new Response(findProc.stdout!).text()).trim()
		if (!foundPath) throw new Error('sherpa-onnx-offline not found in binary archive')

		const destBin = join(dir, 'sherpa-onnx-offline')
		await Bun.write(destBin, Bun.file(foundPath))
		chmodSync(destBin, 0o755)
	} finally {
		void _bunSpawn.fn(['rm', '-rf', tmpExtract])
	}
}

async function _extractModelFiles(tarPath: string, dir: string): Promise<void> {
	// Model archive: sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/{encoder,decoder,joiner,tokens,...}
	// --strip-components=1 drops the top-level directory so files land directly in dir
	const proc = _bunSpawn.fn(
		['tar', '-xjf', tarPath, '--strip-components=1', '-C', dir],
		{ stdout: 'pipe', stderr: 'pipe' }
	)
	const code = await proc.exited
	if (code !== 0) {
		throw new Error(`Model extraction failed (${code}): ${await new Response(proc.stderr!).text()}`)
	}
}

// ── Audio conversion (unchanged from previous implementation) ─────────────────

function convertToWav(inputBuffer: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const inputStream = new Readable()
		inputStream.push(inputBuffer)
		inputStream.push(null)
		const buffers: Buffer[] = []
		const command = ffmpeg(inputStream)
			.toFormat('wav')
			.audioFrequency(16000)
			.audioChannels(1)
			.on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
			.on('end', () => resolve(Buffer.concat(buffers)))
		const stream = command.pipe()
		stream.on('data', (chunk: Buffer) => buffers.push(chunk))
	})
}

// ── Output parsing ────────────────────────────────────────────────────────────

function parseSherpaOutput(stdout: string): string {
	// sherpa-onnx-offline emits lines like:
	//   0:00:00.000 --> 0:00:05.120
	//    Hello, how are you?
	// Strip timestamp lines, join remaining text lines.
	return stdout
		.split('\n')
		.map(line => line.trim())
		.filter(line => line && !/^\d+:\d+:\d+/.test(line))
		.join(' ')
		.trim()
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function transcribeAudioBuffer(buffer: Buffer): Promise<string> {
	await ensureModelReady()

	const wavBuffer = await convertToWav(buffer)

	const tmpWav = join(tmpdir(), `tamias-audio-${randomBytes(4).toString('hex')}.wav`)
	await Bun.write(tmpWav, wavBuffer)

	try {
		const dir = getParakeetDir()
		const proc = _bunSpawn.fn([
			join(dir, 'sherpa-onnx-offline'),
			`--encoder=${join(dir, 'encoder.int8.onnx')}`,
			`--decoder=${join(dir, 'decoder.int8.onnx')}`,
			`--joiner=${join(dir, 'joiner.int8.onnx')}`,
			`--tokens=${join(dir, 'tokens.txt')}`,
			'--num-threads=4',
			tmpWav,
		], { stdout: 'pipe', stderr: 'pipe' })

		const code = await proc.exited
		if (code !== 0) {
			const stderr = await new Response(proc.stderr!).text()
			throw new Error(`sherpa-onnx-offline failed (exit ${code}): ${stderr}`)
		}

		const stdout = await new Response(proc.stdout!).text()
		return parseSherpaOutput(stdout)
	} finally {
		try { unlinkSync(tmpWav) } catch {}
	}
}
