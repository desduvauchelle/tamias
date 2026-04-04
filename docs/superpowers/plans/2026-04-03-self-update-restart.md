# Self-Update with Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the AI to update and restart the Tamias daemon on request, then notify the requesting channel with the new version and changelog after boot.

**Architecture:** A new `pendingRestart.ts` utility handles a one-shot post-boot message queue stored at `~/.tamias/pending-restart.json`. The `update_tamias` AI tool schedules update+restart 4 seconds after returning (giving the AI time to reply). On restart, the daemon reads the file, waits for bridges to settle, sends the notification, then deletes the file.

**Tech Stack:** Bun, TypeScript, bun:test, Vercel AI SDK `tool()`, Commander

**Spec:** `docs/superpowers/specs/2026-04-03-self-update-restart-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/utils/pendingRestart.ts` | read/write/clear/check for `pending-restart.json` |
| Create | `src/tests/pendingRestart.test.ts` | unit tests for pendingRestart utility |
| Create | `src/tests/updateRestart.test.ts` | unit tests for performUpdateAndRestart (DI pattern) |
| Create | `src/tests/updateTool.test.ts` | tests for update_tamias tool (mock.module pattern) |
| Modify | `src/utils/update.ts` | add `RestartContext` interface + `performUpdateAndRestart()` |
| Modify | `src/tools/tamias.ts` | replace `update_tamias` execute body |
| Modify | `src/commands/start.ts` | add `checkPendingRestart` boot hook after `initializeAll` |

---

## Task 1: `pendingRestart.ts` utility — write failing tests

**Files:**
- Create: `src/tests/pendingRestart.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/tests/pendingRestart.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Point TAMIAS_DIR at a temp directory BEFORE importing the module under test.
// pendingRestart.ts reads process.env.TAMIAS_DIR at call time (not load time).
let tmpDir: string

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'tamias-pr-test-'))
	process.env.TAMIAS_DIR = tmpDir
})

afterEach(() => {
	delete process.env.TAMIAS_DIR
	rmSync(tmpDir, { recursive: true, force: true })
})

// Import AFTER env is set so module cache sees the right path on first call
import {
	writePendingRestart,
	readPendingRestart,
	clearPendingRestart,
	checkPendingRestart,
	type PendingRestart,
} from '../utils/pendingRestart.ts'

const sample: PendingRestart = {
	channelId: 'discord:1234567890',
	channelUserId: 'user-42',
	fromVersion: '26.03.16.4',
	toVersion: '26.04.03.1',
	changelog: '## What\'s New\n- Fixed cron jobs\n- Better auth',
	requestedAt: '2026-04-03T23:36:00.000Z',
}

describe('writePendingRestart / readPendingRestart', () => {
	test('readPendingRestart returns null when file does not exist', () => {
		expect(readPendingRestart()).toBeNull()
	})

	test('writePendingRestart writes JSON and readPendingRestart returns it', () => {
		writePendingRestart(sample)
		const result = readPendingRestart()
		expect(result).toEqual(sample)
	})

	test('readPendingRestart returns null when file is corrupt JSON', () => {
		const { writeFileSync } = require('fs')
		writeFileSync(join(tmpDir, 'pending-restart.json'), 'not-json', 'utf-8')
		expect(readPendingRestart()).toBeNull()
	})
})

describe('clearPendingRestart', () => {
	test('deletes the file when it exists', () => {
		writePendingRestart(sample)
		clearPendingRestart()
		expect(readPendingRestart()).toBeNull()
	})

	test('is a no-op when file does not exist', () => {
		expect(() => clearPendingRestart()).not.toThrow()
	})
})

describe('checkPendingRestart', () => {
	test('is a no-op when no pending file exists', async () => {
		const broadcastMock = mock(() => Promise.resolve())
		const fakeBridgeManager = { broadcastToChannel: broadcastMock } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(broadcastMock).not.toHaveBeenCalled()
	})

	test('sends message to stored channelId with version info', async () => {
		writePendingRestart(sample)
		const broadcastMock = mock(() => Promise.resolve())
		const fakeBridgeManager = { broadcastToChannel: broadcastMock } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(broadcastMock).toHaveBeenCalledTimes(1)
		const [calledChannelId, calledMessage, calledUserId] = broadcastMock.mock.calls[0]
		expect(calledChannelId).toBe('discord:1234567890')
		expect(calledMessage).toContain('26.03.16.4')
		expect(calledMessage).toContain('26.04.03.1')
		expect(calledMessage).toContain("What's New")
		expect(calledUserId).toBe('user-42')
	})

	test('deletes the file after sending', async () => {
		writePendingRestart(sample)
		const fakeBridgeManager = { broadcastToChannel: mock(() => Promise.resolve()) } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(readPendingRestart()).toBeNull()
	})

	test('deletes the file even when broadcastToChannel throws', async () => {
		writePendingRestart(sample)
		const fakeBridgeManager = { broadcastToChannel: mock(() => Promise.reject(new Error('no connection'))) } as any
		await checkPendingRestart(fakeBridgeManager, 0)
		expect(readPendingRestart()).toBeNull()
	})
})
```

