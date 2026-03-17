# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Tamias

Tamias is an AI assistant daemon with a client-daemon architecture. It manages multiple concurrent chat sessions across bridges (Terminal, Discord, Telegram, WhatsApp), provides 19 AI tools, sub-agent spawning, skills, cron jobs, and a Next.js dashboard. Built with Bun and TypeScript, powered by the Vercel AI SDK (multi-provider: OpenAI, Anthropic, Google, OpenRouter).

## Commands

```bash
# Development
bun install              # Install dependencies
bun --hot src/index.ts   # Dev mode with hot reload
bun run dev:start        # Dev mode for the daemon

# Build
bun run build            # Compile standalone binary

# Type checking
bun run typecheck        # Check main source
bun run typecheck:all    # Check main + dashboard + e2e

# Testing
bun test                                    # Run all unit tests
bun test --preload ./src/tests/setup.ts src/tests/foo.test.ts  # Run a single test file
bun test --coverage                         # Coverage report
bunx playwright test                        # E2E tests (needs dashboard on port 3001)
bunx playwright test test/e2e/foo.spec.ts   # Single E2E test
```

## Architecture

**Client-Daemon model**: The daemon (`tamias start`) runs on port 9001 (REST API) and serves the Next.js dashboard on port 5678. All bridges, sessions, and tools are coordinated through the daemon.

**Key paths**:
- `src/index.ts` — CLI entry point (Commander)
- `src/commands/start.ts` — Daemon startup, REST API routing
- `src/services/aiService.ts` — Core AI orchestration (sessions, streaming, tool execution)
- `src/bridge/` — Multi-channel coordinator + channel implementations (`channels/discord.ts`, `telegram.ts`, etc.)
- `src/tools/` — 19 AI tool files, each exports a factory: `createXTools(aiService, sessionId)`
- `src/core/` — Domain registry, adapters (ai-tools, dashboard, docs)
- `src/utils/config.ts` — Zod config schemas and I/O
- `src/utils/db.ts` — SQLite setup + migrations (WAL mode, PRAGMA user_version)
- `src/dashboard/` — Next.js App Router (separate tsconfig, own package.json)
- `src/dashboard/src/middleware.ts` — Token auth + onboarding redirect
- `src/dashboard/src/app/api/` — 33+ API routes proxying to daemon
- `src/skills/` — Built-in agent persona templates (analyst, coder, devops, planner, researcher, writer)

**Database**: SQLite via `bun:sqlite`. Tables: `sessions`, `messages`, `ai_logs`. Migrations are version-controlled via PRAGMA user_version.

**Auth**: Token-based. Random token generated at daemon startup, stored in `~/.tamias/daemon-info.json`, passed as query param or header. Localhost-only.

**Config**: All user config lives in `~/.tamias/config.json` (Zod-validated). Agent personas are `.md` files in `~/.tamias/agents/`. Skills are `.md` files with YAML frontmatter.

## Coding Standards

- **TDD is mandatory**. Tests are part of the feature, not optional. Write tests during implementation, not after.
- **Full type safety**. Never use `any` casts. Run `bun run typecheck` after editing files.
- **Imports use `.ts` extensions**: `import { foo } from './bar.ts'`
- **Module system**: ESNext with `"moduleResolution": "bundler"`, `"verbatimModuleSyntax": true`
- **Bridge pattern**: Implement `IBridge` from `src/bridge/types.ts`
- **AI tools**: Factory functions in `src/tools/` using Vercel AI SDK's `tool()` wrapper with Zod input schemas
- **CLI flows**: Use `@clack/prompts` in `src/commands/`
- **Dashboard**: Next.js App Router, DaisyUI/Tailwind for styling

## Testing

**Framework**: `bun:test`. Setup preload at `src/tests/setup.ts` isolates config to a temp dir via `TAMIAS_CONFIG_PATH`.

**Test locations**: `src/tests/*.test.ts` (features) and `src/utils/*.test.ts` (co-located with utils).

**Every public function needs tests covering**: happy path, empty/missing input, malformed input, boundary cases, error paths, and state transitions.

**Mocking**: `mock.module()` for external SDKs, `mock()` for simple functions, `mkdtempSync` for temp filesystem. Avoid `as any` casts — prefer constructor injection or `mock.module()`.

**Bad tests** assert only existence (`typeof`), non-throwing, or return type. **Good tests** exercise real logic and assert real values.

## Important Notes

- `openclaw-main/` is a reference project in the repo — do NOT import from it, write tests for it, or modify it.
- The root `tsconfig.json` excludes `src/dashboard`, `test/e2e`, and `openclaw-main` — these have their own tsconfigs.
- E2E tests use Playwright against a Next.js dev server on port 3001.
- The dashboard has its own `package.json` and `tsconfig.json` inside `src/dashboard/`.
