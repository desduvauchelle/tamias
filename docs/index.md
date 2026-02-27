# Tamias: The Secure AI Steward 🐿️

Welcome to the **Tamias Learning Pages**. Tamias is more than just a chat interface; it's a bridge between powerful AI models and your local environment, designed with a focus on **Safety**, **Transparency**, and **Efficiency**.

## Our Philosophy

Tamias is built on three core pillars:

### 1. Safety First 🛡️

AI should never have "carte blanche" on your machine. Tamias implements multiple layers of protection:

- **Workspace Isolation**: Restrict the AI to specific directories.
- **Human-in-the-loop**: Monitoring and approval for sensitive tools.
- **Command Sanitization**: Built-in protection against destructive shell patterns.

[Learn more about our Safety approach →](./safety.md)

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

### 2. Transparent Agency 🔍

You should always know what your AI is doing.

- **Real-time Logs**: Every command, file read, and network request is visible.
- **Tool Traceability**: See exactly which tool was called and why.
- **Daemon-Client separation**: Centralized management through a background daemon.

[Read the Introduction to Tamias Architecture →](./introduction.md)

### 3. Efficient Autonomy ⚡

Running multiple agents can quickly become a "token black hole." Tamias is optimized for efficiency:

- **Specialized Sub-agents**: Delegate specific tasks instead of bloating the main context.
- **Token-Aware Tooling**: Tools are designed to be concise and relevant.
- **Agent Lifecycle Management**: Prevent recursive or infinite agent loops.

[Discover how to build Efficient AI Workflows →](./efficient-agency.md)

---

## 📚 Documentation Index

- **[Introduction](./introduction.md)**: What is Tamias and how does it work?
- **[Safety & Security](./safety.md)**: How we keep your machine safe.
- **[Efficient Agency](./efficient-agency.md)**: Optimizing token usage and sub-agents.
- **[Tool Guides](./tool-guides.md)**: Deep dive into Terminal, GitHub, and Email tools.

---

> "A ταμίας (tamíās) is a steward — someone who manages and protects your resources with care."
