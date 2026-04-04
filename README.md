# Tamias 🐿️

<p align="center">
  <img src="src/assets/mascot.png" alt="Tamias Mascot" width="200" />
</p>

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

A central background process that maintains connections, manages message queues, and orchestrates tool execution. It also serves a **Dashboard** (usually on port 5678) and an **API** (port 9001).

---

## 📖 Learn More

Explore our in-depth guides to understand how Tamias works under the hood:

- **[Introduction to Tamias](./docs/introduction.md)**: Architecture and core concepts.
- **[Safety & Security](./docs/safety.md)**: How we keep your machine safe.
- **[Efficient Agency](./docs/efficient-agency.md)**: Optimizing token usage and sub-agents.
- **[Tool Guides](./docs/tool-guides.md)**: Deep dive into built-in and MCP tools.

---

<!-- CLI_DOCS_START -->

## CLI Reference

### `tamias cron`

Manage recurring cron jobs and heartbeats

| Command | Description |
|---|---|
| `tamias cron` | Manage recurring cron jobs and heartbeats |
| `tamias cron list` | List all configured cron jobs |
| `tamias cron add` | Add a new cron job (`-n, --name <name>`, `-s, --schedule <schedule>`, `-p, --prompt <prompt>`, `-T, --type <type>`, `--skills <skills>`, `--session-key <key>`, `--context <context>`, `--target-channel <target>`, `--target-email <email>`, `--target-file <path>`, `-t, --target <target>`, `--heartbeat`) |
| `tamias cron rm <id>` | Remove a cron job by ID |
| `tamias cron edit <id>` | Edit an existing cron job (`-n, --name <name>`, `-s, --schedule <schedule>`, `-p, --prompt <prompt>`, `-T, --type <type>`, `--skills <skills>`, `--session-key <key>`, `--context <context>`, `-t, --target <target>`, `--disable`, `--enable`) |
| `tamias cron run` | Run all due cron jobs once (manual or external scheduler) (`--job <id>`, `--dry-run`) |
| `tamias cron install` | Install the system crontab entry to run cron jobs every minute |
| `tamias cron uninstall` | Remove the system crontab entry |

### `tamias inspect`

Generate a debug report of the current system prompt, tools, and config

| Command | Description |
|---|---|
| `tamias inspect` | Generate a debug report of the current system prompt, tools, and config (`--print`) |

### `tamias start`

Start the Tamias daemon (central AI brain)

| Command | Description |
|---|---|
| `tamias start` | Start the Tamias daemon (central AI brain) (`--daemon`, `--verbose`, `--ngrok`, `--no-ngrok`) |

### `tamias stop`

Stop the running Tamias daemon

| Command | Description |
|---|---|
| `tamias stop` | Stop the running Tamias daemon |

### `tamias status`

Show daemon status and active sessions

| Command | Description |
|---|---|
| `tamias status` | Show daemon status and active sessions |

### `tamias doctor`

Check and fix system dependencies, health checks, and configuration

| Command | Description |
|---|---|
| `tamias doctor` | Check and fix system dependencies, health checks, and configuration (`--fix`, `--json`) |

### `tamias update`

Check for and install the latest Tamias version

| Command | Description |
|---|---|
| `tamias update` | Check for and install the latest Tamias version (`--force`, `--check`) |

<!-- CLI_DOCS_END -->

---

## Tools

Tools make the AI **agentic**. Tamias includes several powerful built-in tools.

### `terminal`

Full shell and filesystem access (can be restricted via allowlists).

| Function | Description |
|---|---|
| `run_command` | Execute any shell command |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Precise string replacement |
| `delete_file` | Remove a file |
| `list_dir` | Browser directories |

### `workspace`

A **restricted** version of the terminal that only allows operations within a specific directory.

| Function | Description |
|---|---|
| `run_command` | Execute shell commands (blocked keywords) |
| `read_file` / `write_file` | File access (path validated) |
| `list_dir` | Scope-limited directory listing |