- [ ] **Step 2: Run tests to confirm they fail (module not found)**

```bash
bun test --preload ./src/tests/setup.ts src/tests/pendingRestart.test.ts
```

Expected: errors — `../utils/pendingRestart.ts` does not exist yet.

---

## Task 2: Implement `src/utils/pendingRestart.ts`

**Files:**
- Create: `src/utils/pendingRestart.ts`

- [ ] **Step 3: Create the utility**

```typescript
// src/utils/pendingRestart.ts
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import type { BridgeManager } from '../bridge/index.ts'

export interface PendingRestart {
	channelId: string
	channelUserId?: string
	fromVersion: string
	toVersion: string
	changelog: string
	requestedAt: string
}

/** Resolves at call time so tests can override process.env.TAMIAS_DIR */
function getPendingRestartPath(): string {
	return join(process.env.TAMIAS_DIR ?? join(homedir(), '.tamias'), 'pending-restart.json')
}

export function writePendingRestart(info: PendingRestart): void {
	writeFileSync(getPendingRestartPath(), JSON.stringify(info, null, 2), 'utf-8')
}

export function readPendingRestart(): PendingRestart | null {
	const path = getPendingRestartPath()
	if (!existsSync(path)) return null
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as PendingRestart
	} catch {
		return null
	}
}

export function clearPendingRestart(): void {
	const path = getPendingRestartPath()
	if (existsSync(path)) unlinkSync(path)
}

/**
 * Called after bridgeManager.initializeAll() on daemon boot.
 * Reads pending-restart.json, sends notification to the stored channel, then deletes the file.
 * @param settlementDelayMs How long to wait for bridges to settle before sending. Default 2000ms.
 *   Pass 0 in tests to skip the delay.
 */
export async function checkPendingRestart(
	bridgeManager: BridgeManager,
	settlementDelayMs = 2000,
): Promise<void> {
	const info = readPendingRestart()
	if (!info) return

	await new Promise(r => setTimeout(r, settlementDelayMs))

	const message = `✅ Updated from v${info.fromVersion} to v${info.toVersion}!\n\n${info.changelog}`.trim()

	try {
		await bridgeManager.broadcastToChannel(info.channelId, message, info.channelUserId)
	} catch (err) {
		console.error('[PendingRestart] Failed to send restart notification:', err)
	} finally {
		clearPendingRestart()
	}
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
bun test --preload ./src/tests/setup.ts src/tests/pendingRestart.test.ts
```

Expected: 8 pass, 0 fail.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/pendingRestart.ts src/tests/pendingRestart.test.ts
git commit -m "feat: add pendingRestart utility for post-boot channel notification"
```

---

## Task 3: Add `performUpdateAndRestart` to `update.ts`

**Files:**
- Create: `src/tests/updateRestart.test.ts` (partial — tool tests added in Task 4)
- Modify: `src/utils/update.ts`

- [ ] **Step 7: Write failing tests for `performUpdateAndRestart`**

`performUpdateAndRestart` will use dependency injection for `performUpdate` so tests can pass a mock without module patching.

```typescript
// src/tests/updateRestart.test.ts
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── File isolation ────────────────────────────────────────────────────────────
let tmpDir: string
beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'tamias-ur-test-'))
	process.env.TAMIAS_DIR = tmpDir
})
afterEach(() => {
	delete process.env.TAMIAS_DIR
	rmSync(tmpDir, { recursive: true, force: true })
})

// ── Patch Bun.spawn and process.exit so nothing real happens ─────────────────
const spawnMock = mock(() => ({ unref: mock(() => undefined) }))
const originalSpawn = Bun.spawn
const originalExit = process.exit
beforeEach(() => {
	;(Bun as any).spawn = spawnMock
	process.exit = ((_code?: number) => {}) as never
})
afterEach(() => {
	;(Bun as any).spawn = originalSpawn
	process.exit = originalExit
	spawnMock.mockClear()
})

import { performUpdateAndRestart } from '../utils/update.ts'
import { readPendingRestart } from '../utils/pendingRestart.ts'

