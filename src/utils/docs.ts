/**
 * Auto-documentation generator for Tamias.
 *
 * Generates markdown documentation from:
 *  - Config schema (connections, bridges, tools, MCP)
 *  - CLI commands (from Commander definitions)
 *  - Skills (from skills directory)
 *  - Tools (from tool registry)
 *  - API endpoints (from start.ts routes)
 */

import { join } from 'path'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { TAMIAS_DIR } from '../utils/config.ts'
import { VERSION } from '../utils/version.ts'

interface DocSection {
	title: string
	content: string
}

/**
 * Generate all documentation files.
 */
export function generateDocs(outputDir?: string): string[] {
	const docsDir = outputDir ?? join(TAMIAS_DIR, 'docs')
	if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true })

	const generated: string[] = []

	// 1. Architecture overview
	const archDoc = generateArchitectureDoc()
	writeFileSync(join(docsDir, 'architecture.md'), archDoc)
	generated.push('architecture.md')

	// 2. CLI reference
	const cliDoc = generateCliReference()
	writeFileSync(join(docsDir, 'cli-reference.md'), cliDoc)
	generated.push('cli-reference.md')

	// 3. Configuration reference
	const configDoc = generateConfigReference()
	writeFileSync(join(docsDir, 'configuration.md'), configDoc)
	generated.push('configuration.md')

	// 4. API reference
	const apiDoc = generateApiReference()
	writeFileSync(join(docsDir, 'api-reference.md'), apiDoc)
	generated.push('api-reference.md')

	// 5. Skills reference
	const skillsDoc = generateSkillsReference()
	writeFileSync(join(docsDir, 'skills.md'), skillsDoc)
	generated.push('skills.md')

	// 6. Migration guide
	const migrationDoc = generateMigrationGuide()
	writeFileSync(join(docsDir, 'migrations.md'), migrationDoc)
	generated.push('migrations.md')

	return generated
}

function generateArchitectureDoc(): string {
	return `# Tamias Architecture

> Auto-generated documentation for Tamias v${VERSION}

## Overview

Tamias is a secure, agentic AI chat interface powered by the Vercel AI SDK. It runs as a daemon process that manages sessions, tools, and channels.

## System Architecture

\`\`\`
┌──────────────────────────────────────────┐
│                CLI Client                │
│  tamias chat / setup / config / ...      │
└──────────┬───────────────────────────────┘
           │ HTTP REST + SSE
┌──────────▼───────────────────────────────┐
│              Daemon (port 9001)           │
│  ┌─────────────┐  ┌──────────────────┐   │
│  │  AIService   │  │  BridgeManager   │   │
│  │  (sessions)  │  │  (channels)      │   │
│  └──────┬──────┘  └────────┬─────────┘   │
│         │                  │             │
│  ┌──────▼──────┐  ┌───────▼──────────┐   │
│  │ Tool Runner  │  │ Discord Bridge   │   │
│  │ MCP Clients  │  │ Telegram Bridge  │   │
│  │ Skills       │  │ WhatsApp Bridge  │   │
│  └─────────────┘  └──────────────────┘   │
│                                          │
│  ┌────────────┐  ┌───────────────────┐   │
│  │  SQLite DB  │  │  Memory Files    │   │
│  │  (WAL mode) │  │  (~/.tamias/)    │   │
│  └────────────┘  └───────────────────┘   │
└──────────────────────────────────────────┘
\`\`\`

## Key Components

### AIService
- Manages AI sessions with the Vercel AI SDK
- Handles model fallback chains across providers
- Supports sub-agent delegation
- Token budget management for context assembly

### BridgeManager
- Manages communication channels (Discord, Telegram, WhatsApp)
- Routes incoming messages to AI sessions
- Dispatches AI responses back to channels

### Memory System
- Persona files: USER.md, IDENTITY.md, SOUL.md, MEMORY.md
- Daily notes and digests
- Project memory with activity logging
- Token budget with priority-based context assembly

### Migration System
- Versioned migrations for config, layout, and database
- Backward-compatible with version tracking
- AI-assisted migrations for complex changes

### Multi-Tenancy
- Tenant-isolated directories
- Per-tenant configuration and memory
- Shared daemon with separate data stores

## Data Flow

1. Message arrives (CLI, Discord, Telegram, WhatsApp)
2. BridgeManager routes to AIService
3. AIService builds system prompt (token budget)
4. AI processes with tools and skills
5. Response flows back through bridge to user
`
}

