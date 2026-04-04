# Parakeet Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@xenova/transformers` + Whisper-tiny with NVIDIA Parakeet TDT 0.6B v3 running via `sherpa-onnx-offline` subprocess.

**Architecture:** `transcription.ts` is completely rewritten. Public API (`transcribeAudioBuffer`) is unchanged. The module exposes mutable test-injection hooks (`_bunSpawn`, `_httpFetch`, `_downloadState`) as exported objects whose `.fn`/`.promise` properties tests can replace without ESM binding issues. Model files live at `<configDir>/models/parakeet/` so the existing `TAMIAS_CONFIG_PATH` test isolation covers them automatically.

**Tech Stack:** Bun.spawn, fluent-ffmpeg (kept), ffmpeg-static (kept), system `tar` binary, GitHub Releases API

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Rewrite | `src/utils/transcription.ts` | All transcription logic — model check, download, wav conversion, subprocess, parsing |
| Rewrite | `src/utils/transcription.test.ts` | All unit tests for the above |
| Modify | `package.json` | Remove `@xenova/transformers` and `wavefile` deps |

---

## Task 1: Write failing tests for `transcribeAudioBuffer`

**Files:**
- Rewrite: `src/utils/transcription.test.ts`

- [ ] **Step 1.1: Replace the entire test file with the new structure**

```ts
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
import { mkdirSync, writeFileSync, readdirSync } from 'fs'
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
```

- [ ] **Step 1.2: Run tests and confirm they all fail**

```bash
bun test --preload ./src/tests/setup.ts src/utils/transcription.test.ts 2>&1 | tail -20
```

Expected: multiple failures mentioning missing exports (`_bunSpawn`, `_httpFetch`, `_downloadState`) and missing implementation.

---

## Task 2: Implement `transcription.ts` (core transcription — no download yet)

**Files:**
- Rewrite: `src/utils/transcription.ts`

- [ ] **Step 2.1: Replace the entire file**

```ts
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { Readable } from 'stream'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, chmodSync } from 'fs'
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

// ── Test injection hooks (exported objects — ESM-safe mutable properties) ─────

export const _bunSpawn = {
	fn: (cmd: string[], opts?: any) => Bun.spawn(cmd as [string, ...string[]], opts),
}
export const _httpFetch = { fn: fetch as typeof fetch }
export const _downloadState = { promise: null as Promise<void> | null }

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
		.filter(line => line.trim() && !/^\d+:\d+:\d+/.test(line.trim()))
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
```

---

## Task 3: Run tests and verify they pass

**Files:** none

- [ ] **Step 3.1: Run the transcription tests**

```bash
bun test --preload ./src/tests/setup.ts src/utils/transcription.test.ts 2>&1 | tail -20
```

Expected output:
```
 7 pass
 0 fail
```

- [ ] **Step 3.2: Run the full test suite to check for regressions**

```bash
bun test --preload ./src/tests/setup.ts src/tests/*.test.ts src/utils/*.test.ts 2>&1 | tail -5
```

Expected: all tests pass, 0 fail.

- [ ] **Step 3.3: Run typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: no errors.

---

## Task 4: Commit core transcription

**Files:** none

- [ ] **Step 4.1: Commit**

