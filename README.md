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
| `tamias cron add` | Add a new cron job (`-n, --name <name>`, `-s, --schedule <schedule>`, `-p, --prompt <prompt>`, `-t, --target <target>`, `--heartbeat`) |
| `tamias cron rm <id>` | Remove a cron job by ID |
| `tamias cron edit <id>` | Edit an existing cron job (`-n, --name <name>`, `-s, --schedule <schedule>`, `-p, --prompt <prompt>`, `-t, --target <target>`, `--disable`, `--enable`) |

### `tamias agents`

Manage reusable agent identities (personas) for sub-agents

| Command | Description |
|---|---|
| `tamias agents` | Manage reusable agent identities (personas) for sub-agents |
| `tamias agents list` | List all registered agents |
| `tamias agents add` | Register a new reusable agent (`-n, --name <name>`, `-s, --slug <slug>`, `-m, --model <model>`, `-i, --instructions <instructions>`, `-c, --channels <channels>`, `-x, --extra-skills <skills>`) |
| `tamias agents rm <id>` | Remove an agent definition by ID |
| `tamias agents edit <id>` | Edit an existing agent definition (`-n, --name <name>`, `-m, --model <model>`, `-i, --instructions <instructions>`) |
| `tamias agents show <query>` | Show details and persona dir for an agent (by id, slug, or name) |
| `tamias agents chat <query>` | Chat interactively with a named agent (by id, slug, or name) |

### `tamias config`

Manage configuration (add provider, show, path)

| Command | Description |
|---|---|
| `tamias config` | Manage configuration (add provider, show, path) |
| `tamias config show` | Display current configuration summary (`--json`) |
| `tamias config path` | Print the config file path |

### `tamias setup`

Interactive setup wizard (providers, model, channels, identity)

| Command | Description |
|---|---|
| `tamias setup` | Interactive setup wizard (providers, model, channels, identity) |

### `tamias chat`

Launch an interactive AI chat session (connects to daemon, auto-starts if needed)

| Command | Description |
|---|---|
| `tamias chat` | Launch an interactive AI chat session (connects to daemon, auto-starts if needed) |

### `tamias start`

Start the Tamias daemon (central AI brain)

| Command | Description |
|---|---|
| `tamias start` | Start the Tamias daemon (central AI brain) (`--daemon`, `--verbose`) |

### `tamias history`

View and follow the daemon log (~/.tamias/daemon.log)

| Command | Description |
|---|---|
| `tamias history` | View and follow the daemon log (~/.tamias/daemon.log) (`-n, --lines <n>`, `--no-follow`, `--clear`) |

### `tamias stop`

Stop the running Tamias daemon

| Command | Description |
|---|---|
| `tamias stop` | Stop the running Tamias daemon |

### `tamias restart`

Restart the running Tamias daemon

| Command | Description |
|---|---|
| `tamias restart` | Restart the running Tamias daemon (`--verbose`) |

### `tamias status`

Show daemon status and active sessions

| Command | Description |
|---|---|
| `tamias status` | Show daemon status and active sessions |

### `tamias usage`

Display aggregated AI request usage and stats

| Command | Description |
|---|---|
| `tamias usage [period]` | Display aggregated AI request usage and stats |

### `tamias model`

View or set the default AI model

| Command | Description |
|---|---|
| `tamias model` | View or set the default AI model |
| `tamias model set` | Interactively set the default model |
| `tamias model set-image` | Interactively set the default image model priority |

### `tamias onboarding`

Re-run the first-run onboarding (reset identity and persona)

| Command | Description |
|---|---|
| `tamias onboarding` | Re-run the first-run onboarding (reset identity and persona) |

### `tamias update`

Check for and install updates for Tamias

| Command | Description |
|---|---|
| `tamias update` | Check for and install updates for Tamias |

### `tamias models`

Manage model configurations (list, add, edit, delete)

| Command | Description |
|---|---|
| `tamias models` | Manage model configurations (list, add, edit, delete) |
| `tamias models list` | List all configured models |
| `tamias models add` | Add a new model config (alias for `tamias config`) |
| `tamias models edit [nickname]` | Edit an existing model config (nickname or models) |
| `tamias models delete [nickname]` | Delete a model config |

### `tamias tools`

Manage internal tools and external MCP servers

| Command | Description |
|---|---|
| `tamias tools` | Manage internal tools and external MCP servers |
| `tamias tools list` | List all tools and external MCPs with their status |
| `tamias tools add-mcp` | Add an external MCP server connection |
| `tamias tools enable [name]` | Enable a tool or MCP |
| `tamias tools disable [name]` | Disable a tool or MCP |
| `tamias tools edit [name]` | Configure functions and allowlists for a tool or MCP |
| `tamias tools remove-mcp [name]` | Remove an external MCP server |

