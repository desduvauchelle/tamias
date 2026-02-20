# Tamias 🐿️

> A secure, agentic AI chat interface for the terminal — powered by the Vercel AI SDK and Bun.

Tamias lets you configure multiple AI provider connections (OpenAI, Anthropic, Google, OpenRouter), chat with any of them from the terminal, and give the AI access to **tools** — including a built-in terminal tool that lets it autonomously run commands, navigate your filesystem, read and write files, and more.

You can also plug in any standard **MCP server** (e.g. Google Drive, GitHub, Notion) without writing any code.

Tamias comes from the Ancient Greek word ταμίας (tamíās), which means "steward," "treasurer," "dispenser," or "housekeeper". In scientific terms, it is the genus name for chipmunks, referencing their habit of collecting and storing food for the winter.

---

## Installation

**Requirements**: [Bun](https://bun.sh) ≥ 1.1

### One-line Install (Recommended)
You can install the latest release directly via curl:
```bash
curl -fsSL https://raw.githubusercontent.com/desduvauchelle/tamias/main/install.sh | bash
```

### Build from Source
```bash
git clone https://github.com/desduvauchelle/tamias.git
cd tamias
./install.sh
```

This builds the binary and symlinks `tamias` to your `~/.bun/bin` — so it's available globally.

> All configuration is stored securely in `~/.tamias/config.json`.

---

## Quick Start

```bash
# 1. Add an AI provider connection
tamias config

# 2. Pick a default model (optional)
tamias model set

# 3. Start chatting (auto-starts the daemon)
tamias chat
```

---

## Architecture

Tamias uses a **Client-Daemon** architecture to manage multiple concurrent chats and persistent tool state.

### The Daemon (`tamias start`)
A central background process that:
- Maintains a **persistent connection** to all active session models.
- Manages an **async message queue** per session (no race conditions).
- Orchestrates **tool execution** (internal and MCP).
- Serves an **HTTP + SSE (Server-Sent Events)** API on a local port (usually `9001+`).

### Sessions
Every time you run `tamias chat`, a unique **Session ID** is created on the daemon. Each session has its own message history and isolated tool environment. You can have multiple terminal windows chatting with different models simultaneously via the same daemon.

### Communication
1. **Client -> Daemon**: The CLI sends your input via HTTP POST.
2. **Daemon -> Client**: The daemon streams tokens and tool calls back to your terminal in real-time via a persistent SSE stream.

> [!NOTE]
> The `tamias chat` command automatically starts the daemon in the background if it's not already running.

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
2. Tamias ensures the background daemon is running (auto-starts if needed)
3. A new session is created and streamed in real-time via SSE
4. The AI can autonomously call tools across up to **20 steps** per message
5. Type `exit` or `quit` to end the session

---

### `tamias model`
Manage the global default model.

```bash
tamias model        # Show current default model
tamias model set    # Interactively pick a default from your connections
```

---

### `tamias daemon`
Control the central Tamias background process.

```bash
tamias start           # Start the daemon (interactive)
tamias start --daemon  # Start in background mode
tamias stop            # Gracefully shut down the daemon
tamias status          # Show port, PID, uptime, and active sessions
```

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

#### `tamias` tool (built-in)

Allows the AI to **self-manage** its own configuration and the daemon. Functions:

| Function | Description |
|---|---|
| `get_default_model` | Get the current default model |
| `set_default_model` | Update the global default model |
| `list_model_configs`| List all connections and their models |
| `list_sessions` | List active chat sessions on the daemon |
| `list_tools` | List all internal tools and external MCPs |
| `enable_tool` | Enable an internal tool |
| `disable_tool` | Disable an internal tool |
| `add_mcp_server` | Register a new external MCP server |
| `remove_mcp_server`| Remove an MCP server |
| `daemon_status` | Get uptime, port, and PID |
| `stop_daemon` | Shut down the Tamias daemon |

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
bun run start        # Start the daemon
bun run stop         # Stop the daemon
bun run chat         # Run chat client
bun run models list  # Run models list command
bun run tools        # Run tools manager
bun run build        # Build standalone binary
./install.sh         # Build + install globally
```


# TODO

- [x] Command line setup
- [x] Provider config and management
- [x] MCP setup - Terminal access
- [x] Daemon start / stop
- [x] Terminal chat with sessions and queuing
- [x] Added basic memory for personality
- [x] Add memory logic (update user/robot/memories), chat session length management (auto-summarize after 20 chats, and include summary in conversation memory instead of all the history, this should auto update memory files and conversation files)
- [x] Bridge: We have terminal chats, but we want to connect to other chat interfaces, such as Discoard, Telegram for now. This bridge takes care of the connection and routing of messages between the daemon and the chat interface. The AI should be able to self add, remove, update this from a conversation. The messages from the various platforms need to be standardized to a single format before being sent to the daemon, and the response from the daemon needs to be converted to the appropriate format for the platform it's being sent to. The bridge should also handle the authentication with the various platforms, and the AI should be able to manage these connections from a conversation. The bridge should be able to handle multiple conversations at once, and route messages to the correct conversation through sessions.
- [] Add notion of skills (directory of skills, and ability to load them on the fly, skills are at least a markdown file with a name, description, text to explain the whole skill and maybe other executble files that can be called by the skill to complete an action)
- [] Add the notion of heartbeat, which is a cron job that runs every 30minutes by default but can be changed in the configuration file.
- [] Add corn job management.