const ctx = {
	channelId: 'discord:1234567890',
	channelUserId: 'user-42',
	fromVersion: '26.03.16.4',
	toVersion: '26.04.03.1',
	changelog: '## Changelog\n- fix: cron jobs restored',
}

const successResult = { success: true as const, currentVersion: '26.03.16.4', latestVersion: '26.04.03.1' }
const failResult = { success: false as const, currentVersion: '26.03.16.4', error: 'download failed' }

describe('performUpdateAndRestart', () => {
	test('writes pending-restart.json after successful update', async () => {
		// Pass a mock performUpdate via DI — no HTTP calls
		await performUpdateAndRestart(ctx, async () => successResult)
		const info = readPendingRestart()
		expect(info).not.toBeNull()
		expect(info!.channelId).toBe('discord:1234567890')
		expect(info!.fromVersion).toBe('26.03.16.4')
		expect(info!.toVersion).toBe('26.04.03.1')
		expect(info!.changelog).toContain('cron jobs restored')
		expect(info!.requestedAt).toBeTruthy()
	})

	test('spawns a new daemon process after writing pending file', async () => {
		await performUpdateAndRestart(ctx, async () => successResult)
		expect(spawnMock).toHaveBeenCalledTimes(1)
		const [spawnArgs] = spawnMock.mock.calls[0] as [string[], unknown]
		expect(spawnArgs.join(' ')).toContain('start')
	})

	test('does NOT write pending-restart.json when update fails', async () => {
		await performUpdateAndRestart(ctx, async () => failResult)
		expect(readPendingRestart()).toBeNull()
		expect(spawnMock).not.toHaveBeenCalled()
	})
})
```

- [ ] **Step 8: Run tests — should fail (function not exported yet)**

```bash
bun test --preload ./src/tests/setup.ts src/tests/updateRestart.test.ts 2>&1 | head -20
```

Expected: import/compile error or test failures.

- [ ] **Step 9: Add `RestartContext` interface and `performUpdateAndRestart` to `src/utils/update.ts`**

Add at the bottom of `src/utils/update.ts` (after the existing `autoUpdateDaemon` function):

```typescript
export interface RestartContext {
	channelId: string
	channelUserId?: string
	fromVersion: string
	toVersion: string
	changelog: string
}

/**
 * Runs the update, writes pending-restart.json on success, spawns a new daemon, then exits.
 * The pending file is written ONLY after a successful update to prevent stale notifications.
 * @param _performUpdateFn Injected for testing. Defaults to the real performUpdate.
 */
export async function performUpdateAndRestart(
	context: RestartContext,
	_performUpdateFn: () => Promise<UpdateResult> = performUpdate,
): Promise<void> {
	const result = await _performUpdateFn()

	if (!result.success) {
		console.error('[UpdateRestart] Update failed:', result.error)
		return
	}

	// Write notification file AFTER confirmed success
	const { writePendingRestart } = await import('./pendingRestart.ts')
	writePendingRestart({
		channelId: context.channelId,
		channelUserId: context.channelUserId,
		fromVersion: context.fromVersion,
		toVersion: context.toVersion,
		changelog: context.changelog,
		requestedAt: new Date().toISOString(),
	})

	// Spawn new daemon (mirrors autoStartDaemon spawn logic)
	const { join } = await import('path')
	const { homedir } = await import('os')
	const { openSync, existsSync: fsExists } = await import('fs')

	const isCompiled = import.meta.dir?.includes('$bunfs') || !fsExists(import.meta.dir ?? '')
	const projectRoot = isCompiled ? process.cwd() : join(import.meta.dir, '../..')
	const logPath = join(process.env.TAMIAS_DIR ?? join(homedir(), '.tamias'), 'daemon.log')
	const logFd = openSync(logPath, 'a')

	const spawnArgs: string[] = isCompiled
		? [process.execPath, 'start', '--daemon']
		: [process.argv[0], join(projectRoot, 'src', 'index.ts'), 'start', '--daemon']

	const proc = Bun.spawn(spawnArgs, {
		cwd: projectRoot,
		detached: true,
		stdio: ['ignore', logFd, logFd],
		env: { ...process.env } as Record<string, string>,
	})
	proc.unref()

	setTimeout(() => process.exit(0), 1000)
}
```

- [ ] **Step 10: Run tests — should pass**

```bash
bun test --preload ./src/tests/setup.ts src/tests/updateRestart.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 11: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/utils/update.ts src/tests/updateRestart.test.ts
git commit -m "feat: add performUpdateAndRestart to update.ts with pending-restart tracking"
```

---

## Task 4: Update `update_tamias` tool in `src/tools/tamias.ts`

**Files:**
- Modify: `src/tools/tamias.ts` (lines 513–529, the `update_tamias` tool's `execute` block)
- Create: `src/tests/updateTool.test.ts` (separate file — needs `mock.module` at top level, which conflicts with the DI imports in `updateRestart.test.ts`)

- [ ] **Step 13: Create `src/tests/updateTool.test.ts` with failing tests**

`mock.module` must be registered at module scope before any imports. Using a mutable variable lets individual tests change the mock return value without re-registering the mock.

```typescript
// src/tests/updateTool.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ── Mocks registered BEFORE any imports that resolve update.ts ────────────────
// tamias.ts uses `await import('../utils/update.ts')` inside execute(), so
// mock.module intercepts those dynamic imports.