function generateCliReference(): string {
	const commands = [
		{ cmd: 'tamias chat', desc: 'Launch interactive AI chat session' },
		{ cmd: 'tamias start', desc: 'Start the daemon', opts: '--daemon, --verbose' },
		{ cmd: 'tamias stop', desc: 'Stop the daemon' },
		{ cmd: 'tamias restart', desc: 'Restart the daemon', opts: '--verbose' },
		{ cmd: 'tamias status', desc: 'Show daemon status and sessions' },
		{ cmd: 'tamias setup', desc: 'Interactive setup wizard' },
		{ cmd: 'tamias config', desc: 'Add a new provider configuration' },
		{ cmd: 'tamias config show', desc: 'Display current configuration', opts: '--json' },
		{ cmd: 'tamias config path', desc: 'Print config file path' },
		{ cmd: 'tamias model', desc: 'View current default model' },
		{ cmd: 'tamias model set', desc: 'Set the default model' },
		{ cmd: 'tamias model set-image', desc: 'Set default image model priority' },
		{ cmd: 'tamias models', desc: 'List all configured models' },
		{ cmd: 'tamias models add', desc: 'Add a new model config' },
		{ cmd: 'tamias models edit [nickname]', desc: 'Edit a model config' },
		{ cmd: 'tamias models delete [nickname]', desc: 'Delete a model config' },
		{ cmd: 'tamias tools', desc: 'List tools and MCP servers' },
		{ cmd: 'tamias tools add-mcp', desc: 'Add an MCP server' },
		{ cmd: 'tamias tools enable [name]', desc: 'Enable a tool or MCP' },
		{ cmd: 'tamias tools disable [name]', desc: 'Disable a tool or MCP' },
		{ cmd: 'tamias tools edit [name]', desc: 'Configure tool functions' },
		{ cmd: 'tamias tools remove-mcp [name]', desc: 'Remove an MCP server' },
		{ cmd: 'tamias channels', desc: 'List communication channels' },
		{ cmd: 'tamias channels add', desc: 'Add a new channel' },
		{ cmd: 'tamias channels edit', desc: 'Edit a channel' },
		{ cmd: 'tamias channels remove [platform]', desc: 'Remove a channel' },
		{ cmd: 'tamias agents', desc: 'Manage agents' },
		{ cmd: 'tamias skills', desc: 'Manage skills' },
		{ cmd: 'tamias cron', desc: 'Manage scheduled tasks' },
		{ cmd: 'tamias emails', desc: 'Manage email accounts' },
		{ cmd: 'tamias project', desc: 'Project memory management' },
		{ cmd: 'tamias project list', desc: 'List all projects' },
		{ cmd: 'tamias project create [name]', desc: 'Create a new project' },
		{ cmd: 'tamias project show [slug]', desc: 'Show project details' },
		{ cmd: 'tamias project archive [slug]', desc: 'Archive a project' },
		{ cmd: 'tamias tenant', desc: 'Multi-tenant management' },
		{ cmd: 'tamias tenant list', desc: 'List all tenants' },
		{ cmd: 'tamias tenant create [name]', desc: 'Create a new tenant' },
		{ cmd: 'tamias tenant delete [id]', desc: 'Delete a tenant' },
		{ cmd: 'tamias tenant switch [id]', desc: 'Switch active tenant' },
		{ cmd: 'tamias migrate', desc: 'Show migration status' },
		{ cmd: 'tamias migrate run', desc: 'Apply pending migrations', opts: '--dry-run, --tenant <id>' },
		{ cmd: 'tamias doctor', desc: 'Health checks and dependency verification', opts: '--fix, --json' },
		{ cmd: 'tamias usage [period]', desc: 'Show usage stats (today/week/month/all)' },
		{ cmd: 'tamias history', desc: 'View daemon logs', opts: '-n, --no-follow, --clear' },
		{ cmd: 'tamias workspace [path]', desc: 'View or set workspace directory' },
		{ cmd: 'tamias update', desc: 'Check for updates' },
		{ cmd: 'tamias onboarding', desc: 'Re-run first-run onboarding' },
		{ cmd: 'tamias debug', desc: 'Toggle debug mode' },
		{ cmd: 'tamias browser', desc: 'Open browser for manual login' },
		{ cmd: 'tamias backup', desc: 'Backup configuration', opts: '-f <path>' },
		{ cmd: 'tamias restore <file>', desc: 'Restore from backup' },
		{ cmd: 'tamias uninstall', desc: 'Remove Tamias completely' },
	]

	let doc = `# CLI Reference\n\n> Tamias v${VERSION}\n\n`
	doc += `| Command | Description | Options |\n`
	doc += `|---------|-------------|----------|\n`

	for (const c of commands) {
		doc += `| \`${c.cmd}\` | ${c.desc} | ${(c as any).opts ?? ''} |\n`
	}

	return doc
}

