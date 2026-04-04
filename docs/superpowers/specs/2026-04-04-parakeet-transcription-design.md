# Parakeet Transcription — Design Spec

**Date:** 2026-04-04  
**Status:** Approved

## Overview

Replace the current `@xenova/transformers` + Whisper-tiny transcription backend with NVIDIA Parakeet TDT 0.6B v3 (int8 quantized) running via the `sherpa-onnx-offline` CLI binary as a subprocess. This eliminates the `onnxruntime-web` blob-URL Bun incompatibility and delivers a faster, more accurate, multilingual (25 European languages) transcription pipeline with no native Node bindings.

## Architecture

The public API of `src/utils/transcription.ts` is unchanged:

```ts
export async function transcribeAudioBuffer(buffer: Buffer): Promise<string>
```

`aiService.ts` requires no modifications. The internal implementation swaps from `@xenova/transformers` → `Bun.spawn` subprocess.

### Internal call chain

```text
transcribeAudioBuffer(buffer)
  └─ ensureModelReady()       // download binary + model if missing
  └─ convertToWav(buffer)     // existing ffmpeg logic — unchanged
  └─ write buffer to /tmp/tamias-audio-<random>.wav
  └─ Bun.spawn(sherpa-onnx-offline, [...args, wavPath])
  └─ parse stdout → strip timestamps → return transcript text
  └─ delete temp file (finally block)
```

## Model Management

### Storage location

`~/.tamias/models/parakeet/`

### Files

| File                  | Size  | Source                                        |
|-----------------------|-------|-----------------------------------------------|
| `sherpa-onnx-offline` | ~5MB  | sherpa-onnx GitHub releases (macOS arm64)     |
| `encoder.int8.onnx`   | 622MB | sherpa-onnx asr-models release                |
| `decoder.int8.onnx`   | 12MB  | sherpa-onnx asr-models release                |
| `joiner.int8.onnx`    | 6.1MB | sherpa-onnx asr-models release                |
| `tokens.txt`          | 92KB  | sherpa-onnx asr-models release                |

**Total first-time download: ~640MB** (once only, cached permanently).

### Model sources

- Binary: latest release fetched via `https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/latest`, asset matching `sherpa-onnx-v*-osx-arm64.tar.bz2`
- Model: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2` (stable URL, not versioned)

### `ensureModelReady()` logic

```text
if model dir exists and all 5 files present → return immediately
else if download already in progress → await existing promise
else → start download, store promise, await it
  1. Fetch + extract binary tarball → chmod +x sherpa-onnx-offline
  2. Fetch + extract model tarball
  3. Verify all files present
  4. Resolve promise
```

No user-facing notification. Progress logged to daemon log only (e.g. `[Transcription] Downloading Parakeet model (~640MB)...`).

### Message queuing during download

`transcribeAudioBuffer` calls `await ensureModelReady()` before transcribing. If a voice message arrives while the model is downloading, the call simply awaits the in-flight download promise — the audio buffer is held in memory and transcribed immediately when the download completes.

## Subprocess Interface

```bash
~/.tamias/models/parakeet/sherpa-onnx-offline \
  --encoder=/path/to/encoder.int8.onnx \
  --decoder=/path/to/decoder.int8.onnx \
  --joiner=/path/to/joiner.int8.onnx \
  --tokens=/path/to/tokens.txt \
  --num-threads=4 \
  /tmp/tamias-audio-<random>.wav
```

### Stdout format

```text
0:00:00.000 --> 0:00:05.120
 Hello, how are you doing today?
```

Parsing: skip lines matching `/^\d+:\d+:\d+/`, join remaining non-empty lines, trim.

### Temp file lifecycle

- Written to `/tmp/tamias-audio-<random>.wav` before subprocess call
- Deleted in a `finally` block — always cleaned up even on error

## Dependency Changes

**Remove:**

- `@xenova/transformers`
- `wavefile`
- Run `bun pm ls` after removal to confirm `onnxruntime-web` is no longer present as a transitive dep

**Keep:**

- `fluent-ffmpeg` + `ffmpeg-static` (OGG→WAV conversion unchanged)

## Error Handling

| Scenario | Behaviour |
| -------- | --------- |
| Download fails | Log error, throw — `aiService.ts` catches and sends `⚠️ Audio transcription failed` to user |
| Binary not executable | `chmod +x` applied immediately after extraction |
| Subprocess exits non-zero | Throw with stderr content included in message |
| Empty stdout | Return `""` — `aiService.ts` sends "silent or could not be transcribed" message |
| Temp file write fails | Throw — caught by `aiService.ts` error handler |

## Testing

**File:** `src/utils/transcription.test.ts` (rewritten)

Mock `Bun.spawn` — do not invoke the real binary or download.

| Test                          | Assertion                                                       |
|-------------------------------|-----------------------------------------------------------------|
| Happy path                    | Valid sherpa-onnx stdout → trimmed transcript string            |
| Timestamp stripping           | Lines starting with `0:00:…` are excluded from output          |
| Empty output                  | Empty stdout → returns `""`                                     |
| Subprocess failure            | Non-zero exit → promise rejects                                 |
| Temp file cleanup             | Temp file deleted even when subprocess throws                   |
| `ensureModelReady` idempotent | Called twice while model present → no download triggered        |
| Download queuing              | Two concurrent calls before model ready → single download, both resolve |

ffmpeg mock stays unchanged from current implementation.