### `tamias channels`

Manage gateway channels (Discord, Telegram, etc.)

| Command | Description |
|---|---|
| `tamias channels` | Manage gateway channels (Discord, Telegram, etc.) |
| `tamias channels list` | List configured communication channels |
| `tamias channels add` | Connect a new communication channel |
| `tamias channels edit` | Edit an existing channel (tokens, allowed IDs) |
| `tamias channels remove [platform]` | Remove a channel configuration |

### `tamias emails`

Manage email accounts for the email MCP tool

| Command | Description |
|---|---|
| `tamias emails` | Manage email accounts for the email MCP tool |
| `tamias emails list` | List configured email accounts |
| `tamias emails add` | Add a new email account |
| `tamias emails edit [nickname]` | Edit an existing email account |
| `tamias emails delete [nickname]` | Delete an email account |

### `tamias workspace`

View or set the restricted workspace directory for the AI

| Command | Description |
|---|---|
| `tamias workspace [path]` | View or set the restricted workspace directory for the AI |

### `tamias debug`

Toggle debug mode (adds metadata to messages and shows tool calls in CLI)

| Command | Description |
|---|---|
| `tamias debug` | Toggle debug mode (adds metadata to messages and shows tool calls in CLI) |

### `tamias skills`

Manage custom AI skills and capabilities

| Command | Description |
|---|---|
| `tamias skills` | Manage custom AI skills and capabilities |
| `tamias skills list` | List all available skills (built-in and user-defined) |
| `tamias skills add` | Add or update a custom skill (`-n, --name <name>`, `-d, --description <desc>`, `-c, --content <content>`, `-t, --tags <tags>`, `-p, --parent <parent>`, `-m, --model <model>`) |
| `tamias skills rm <folder>` | Remove a custom skill by its folder name |

### `tamias browser`

Open a visible browser window for manual login (persists to ~/.tamias/browser-data)

| Command | Description |
|---|---|
| `tamias browser` | Open a visible browser window for manual login (persists to ~/.tamias/browser-data) |

### `tamias uninstall`

Completely remove Tamias and its data

| Command | Description |
|---|---|
| `tamias uninstall` | Completely remove Tamias and its data |

### `tamias backup`

Create a backup of Tamias configuration and logs

| Command | Description |
|---|---|
| `tamias backup` | Create a backup of Tamias configuration and logs (`-f, --file <path>`) |

### `tamias restore`

Restore Tamias configuration and logs from a backup

| Command | Description |
|---|---|
| `tamias restore <file>` | Restore Tamias configuration and logs from a backup |

### `tamias readme`

View the Tamias README.md with terminal formatting

| Command | Description |
|---|---|
| `tamias readme` | View the Tamias README.md with terminal formatting |

### `tamias doctor`

Check and fix system dependencies, health checks, and configuration

| Command | Description |
|---|---|
| `tamias doctor` | Check and fix system dependencies, health checks, and configuration (`--fix`, `--json`) |

### `tamias docs`

Generate documentation files

| Command | Description |
|---|---|
| `tamias docs` | Generate documentation files (`-o, --output <dir>`) |

### `tamias migrate`

Manage schema and filesystem migrations

| Command | Description |
|---|---|
| `tamias migrate` | Manage schema and filesystem migrations |
| `tamias migrate status` | Show current migration state |
| `tamias migrate run` | Apply pending migrations (`--dry-run`, `--tenant <id>`) |

### `tamias project`

Manage project memory and context

| Command | Description |
|---|---|
| `tamias project` | Manage project memory and context |
| `tamias project list` | List all projects |
| `tamias project create [name]` | Create a new project |
| `tamias project show [slug]` | Show project details |
| `tamias project archive [slug]` | Archive a project |

### `tamias tenant`

Manage multi-tenant environments

| Command | Description |
|---|---|
| `tamias tenant` | Manage multi-tenant environments |
| `tamias tenant list` | List all tenants |
| `tamias tenant create [name]` | Create a new tenant |
| `tamias tenant delete [id]` | Delete a tenant |
| `tamias tenant switch [id]` | Switch active tenant |

### `tamias token`

Show the dashboard authentication token and URL. The token persists across restarts.

| Command | Description |
|---|---|
| `tamias token` | Show the dashboard authentication token and URL. The token persists across restarts. (`--reset`) |

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

## Changelog

See the full [CHANGELOG.md](./CHANGELOG.md) for more details.

### Latest Version (v2026.2.23.5)

### Features
- enhance email tool with auto-provisioning for Himalaya accounts, improve Discord message handling, and update CLI command structure
