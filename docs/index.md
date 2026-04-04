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
| `tamias cron add` | Add a new cron job (`-n, --name <name>`, `-s, --schedule <schedule>`, `-p, --prompt <prompt>`, `-T, --type <type>`, `--skills <skills>`, `--session-key <key>`, `--context <context>`, `--target-channel <target>`, `--target-email <email>`, `--target-file <path>`, `-t, --target <target>`, `--heartbeat`) |
| `tamias cron rm <id>` | Remove a cron job by ID |
| `tamias cron edit <id>` | Edit an existing cron job (`-n, --name <name>`, `-s, --schedule <schedule>`, `-p, --prompt <prompt>`, `-T, --type <type>`, `--skills <skills>`, `--session-key <key>`, `--context <context>`, `-t, --target <target>`, `--disable`, `--enable`) |
| `tamias cron run` | Run all due cron jobs (called by system crontab every minute) (`--job <id>`, `--dry-run`) |
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
| `tamias start` | Start the Tamias daemon (central AI brain) (`--daemon`, `--verbose`) |

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