let mockCheckForUpdateResult: Awaited<ReturnType<typeof import('../utils/update.ts').checkForUpdate>> = {
	currentVersion: '26.03.16.4',
	latestVersion: '26.04.03.1',
	release: { body: '## Changelog\n- fix: cron jobs restored', tag_name: 'v26.04.03.1', assets: [] },
}

const checkForUpdateMock = mock(async () => mockCheckForUpdateResult)
const performUpdateAndRestartMock = mock(async () => {})

mock.module('../utils/update.ts', () => ({
	checkForUpdate: checkForUpdateMock,
	performUpdateAndRestart: performUpdateAndRestartMock,
}))

import { createTamiasTools } from '../tools/tamias.ts'
import type { AIService } from '../services/aiService.ts'

function makeMockAIService(channelId = 'discord:test-channel', channelUserId = 'user-1'): AIService {
	return {
		getSession: mock(() => ({ channelId, channelUserId })),
	} as unknown as AIService
}

beforeEach(() => {
	checkForUpdateMock.mockClear()
	performUpdateAndRestartMock.mockClear()
	mockCheckForUpdateResult = {
		currentVersion: '26.03.16.4',
		latestVersion: '26.04.03.1',
		release: { body: '## Changelog\n- fix: cron jobs restored', tag_name: 'v26.04.03.1', assets: [] },
	}
	checkForUpdateMock.mockImplementation(async () => mockCheckForUpdateResult)
})

