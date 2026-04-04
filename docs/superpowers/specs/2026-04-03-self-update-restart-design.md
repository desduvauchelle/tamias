# Self-Update with Restart Design

**Date:** 2026-04-03  
**Status:** Approved

## Problem

The existing `update_tamias` AI tool downloads a new binary and dashboard but does not stop or restart the daemon. After calling it, the daemon keeps running the old binary. Users must manually run `tamias start`. Additionally, the user who triggered the update (e.g. from Discord) gets no confirmation that the update completed.

## Goal

When a user asks the AI "please update yourself", the daemon should:
1. Acknowledge the request and tell the user it will restart
2. Download and install the new binary + dashboard
3. Restart itself automatically
4. On boot, send the requesting channel a message confirming the update with the version and changelog

---

## Data Flow

```
User: "please update yourself"
  └─ AI calls update_tamias tool
      ├─ 1. Gets session.channelId + channelUserId from aiService
      ├─ 2. Calls checkForUpdate() → fromVersion + toVersion + changelog snippet
      ├─ 3. Writes ~/.tamias/pending-restart.json
      │      { channelId, channelUserId, fromVersion, toVersion, changelog, requestedAt }
      ├─ 4. Schedules performUpdateAndRestart() after 4s (non-blocking setTimeout)
      └─ 5. Returns { message: "Updating v{from} → v{to}, restarting in ~5s" }

AI sends response: "Got it! Updating now, I'll be back in a few seconds."

[4 seconds later, background]
  └─ performUpdateAndRestart()
      ├─ performUpdate() — downloads binary + dashboard
      ├─ Bun.spawn("tamias start --daemon", detached: true, unref'd)
      └─ process.exit(0) after 1s

[New daemon boots]
  ├─ bridgeManager.initializeAll()
  ├─ checkPendingRestart(bridgeManager)   ← new hook, runs after init
  │   ├─ Reads ~/.tamias/pending-restart.json
  │   ├─ Exits early if file not found
  │   ├─ Waits 2s for bridges to settle
  │   ├─ broadcastToChannel(channelId, "✅ Updated v{from} → v{to}!\n\n{changelog}", channelUserId)
  │   └─ Deletes pending-restart.json
  └─ Normal operation continues
```

---

## Components

### New: `src/utils/pendingRestart.ts`

Thin read/write/clear utility for `~/.tamias/pending-restart.json`.

```ts
interface PendingRestart {
  channelId: string       // channel to notify after boot (e.g. "discord-1234567890")
  channelUserId?: string  // optional: targeted delivery to requesting user
  fromVersion: string     // e.g. "26.03.16.4"
  toVersion: string       // e.g. "26.04.03.1"
  changelog: string       // truncated GitHub release notes — stored at update time, no HTTP on boot
  requestedAt: string     // ISO timestamp
}

writePendingRestart(info: PendingRestart): void
readPendingRestart(): PendingRestart | null
clearPendingRestart(): void

// Boot hook — call after bridgeManager.initializeAll()
checkPendingRestart(bridgeManager: BridgeManager): Promise<void>
```

`checkPendingRestart` reads the file, waits 2s for bridges to settle, sends the message, then deletes the file. It handles `broadcastToChannel` failure gracefully — it still deletes the file so stale restart messages don't pile up.

### Modified: `src/utils/update.ts`

Adds `performUpdateAndRestart(context: PendingRestartContext)`:
1. Calls `performUpdate()`
2. **If update succeeds:** writes `pending-restart.json` (file is only written on success)
3. Detects compiled vs dev mode (same logic as `autoStartDaemon`)
4. Spawns `tamias start --daemon` detached + unref'd
5. `process.exit(0)` after 1s
6. **If update fails:** logs error, does not write pending file, does not exit

Writing the file *after* a successful update prevents a stale "Updated successfully" notification firing on the next manual reboot if the update had previously failed.

### Modified: `src/tools/tamias.ts` — `update_tamias` tool

**Before:** calls `performUpdate()`, returns result synchronously.

**After:**
1. Gets session via `aiService.getSession(sessionId)` for `channelId`/`channelUserId`
2. Calls `checkForUpdate()` to get `fromVersion`, `toVersion`, and `changelog` (truncated to ~800 chars)
3. If already up to date and no `force` flag: returns early with "Already up to date" — no restart
4. `setTimeout(() => performUpdateAndRestart({ channelId, channelUserId, fromVersion, toVersion, changelog }), 4000)` — non-blocking
5. Returns `{ success: true, message: "Updating v{from} → v{to}, restarting in ~5s. I'll send you a message when I'm back." }`

The 4-second delay is intentional: it allows the AI to finish streaming its response to the channel before the daemon exits.

### Modified: `src/commands/start.ts`

One line added after `bridgeManager.initializeAll(...)`:

```ts
await checkPendingRestart(bridgeManager).catch(console.error)
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `checkForUpdate()` fails | Tool returns error, no pending file written, no restart |
| Already on latest version | Tool returns "Already up to date", no restart |
| `performUpdate()` fails | `process.exit(1)`, pending file remains but restart was not triggered; file is stale — cleared on next clean boot or ignored |
| `broadcastToChannel` fails after boot | Error swallowed, file still deleted to prevent loops |
| Pending file is corrupt/unparseable | `readPendingRestart` returns null, `checkPendingRestart` exits early |

---

## Testing

### `src/tests/pendingRestart.test.ts` — utility unit tests
- `writePendingRestart` writes valid JSON file at the correct path
- `readPendingRestart` returns `null` when file does not exist
- `readPendingRestart` returns parsed data when file exists
- `clearPendingRestart` deletes the file
- `clearPendingRestart` is a no-op when file does not exist

### `src/tests/updateRestart.test.ts` — tool + boot hook integration tests
- `update_tamias` tool writes `pending-restart.json` with correct `channelId` + `channelUserId`
- `update_tamias` tool returns the version transition message
- `update_tamias` tool returns error and writes no file if `checkForUpdate` fails
- `update_tamias` tool returns "already up to date" and writes no file if versions match
- `checkPendingRestart` calls `broadcastToChannel` with stored `channelId` and formatted message
- `checkPendingRestart` deletes the file after sending
- `checkPendingRestart` is a no-op when no pending file exists
- `checkPendingRestart` deletes the file even when `broadcastToChannel` throws

All tests use the existing `TAMIAS_CONFIG_PATH` temp-dir isolation via `src/tests/setup.ts`. `performUpdate`, `checkForUpdate`, and `broadcastToChannel` are mocked with `mock.module()`.

---

## Non-Goals

- Session restoration after restart (clean break is acceptable)
- Rollback on failed update
- Restart from the CLI `tamias update` command (that flow already works manually)