### `github`

Integrated Git workflow for the AI.

| Function | Description |
|---|---|
| `git_status` | Check repository status |
| `git_add` / `git_commit` | Stage and commit changes |
| `git_push` / `git_pull` | Sync with remote |
| `git_clone` | Clone repositories |
| `git_diff` / `git_log` | Inspect history |

### `email`

AI-driven email management via the `himalaya` CLI.
> [!NOTE]
> Requires the `himalaya` CLI. If missing, Tamias will offer to install it for you during setup or via `tamias doctor`.

| Function | Description |
|---|---|
| `list_emails` | Fetch recent envelopes |
| `read_email` | Get full message content |
| `send_email` | Send to whitelisted recipients |

### `skills`

Manage and execute modular AI skill sets.

| Function | Description |
|---|---|
| `save_skill` | Create or update a skill (supports `tags` and `parent` for grouping) |
| `list_skills` | List all skills with their metadata, tags, and parent |
| `delete_skill` | Remove a skill by its folder name |

Skills that declare a `parent` folder are treated as sequential children of that parent — useful for orchestrated multi-step workflows.

### `image`

AI image generation. Requires at least one image model to be configured via `tamias model set-image`.

> [!NOTE]
> Supports OpenAI (`dall-e-3`, `dall-e-2`) and Google Imagen models. Use `tamias model set-image` to configure a priority list; Tamias will automatically fall back to the next model if one fails.

| Function | Description |
|---|---|
| `generate` | Generate an image from a text prompt and send it back to the channel |

### `firecrawl`

Scrape web pages with a **local Firecrawl** instance (`/v1/scrape`).

> [!NOTE]
> This tool is gated by config. Enable it in `~/.tamias/config.json`:
>
> ```json
> {
>   "firecrawl": {
>     "enabled": true,
>     "baseUrl": "http://localhost:3002",
>     "timeoutMs": 30000
>   }
> }
> ```

| Function | Description |
|---|---|
| `scrape` | POSTs `{ "url": "..." }` to `<baseUrl>/v1/scrape` and returns extracted content |

---

## Multi-Agent System

Tamias allows your primary AI to delegate complex or long-running tasks to specialized **sub-agents**. Each sub-agent runs in its own isolated session and reports back to the main chat automatically.

### Why use Sub-agents?

- **Isolation**: Prevent a complex task from bloating the main conversation history.
- **Specialization**: Use pre-defined **Agents (Personas)** for specific tasks (e.g., a "Researcher" or "Code Auditor").
- **Concurrency**: Let a worker handle a sub-task while you continue the main conversation.

### Agent Personas

You can define reusable "identities" via `tamias agents add`. These contain fixed instructions and model preferences.

- **Example**: A "Researcher" agent always uses a large-context model and has specific instructions to provide citations.

### Using Sub-agents in Chat

The AI can spawn a sub-agent using the `subagent__spawn` tool. You can also prompt it to do so:
> "Spawn a **Researcher** agent to read the documentation in `~/docs` and summarize the security section."

1. The main AI calls `subagent__spawn` with the task.
2. A sub-session is created (inheriting the "Researcher" persona if specified).
3. The sub-agent performs the task and produces a result.
4. Tamias **automatically injects** the sub-agent's final report back into your main conversation.

---

## Development

```bash
bun install          # Install dependencies
bun run build        # Compile standalone binary
bun run type-check   # Validate TypeScript
```

> All configuration is stored in `~/.tamias/config.json`.

Runtime logs are centralized under `~/.tamias/logs/` (for example `daemon.log`, `dashboard.log`, `cron.log`).

## Changelog

See the full [CHANGELOG.md](./CHANGELOG.md) for more details.

### Latest Version (v26.04.04.41)

### Features
- enhance WhatsAppUnofficialBridge with mention-only mode and regex support
- coding CLI delegation system