function generateConfigReference(): string {
	return `# Configuration Reference

> Tamias v${VERSION}

Config file location: \`~/.tamias/config.json\`

## Schema

### Top-Level

| Field | Type | Description |
|-------|------|-------------|
| \`version\` | string | Config version |
| \`connections\` | Record<string, Connection> | AI provider connections |
| \`defaultModels\` | string[] | Ordered list of default models |
| \`bridges\` | BridgesConfig | Channel configurations |
| \`tools\` | Record<string, ToolConfig> | Internal tool settings |
| \`mcpServers\` | Record<string, McpConfig> | External MCP servers |
| \`workspace\` | string | Restricted workspace path |

### Connection

| Field | Type | Description |
|-------|------|-------------|
| \`nickname\` | string | Unique identifier |
| \`provider\` | enum | openai, anthropic, google, openrouter, ollama, antigravity |
| \`envKeyName\` | string | Environment variable for API key |
| \`selectedModels\` | string[] | Available models |
| \`baseUrl\` | string? | Custom API endpoint |

### Bridges Config

| Field | Type | Description |
|-------|------|-------------|
| \`terminal\` | { enabled } | Terminal bridge |
| \`discords\` | Record<string, DiscordConfig> | Discord instances |
| \`telegrams\` | Record<string, TelegramConfig> | Telegram instances |
| \`whatsapps\` | Record<string, WhatsAppConfig> | WhatsApp instances |

### Discord Config

| Field | Type | Description |
|-------|------|-------------|
| \`enabled\` | boolean | Whether this instance is active |
| \`envKeyName\` | string | Env var for bot token |
| \`allowedChannels\` | string[] | Channel IDs to listen to |
| \`mode\` | enum | full, mention-only, listen-only |

### Telegram Config

| Field | Type | Description |
|-------|------|-------------|
| \`enabled\` | boolean | Whether this instance is active |
| \`envKeyName\` | string | Env var for bot token |
| \`mode\` | enum | full, mention-only, listen-only |

### WhatsApp Config

| Field | Type | Description |
|-------|------|-------------|
| \`enabled\` | boolean | Whether this instance is active |
| \`phoneNumberId\` | string | Meta phone number ID |
| \`envKeyName\` | string | Env var for access token |
| \`verifyToken\` | string | Webhook verification token |
| \`webhookPath\` | string | Webhook URL path |
| \`mode\` | enum | full, mention-only |

## Environment Variables

Stored in \`~/.tamias/.env\`:

| Variable | Description |
|----------|-------------|
| \`OPENAI_API_KEY\` | OpenAI API key |
| \`ANTHROPIC_API_KEY\` | Anthropic API key |
| \`GOOGLE_GENERATIVE_AI_API_KEY\` | Google Gemini key |
| \`OPENROUTER_API_KEY\` | OpenRouter API key |
| \`TAMIAS_DEBUG\` | Enable debug logging (1) |
| \`TAMIAS_AUTH_TOKEN\` | Dashboard auth token |

## Memory Files

Located in \`~/.tamias/memory/\`:

| File | Purpose |
|------|---------|
| \`USER.md\` | User profile and preferences |
| \`IDENTITY.md\` | AI assistant identity |
| \`SOUL.md\` | AI personality and values |
| \`MEMORY.md\` | Long-term memory |
| \`SYSTEM.md\` | System operating manual |
| \`daily/\` | Daily notes by date |
`
}

function generateApiReference(): string {
	return `# Daemon API Reference

> Tamias v${VERSION}

Base URL: \`http://127.0.0.1:9001\`

## Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/health\` | Daemon health check |
| GET | \`/debug\` | Debug info (version, connections, sessions) |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/sessions\` | List all active sessions |
| GET/POST | \`/session\` | Create a new session |
| GET | \`/session/:id/messages\` | Get session message history |
| GET | \`/session/:id/stream\` | SSE stream for session events |
| DELETE | \`/session/:id\` | Delete a session |

### Messages

| Method | Path | Description |
|--------|------|-------------|
| POST | \`/message\` | Send a message to a session |

### Usage & History

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/usage\` | Aggregated usage stats & cost breakdown |
| GET | \`/history\` | Recent AI request logs |

### Cron

| Method | Path | Description |
|--------|------|-------------|
| POST | \`/cron-test\` | Test-fire a cron job |

### WhatsApp Webhooks

| Method | Path | Description |
|--------|------|-------------|
| GET | \`/webhook/whatsapp/:key\` | Webhook verification (Meta challenge) |
| POST | \`/webhook/whatsapp/:key\` | Incoming WhatsApp messages |

### Daemon Control

| Method | Path | Description |
|--------|------|-------------|
| DELETE | \`/daemon\` | Shutdown the daemon |

## SSE Events

The \`/session/:id/stream\` endpoint emits:

| Event | Data | Description |
|-------|------|-------------|
| \`start\` | { sessionId } | Processing started |
| \`chunk\` | { text } | Text chunk from AI |
| \`tool_call\` | { name, input } | Tool invocation |
| \`tool_result\` | { name, result } | Tool result |
| \`done\` | { sessionId } | Processing complete |
| \`error\` | { message } | Error occurred |
| \`file\` | { name, buffer, mimeType } | File attachment |
| \`subagent-status\` | { subagentId, task, status, message } | Sub-agent lifecycle |
| \`heartbeat\` | {} | Keep-alive (every 15s) |

## Usage Response

\`\`\`json
{
  "today": 0.05,
  "yesterday": 0.12,
  "thisWeek": 0.34,
  "thisMonth": 1.20,
  "total": 5.67,
  "totalPromptTokens": 150000,
  "totalCompletionTokens": 45000,
  "totalRequests": 230,
  "dailySpend": [{ "date": "2025-01-15", "cost": 0.05 }],
  "modelDistribution": [{ "name": "gpt-4o", "value": 3.20 }],
  "initiatorDistribution": [{ "name": "Discord", "value": 2.10 }],
  "tenantDistribution": [{ "name": "default", "value": 5.67 }],
  "agentDistribution": [{ "name": "main", "value": 4.00 }],
  "channelDistribution": [{ "name": "discord", "value": 2.10 }]
}
\`\`\`
`
}

