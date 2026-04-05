# Copilot Instructions for Tamias

## Project Overview

Tamias is an AI assistant daemon with multi-channel bridge support (Terminal, Discord, Telegram, WhatsApp Official, WhatsApp Unofficial). Built with Bun, TypeScript, Zod schemas, and a Next.js dashboard.

## Coding preferences

- TDD — write tests first, then implement features. Tests are not optional, they are part of the feature. Use `bun:test` with the provided setup for config isolation.
- `bun run typecheck` is your best friend for catching type errors early. Use it often. User it after finishing any edits in a file. Will save you time and headaches.
- Full type safety is a core value. Never use `any` casts. If you find yourself needing one, consider if you can improve the types or if it's a sign of a design issue.

## Testing Requirements — MANDATORY

**Every feature implementation MUST include matching tests.** Not optional. Not "if there's time." The tests are part of the feature.

### Test Framework

- **Runner:** `bun:test` (import from `"bun:test"`)
- **Run command:** `bun test`
- **Setup preload:** `src/tests/setup.ts` (isolates config to temp dir via `TAMIAS_CONFIG_PATH`)
- **Test locations:** `src/tests/*.test.ts` and `src/utils/*.test.ts`

### Test Categories — Every Public Function Gets ALL of These

For each public function or method, write tests covering:

1. **Happy path** — main expected usage with realistic data, asserting actual return values/side effects
2. **Empty/missing input** — `undefined`, `{}`, `[]`, `null`, missing keys
3. **Malformed input** — wrong types, partial data, extra fields
4. **Boundary cases** — single item vs many, `"*"` wildcard, special characters, max lengths
5. **Error paths** — network failures, missing files, invalid config — assert graceful failure (no crash)
6. **State transitions** — for stateful objects (bridges, sessions): init → use → destroy lifecycle

### What Makes a BAD Test (DO NOT WRITE THESE)

```typescript
// ❌ BAD — only proves the export exists, not that it works
test('myFunction exists', () => {
    expect(typeof myFunction).toBe('function')
})

// ❌ BAD — no meaningful assertion
test('does not throw', () => {
    expect(() => process(data)).not.toThrow()
})

// ❌ BAD — asserts a type, not behavior
test('returns an object', () => {
    expect(typeof result).toBe('object')
})
```

### What Makes a GOOD Test (WRITE THESE)

```typescript
// ✅ GOOD — exercises real logic, asserts real values
test('filterMessages drops messages from non-allowed groups', () => {
    const bridge = new MyBridge('test')
    bridge.allowedGroups = ['allowed@g.us']
    const msg = { from: 'other@g.us', body: 'hello' }
    expect(bridge.shouldProcess(msg)).toBe(false)
})

// ✅ GOOD — tests the edge case
test('allowedGroups with "*" wildcard accepts all groups', () => {
    const bridge = new MyBridge('test')
    bridge.allowedGroups = ['*']
    expect(bridge.shouldProcess({ from: 'any@g.us', body: 'hi' })).toBe(true)
})

// ✅ GOOD — tests empty state
test('discoverGroups returns empty array when not connected', async () => {
    const bridge = new MyBridge('test')
    const groups = await bridge.discoverGroups()
    expect(groups).toEqual([])
})
```

### Mocking Patterns

- **External SDKs** (discord.js, baileys, etc.) → `mock.module()` at top of test file
- **Simple function mocks** → `mock()` from `bun:test`
- **Config isolation** → already handled by `src/tests/setup.ts` preload (writes to temp dir)
- **Filesystem** → use `mkdtempSync(join(tmpdir(), 'tamias-test-'))` for temp dirs
- **AVOID** `as any` casts on private properties when possible — prefer constructor injection or `mock.module()`

### Workflow — Tests Are Written DURING Implementation, Not After

1. Implement a function
2. Write its tests immediately (all 6 categories above)
3. Run `bun test` — fix any failures
4. Move to next function
5. NEVER mark a feature "done" without passing tests

### Coverage

Run `bun test --coverage` to verify coverage. New files should have meaningful non-trivial coverage — not just import checks.

## Code Conventions

- **Module system:** ESNext with `"moduleResolution": "bundler"`
- **Imports:** Use `.ts` extensions (`import { foo } from './bar.ts'`)
- **Config schemas:** Zod in `src/utils/config.ts`
- **Bridge pattern:** Implement `IBridge` from `src/bridge/types.ts`
- **CLI flows:** `@clack/prompts` in `src/commands/`
- **Dashboard:** Next.js App Router at `src/dashboard/`, DaisyUI/Tailwind
- **AI tools:** Factory functions in `src/tools/` organized into 13 namespaces (`files`, `config`, `daemon`, `channels`, `skills`, `memory`, `web`, `media`, `projects`, `github`, `cron`, `email`, `agents`) — `createXTools(aiService, sessionId)`

## File Naming

- Source: `src/<domain>/foo.ts`
- Tests: `src/tests/foo.test.ts` (features) or `src/utils/foo.test.ts` (utils, co-located)
- Bridge channels: `src/bridge/channels/<platform>.ts`
- Type declarations: `src/types/<module>.d.ts`


## openclaw-main

Is another project that is in the codebase for reference ONLY. You can search and read, but otherwise should be ignored. Do NOT import from it or write tests for it. It is not part of the Tamias codebase, just a reference implementation of an agentic architecture.


# README

You are responsible for the readme, which is the main source of documentation for users. It should be clear, concise, and comprehensive. It should cover:
- What Tamias is and what it can do
- How to install and run it
- How to configure it
- How to use the dashboard

- Code structure and architecture overview for developers
- How to add new channels,tools, skills, etc.
