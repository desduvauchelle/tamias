# Tamias 🐿️

> A secure, agentic AI chat interface for the terminal — powered by the Vercel AI SDK and Bun.

Tamias lets you configure multiple AI provider connections (OpenAI, Anthropic, Google, OpenRouter), chat with any of them from the terminal, and give the AI access to **tools** — including a built-in terminal tool that lets it autonomously run commands, navigate your filesystem, read and write files, and more.

You can also plug in any standard **MCP server** (e.g. Google Drive, GitHub, Notion) without writing any code.

Tamias comes from the Ancient Greek word ταμίας (tamíās), which means "steward," "treasurer," "dispenser," or "housekeeper". In scientific terms, it is the genus name for chipmunks, referencing their habit of collecting and storing food for the winter.

---

## Installation

**Requirements**: [Bun](https://bun.sh) ≥ 1.1

```bash
git clone <this-repo>
cd commander-v2
./install.sh
```

This builds the binary and symlinks `tamias` to your `~/.bun/bin` — so it's available globally.

> All configuration is stored securely in `~/.tamias/config.json`.

---

## Quick Start

```bash
# 1. Add an AI provider connection
tamias config

# 2. Start chatting
tamias chat
```

---

## CLI Reference

### `tamias config`
Add a new AI provider connection. Walk through:
1. Pick a provider (OpenAI, Anthropic, Google Gemini, OpenRouter, Antigravity)
2. Enter your API key
3. Give the connection a short nickname (e.g. `lc-openai`)
4. Select which models you want to use from a live-fetched list

---

### `tamias models`
Manage your saved model configurations.

```bash
tamias models list              # See all configs and their selected models
tamias models add               # Same as `tamias config`
tamias models edit [nickname]   # Rename or update selected models
tamias models delete [nickname] # Remove a config
```

**Example output of `tamias models list`:**
```
lc-openai/gpt-4o
lc-openai/gpt-5.2-chat-latest
lc2-openai  (no models selected)
```

---

### `tamias chat`
Start an interactive chat session.

1. Pick a model from your configured list (`nickname/model`)
2. Enabled tools are automatically loaded
3. The AI can autonomously call tools across up to **20 steps** per message
4. Tool calls and their results are printed in real time
5. Type `exit` or `quit` to end the session

---

### `tamias tools`
Manage tools available to the AI. Both internal tools and external MCP servers live here.

```bash
tamias tools list               # Show all tools and MCPs with their status
tamias tools add-mcp            # Connect an external MCP server
tamias tools enable [name]      # Enable a tool or MCP
tamias tools disable [name]     # Disable it
tamias tools edit [name]        # Toggle functions, set regex allowlists
tamias tools remove-mcp [name]  # Remove an external MCP server
```

---

## Tools

Tools make the AI **agentic** — it can call them autonomously and chain multiple calls to complete complex tasks.

There are two kinds:

### Internal Tools (`src/tools/`)

Built-in tools shipped with Tamias. Each file in `src/tools/` is a separate tool.

#### `terminal` tool (built-in)

Gives the AI full filesystem and shell access. Functions:

| Function | Description |
|---|---|
| `run_command` | Execute any shell command (with stdout/stderr) |
| `read_file` | Read a file's contents |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace an exact string in a file |
| `delete_file` | Delete a file |
| `move_file` | Move or rename a file |
| `copy_file` | Copy a file |
| `list_dir` | List files and directories |
| `find_files` | Find files matching a pattern |

**The terminal tool is enabled by default.** The AI can use it without any extra setup.

---

### External MCPs

Connect any standard [MCP](https://modelcontextprotocol.io) server — no code required.

```bash
tamias tools add-mcp
```

You'll be prompted for:
- A short name (e.g. `gdrive`)
- Transport type: `stdio` (local process) or `http` (remote URL)
- For stdio: the command and args (e.g. `npx -y @some/gdrive-mcp`)
- For http: the URL and any auth headers

**Example MCP servers**:
- [Google Drive](https://github.com/felixbranscombe/gdrive-mcp) — list, read, write Drive files
- [GitHub](https://github.com/github/github-mcp-server) — repos, issues, PRs
- [Filesystem](https://github.com/modelcontextprotocol/servers) — enhanced file access

---

### Configuring Tool Safety

Each tool and function has independent controls:

#### Enable / disable an entire tool
```bash
tamias tools disable terminal
tamias tools enable terminal
```

#### Enable / disable individual functions
```bash
tamias tools edit terminal
# → select a function (e.g. run_command)
# → toggle on/off
```

#### Allowlists (regex)
Restrict what a function can be called with. For example, only allow `ls` and `cat` commands:

```bash
tamias tools edit terminal
# → run_command → Edit allowlist
# → Enter: ^ls ,^cat
```

If an allowlist is set, at least one pattern must match the call arguments — otherwise the call is blocked and an error is returned to the AI.

---

### Adding a New Internal Tool

1. Create a new file in `src/tools/`, e.g. `src/tools/browser.ts`
2. Export a `browserTools` object using the Vercel AI SDK `tool()` helper with `inputSchema` (Zod)
3. Export a `BROWSER_TOOL_NAME` and `BROWSER_TOOL_LABEL` constant
4. Register it in `src/utils/toolRegistry.ts` in the `internalCatalog` map

```ts
// src/tools/browser.ts
import { tool } from 'ai'
import { z } from 'zod'

export const BROWSER_TOOL_NAME = 'browser'
export const BROWSER_TOOL_LABEL = '🌐 Browser (fetch URLs)'

export const browserTools = {
  fetch_url: tool({
    description: 'Fetch the content of a URL',
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }: { url: string }) => {
      const res = await fetch(url)
      return { content: await res.text() }
    },
  }),
}
```

Then in `toolRegistry.ts`:
```ts
import { browserTools, BROWSER_TOOL_NAME } from '../tools/browser.ts'

const internalCatalog = {
  [TERMINAL_TOOL_NAME]: terminalTools,
  [BROWSER_TOOL_NAME]: browserTools, // ← add here
}
```

---

## Configuration File

All settings live in `~/.tamias/config.json`. You can inspect it directly, but it's best managed via the CLI commands.

```json
{
  "version": "1.0",
  "connections": {
    "lc-openai": {
      "nickname": "lc-openai",
      "provider": "openai",
      "apiKey": "sk-...",
      "selectedModels": ["gpt-4o", "gpt-5.2-chat-latest"]
    }
  },
  "internalTools": {
    "terminal": {
      "enabled": true,
      "functions": {
        "delete_file": { "enabled": false },
        "run_command": { "enabled": true, "allowlist": ["^ls", "^cat"] }
      }
    }
  },
  "mcpServers": {
    "gdrive": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@felixbranscombe/gdrive-mcp"]
    }
  }
}
```

---

## Development

```bash
bun run type-check   # Run TypeScript compiler (zero errors enforced)
bun run chat         # Run chat command directly
bun run models list  # Run models list command
bun run tools        # Run tools manager
bun run build        # Build standalone binary
./install.sh         # Build + install globally
```