describe('update_tamias tool', () => {
	test('returns version transition message when update is available', async () => {
		const tools = createTamiasTools(makeMockAIService(), 'sess-1')
		const result = await tools.update_tamias.execute({}, { messages: [], toolCallId: 't1' })
		expect(result.success).toBe(true)
		expect(result.message).toContain('26.03.16.4')
		expect(result.message).toContain('26.04.03.1')
		expect(result.message).toContain('restarting in')
	})

	test('returns already-up-to-date when versions match', async () => {
		mockCheckForUpdateResult = {
			currentVersion: '26.04.03.1',
			latestVersion: '26.04.03.1',
			release: { body: '', tag_name: 'v26.04.03.1', assets: [] },
		}
		const tools = createTamiasTools(makeMockAIService(), 'sess-1')
		const result = await tools.update_tamias.execute({}, { messages: [], toolCallId: 't2' })
		expect(result.success).toBe(true)
		expect(result.message).toContain('up to date')
	})

	test('returns error when checkForUpdate throws', async () => {
		checkForUpdateMock.mockImplementationOnce(async () => {
			throw new Error('GitHub API timeout')
		})
		const tools = createTamiasTools(makeMockAIService(), 'sess-1')
		const result = await tools.update_tamias.execute({}, { messages: [], toolCallId: 't3' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('GitHub API timeout')
	})
})
```

- [ ] **Step 14: Run tool tests — should fail**

```bash
bun test --preload ./src/tests/setup.ts src/tests/updateTool.test.ts 2>&1 | tail -15
```

Expected: all 3 tests fail (old `update_tamias` execute body doesn't schedule restart).

- [ ] **Step 15: Replace the `update_tamias` execute body in `src/tools/tamias.ts`**

Find the existing `update_tamias` tool (lines ~513–529). Replace the entire `tool({...})` block:

```typescript
update_tamias: tool({
	description: 'Check for and install Tamias updates. Downloads the latest binary and dashboard, then restarts the daemon automatically. After restart, sends a confirmation message with the version and changelog to the channel that requested the update.',
	inputSchema: z.object({}),
	execute: async () => {
		const { checkForUpdate, performUpdateAndRestart } = await import('../utils/update.ts')

		let updateInfo: Awaited<ReturnType<typeof checkForUpdate>>
		try {
			updateInfo = await checkForUpdate()
		} catch (err) {
			return { success: false, error: `Failed to check for updates: ${err}` }
		}

		if (!updateInfo) {
			return { success: false, error: 'Could not reach GitHub releases.' }
		}

		const { currentVersion, latestVersion, release } = updateInfo

		if (currentVersion === latestVersion) {
			return { success: true, message: `Already up to date (v${currentVersion})` }
		}

		const session = aiService.getSession(sessionId)
		const channelId = session?.channelId ?? 'unknown'
		const channelUserId = session?.channelUserId

		const rawChangelog = (release.body as string | undefined) ?? ''
		const changelog = rawChangelog.length > 800 ? rawChangelog.slice(0, 797) + '…' : rawChangelog

		// Schedule update+restart 4 seconds from now so the AI has time to deliver this response
		setTimeout(() => {
			performUpdateAndRestart({
				channelId,
				channelUserId,
				fromVersion: currentVersion,
				toVersion: latestVersion,
				changelog,
			}).catch((err: unknown) => console.error('[UpdateRestart] Error:', err))
		}, 4000)

		return {
			success: true,
			message: `Updating from v${currentVersion} to v${latestVersion} — restarting in ~5 seconds. I'll send you a message in this channel when I'm back online.`,
		}
	},
}),
```

- [ ] **Step 16: Run all update/restart/tool tests**

```bash
bun test --preload ./src/tests/setup.ts src/tests/updateRestart.test.ts src/tests/updateTool.test.ts
```

Expected: all tests pass.

- [ ] **Step 17: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 18: Commit**

```bash
git add src/tools/tamias.ts src/tests/updateTool.test.ts
git commit -m "feat: update_tamias tool now schedules restart and sends post-boot notification"
```

---

## Task 5: Add boot hook to `src/commands/start.ts`

**Files:**
- Modify: `src/commands/start.ts` (one import + one await after `initializeAll`)

- [ ] **Step 19: Add the boot hook**

In `src/commands/start.ts`, find this line (around line 430):

```typescript
await bridgeManager.initializeAll(config, onBridgeMessage).catch(console.error)
```

Add immediately after it:

```typescript
// Check if restarted after an update — notify the requesting channel
const { checkPendingRestart } = await import('../utils/pendingRestart.ts')
await checkPendingRestart(bridgeManager).catch(console.error)
```

- [ ] **Step 20: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 21: Run full test suite**

```bash
bun test --preload ./src/tests/setup.ts src/tests/*.test.ts src/utils/*.test.ts
```

Expected: all previously passing tests still pass, plus the new `pendingRestart`, `updateRestart`, and `updateTool` tests.

- [ ] **Step 22: Commit**

```bash
git add src/commands/start.ts
git commit -m "feat: check for pending restart notification on daemon boot"
```

---

## Task 6: Verify end-to-end and final cleanup

- [ ] **Step 23: Run full test suite one more time**

```bash
bun test --preload ./src/tests/setup.ts src/tests/*.test.ts src/utils/*.test.ts
```

Expected: all pass.

- [ ] **Step 24: Run all typechecks**

```bash
bun run typecheck:all
```

Expected: no errors.

- [ ] **Step 25: Sync CLI docs**

```bash
bun run scripts/sync-cli-docs.ts
```

Expected: no files updated (this feature adds no new CLI commands).

- [ ] **Step 26: Manual smoke test (optional but recommended)**

If daemon is running via source:
```bash
bun src/index.ts cron list   # verify daemon is healthy first
```
Then in a chat session, call the `update_tamias` tool and verify:
1. Tool returns a "restarting in ~5s" message
2. Daemon stops ~4s later
3. After reboot, the channel receives "Updated from vX to vY" message

---

## Notes for the implementer

**`mock.module` vs dynamic imports:** The `update_tamias` tool uses `await import('../utils/update.ts')` inside `execute`. Since `mock.module()` is registered before the tool file is imported, all dynamic imports inside `execute` will use the mock. This is the same pattern used in `browser-auth.test.ts`.

**`process.env.TAMIAS_DIR`:** This env var is NOT set in the global `setup.ts` — it's set per-test in `beforeEach`. If you add a new test file that tests `pendingRestart.ts`, always set `process.env.TAMIAS_DIR` in `beforeEach` and unset it in `afterEach`.

**The 4-second setTimeout:** Tests for the `update_tamias` tool do NOT advance time — they only verify the return value. The `performUpdateAndRestart` behavior (writing the file, spawning, exiting) is tested separately via direct calls.

**`settlementDelayMs = 0` in tests:** Always pass `0` as the second argument to `checkPendingRestart` in tests, otherwise each test waits 2 real seconds.