```bash
git add src/utils/transcription.ts src/utils/transcription.test.ts
git commit -m "$(cat <<'EOF'
feat: replace Whisper/ONNX transcription with Parakeet via sherpa-onnx subprocess

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Remove old dependencies

**Files:**
- Modify: `package.json` (via bun remove)

- [ ] **Step 5.1: Uninstall removed packages**

```bash
bun remove @xenova/transformers wavefile
```

Expected: both packages removed from `package.json` and `bun.lockb`.

- [ ] **Step 5.2: Verify onnxruntime-web is gone**

```bash
bun pm ls 2>&1 | grep -i onnx || echo "onnxruntime-web not present — OK"
```

Expected: `onnxruntime-web not present — OK`

- [ ] **Step 5.3: Run typecheck to confirm no broken imports**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 5.4: Run full test suite**

```bash
bun test --preload ./src/tests/setup.ts src/tests/*.test.ts src/utils/*.test.ts 2>&1 | tail -5
```

Expected: all tests pass, 0 fail.

- [ ] **Step 5.5: Commit**

```bash
git add package.json bun.lockb
git commit -m "$(cat <<'EOF'
chore: remove @xenova/transformers and wavefile (replaced by sherpa-onnx)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Smoke test the download (manual)

This task is manual — run it in a development environment with internet access, not in CI.

- [ ] **Step 6.1: Trigger the first-time download by calling `transcribeAudioBuffer` with a real audio file**

```bash
bun -e "
const { transcribeAudioBuffer } = await import('./src/utils/transcription.ts');
const buf = await Bun.file('/path/to/test.ogg').arrayBuffer();
const text = await transcribeAudioBuffer(Buffer.from(buf));
console.log('Transcript:', text);
" 2>&1
```

Expected in logs:
```
[Transcription] Downloading Parakeet model (~640MB), this may take a few minutes...
[Transcription] Downloading binary (sherpa-onnx-v…-osx-arm64.tar.bz2)...
[Transcription] Downloading model weights (~640MB)...
[Transcription] Parakeet model download complete.
Transcript: <whatever was spoken>
```

- [ ] **Step 6.2: Run a second time to confirm model is not re-downloaded**

Re-run the command above. No download log lines should appear. Transcript should return immediately after ffmpeg conversion.

- [ ] **Step 6.3: If tar extraction fails (wrong --strip-components depth), inspect archive structure**

```bash
# Check top-level structure of the model archive
tar -tjf /tmp/tamias-sherpa-model-*.tar.bz2 2>/dev/null | head -20
```

If the ONNX files are nested deeper than one level, update `_extractModelFiles` in `transcription.ts`:
- Two levels deep: `--strip-components=2`
- Need to pick specific files: replace the `--strip-components` approach with `find + copy`

Similarly check binary archive:
```bash
tar -tjf /tmp/tamias-sherpa-bin-*.tar.bz2 2>/dev/null | grep sherpa-onnx-offline
```

The binary is always found by `find` in `_extractBinary`, so its depth doesn't matter.

---

## Self-Review Checklist (completed inline)

- **Spec coverage:**
  - ✅ `transcribeAudioBuffer` happy path → Task 1 + 2
  - ✅ Timestamp stripping → Task 1 (multi-segment test)
  - ✅ Empty stdout → Task 1
  - ✅ Subprocess non-zero exit → Task 1
  - ✅ Temp file cleanup → Task 1
  - ✅ `ensureModelReady` idempotent → Task 1
  - ✅ Download queuing (single download for concurrent calls) → Task 1
  - ✅ `@xenova/transformers` + `wavefile` removed → Task 5
  - ✅ `onnxruntime-web` transitive dep verified gone → Task 5
  - ✅ ffmpeg kept → confirmed in Task 2 (convertToWav unchanged)
  - ✅ Model stored at `<configDir>/models/parakeet/` → Task 2 (`getParakeetDir`)
  - ✅ Binary auto-downloaded on first use → Task 2 (`_downloadParakeet`)
  - ✅ Log progress, no user-facing notification → Task 2 (`console.log`)
  - ✅ `chmod +x` after binary extraction → Task 2 (`chmodSync`)
  - ✅ Temp wav cleaned in `finally` → Task 2
  - ✅ Download state reset on failure → Task 2 (`.catch` clears `_downloadState.promise`)

- **Placeholder scan:** None found.

- **Type consistency:** `_bunSpawn.fn`, `_httpFetch.fn`, `_downloadState.promise` used consistently across Tasks 1 and 2. `REQUIRED_FILES`, `getParakeetDir()`, `parseSherpaOutput()` defined in Task 2 and not referenced before that.
