# Inspect Context — Design Spec

**Date:** 2026-04-03  
**Status:** Approved

## Overview

A debugging tool that exposes the exact system prompt, enabled tools, session metadata, and config snapshot that the AI sees at runtime. Available as both a CLI command (`tamias inspect`) and an AI-callable tool (`tamias__inspect_context`) so it works from the terminal and from any bridge channel (Discord, Telegram, etc.).

## Goals

- Let the developer see the exact system prompt tiers in order
- See all enabled tools with descriptions and key input fields
- See session/channel metadata and token budget info
- See which bridges, MCPs, and tool namespaces are enabled/disabled
- From Discord: receive the output as a downloadable `.md` file attachment

## Non-Goals

- Does not require the daemon to be running for CLI use
- Does not expose secrets (API keys, tokens) — config snapshot lists keys as present/absent only

---

## Architecture

### Option chosen: Standalone generation (Option B)

Both CLI and AI tool call a shared `generateInspectReport(session?)` function directly. No new REST endpoint. The CLI uses a synthetic terminal-session context; the AI tool passes the real live session.

---

## Files

| File | Role |
|------|------|
| `src/utils/inspectReport.ts` | Shared report generator — the core logic |
| `src/commands/inspect.ts` | CLI command (`tamias inspect`) |
| `src/index.ts` | Registers `tamias inspect` command |
| `src/tools/tamias.ts` | Adds `tamias__inspect_context` AI tool |
| `src/tests/inspect.test.ts` | Unit tests |

---

## Core: `generateInspectReport(session?)`

**Location:** `src/utils/inspectReport.ts`

**Signature:**
```ts
export async function generateInspectReport(session?: Session): Promise<string>
```

**Steps:**
1. Build session context (real if provided, synthetic terminal context if not)
2. Call `buildSystemPrompt()` with that context — renders all tiers
3. Load config via `loadConfig()` for bridges, MCPs, tool namespaces
4. For tool listing: if session provided, call `buildActiveTools()` for live tool set (real MCP connections); if CLI, read config only and note MCPs are listed from config
5. Assemble markdown document (see Report Structure below)
6. Return the markdown string

---

## Report Structure

```markdown
# Tamias Context Inspection Report
Generated: 2026-04-03 23:45 | Session: abc123 | Channel: discord/my-server

## 1. Session Metadata
- Model: claude-sonnet-4-5 (smart tier)
- Connection: anthropic
- Channel ID: discord:GUILD:CHANNEL
- Session ID: abc123
- Workspace: ~/.tamias/workspace/my-project
- Context Window: 128,000 tokens
- Estimated System Prompt: ~4,200 tokens

## 2. Configuration Snapshot
### Bridges
- discord: enabled
- telegram: disabled

### MCP Servers
- my-mcp: enabled (stdio)

### Internal Tools
- terminal: enabled
- email: disabled
- ...

### Models
- Default: claude-haiku-4-5
- Smart: claude-sonnet-4-5

## 3. System Prompt
<!-- tier: identity-role -->
...full rendered content...

<!-- tier: user -->
...

<!-- tier: agentic-protocol -->
...

<!-- tier: persistent-knowledge -->
...

<!-- tier: skills-catalog -->
...

<!-- tier: environment -->
...

<!-- tier: session-summary -->
...

## 4. Available Tools

### internal:terminal (5 functions)
#### terminal__run_command
> Run a shell command in the workspace
- `command` (string) — The shell command to execute
- `cwd` (string?) — Working directory override

...
```

Tool schemas show: tool name, description, and each parameter with its name, type, and description. Raw JSON schemas are omitted — human-readable summary only.

---

## CLI Command: `tamias inspect`

**Location:** `src/commands/inspect.ts`

**Behavior:**
1. Calls `generateInspectReport()` with no session (synthetic terminal context)
2. Writes output to `~/.tamias/inspect-<YYYY-MM-DD-HHmm>.md`
3. Prints the file path to stdout
4. Optionally: `--print` flag outputs the content directly to terminal

**Registration in `src/index.ts`:**
```ts
import { runInspectCommand } from './commands/inspect.ts'
program
  .command('inspect')
  .description('Generate a debug report of the system prompt, tools, and config')
  .option('--print', 'Print the report to terminal instead of writing a file')
  .action((opts) => runInspectCommand(opts))
```

---

## AI Tool: `tamias__inspect_context`

**Location:** `src/tools/tamias.ts` (added to `createTamiasTools`)

**Behavior:**
1. Calls `generateInspectReport(session)` with the real live session
2. Writes file to `<sessionWorkspacePath>/inspect-context.md`
3. Emits `{ type: 'file', name: 'inspect-context.md', buffer, mimeType: 'text/markdown' }` via the session emitter so Discord/Telegram send it as an attachment
4. Returns the file path in the tool result text

**Input schema:** no required inputs (zero-arg tool — always inspects the current session)

**Description for AI:** "Generate a debug report showing the current system prompt, all available tools with descriptions, session metadata, and configuration. Returns the report as a downloadable file."

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| A system prompt tier fails to render | That tier block shows `[error rendering tier: <message>]` — other tiers still render |
| MCP connection fails in CLI mode | Listed as `(from config — daemon not contacted)` |
| File write fails | Error message printed/returned; no crash |
| `buildActiveTools()` throws in AI tool | Fall back to config-based listing with a note |

---

## Testing (`src/tests/inspect.test.ts`)

- `generateInspectReport()` returns a string containing all 4 section headers (`## 1.`, `## 2.`, `## 3.`, `## 4.`)
- CLI mode (no session) produces a report with `terminal` in channel metadata
- Tool schema rendering doesn't crash on tools with missing descriptions
- Config snapshot lists at least one internal tool namespace
- File path written by CLI command matches expected `~/.tamias/inspect-*.md` pattern