function generateSkillsReference(): string {
	const skillsDir = join(TAMIAS_DIR, 'skills')
	let skillList = ''

	if (existsSync(skillsDir)) {
		const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory())
		for (const dir of dirs) {
			const manifest = join(skillsDir, dir.name, 'manifest.json')
			if (existsSync(manifest)) {
				try {
					const m = JSON.parse(readFileSync(manifest, 'utf-8'))
					skillList += `### ${m.name ?? dir.name}\n\n`
					skillList += `- **Description:** ${m.description ?? 'No description'}\n`
					skillList += `- **Version:** ${m.version ?? 'unknown'}\n`
					if (m.triggers) skillList += `- **Triggers:** ${m.triggers.join(', ')}\n`
					skillList += `\n`
				} catch {
					skillList += `### ${dir.name}\n\n(manifest unreadable)\n\n`
				}
			} else {
				skillList += `### ${dir.name}\n\n(no manifest.json)\n\n`
			}
		}
	}

	if (!skillList) skillList = 'No skills installed.\n'

	return `# Skills Reference

> Tamias v${VERSION}

Skills are user-defined automation scripts stored in \`~/.tamias/skills/\`.

## Installing Skills

\`\`\`bash
tamias skills add <git-url>
tamias skills list
tamias skills enable <name>
tamias skills disable <name>
\`\`\`

## Installed Skills

${skillList}

## Creating a Skill

A skill directory must contain:

1. \`manifest.json\` — metadata (name, description, version, triggers)
2. \`index.ts\` or \`index.js\` — entry point exporting a \`run()\` function

### manifest.json

\`\`\`json
{
  "name": "my-skill",
  "description": "Does something useful",
  "version": "1.0.0",
  "triggers": ["keyword1", "keyword2"]
}
\`\`\`

### index.ts

\`\`\`typescript
export async function run(context: {
  message: string
  sessionId: string
  emit: (text: string) => void
}) {
  context.emit("Skill output here")
}
\`\`\`
`
}

function generateMigrationGuide(): string {
	return `# Migration Guide

> Tamias v${VERSION}

## Overview

Tamias uses a versioned migration system to safely evolve:
- **Config migrations** — changes to config.json schema
- **Layout migrations** — changes to filesystem structure (~/.tamias/)
- **DB migrations** — changes to SQLite schema

## Commands

\`\`\`bash
# Check migration status
tamias migrate status

# Apply pending migrations
tamias migrate run

# Preview without applying
tamias migrate run --dry-run

# Run for a specific tenant
tamias migrate run --tenant <id>
\`\`\`

## How It Works

1. Each migration has a version number, domain, and an up() function
2. Current versions are tracked in ~/.tamias/meta.json
3. Database version uses SQLite PRAGMA user_version
4. Migrations run automatically on daemon startup
5. All migrations are backward-compatible

## Migration History

| Version | Domain | Description |
|---------|--------|-------------|
| v001 | layout | Create projects directory |
| v002 | layout | Create meta.json tracking file |
| v003 | layout | Create tenants directory |
| v001 | config | Add config version tracking |
| v002 | config | Add channel mode fields |
| v005 | db | Enrich ai_logs with tenant, agent, channel, cost columns |

## Creating Custom Migrations

Migrations implement the Migration interface:

\`\`\`typescript
import type { Migration } from './types'

export const migration: Migration = {
  version: 3,
  domain: 'layout',
  description: 'Create tenants directory',
  async up(tamiasDirPath: string) {
    // Perform migration
  }
}
\`\`\`
`
}
