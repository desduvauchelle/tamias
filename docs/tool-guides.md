# Tool Guides 🛠️

Tools are the hands of the AI. Tamias provides a set of highly specific tools designed for computer interaction.

---

## 💻 Terminal Tool
The most versatile tool in the arsenal. It allows the AI to interact with your system directly.

| Function | Primary Use Case |
|---|---|
| `run_command` | Spawning processes, installing dependencies, running tests. |
| `read_file` | Reading source code, logs, or configuration files. |
| `write_file` | Creating new files (e.g., a new component or script). |
| `edit_file` | Making targeted changes to existing large files without rewriting them entirely. |
| `list_dir` | Exploring the project structure. |

> [!TIP]
> Use `edit_file` instead of `write_file` for large files to save significant token costs and reduce the risk of overwriting critical logic.

---

## 🐙 GitHub Tool
A specialized tool for managing Git repositories. It handles the "Git workflow" so you don't have to.

| Function | Description |
|---|---|
| `git_status` | Returns the current state of the repo (staged vs unstaged). |
| `git_add` | Stages changes for commit. |
| `git_commit` | Creates a commit with the provided message. |
| `git_push` | Pushes local commits to the remote origin. |
| `git_pull` | Fetches and merges changes from the remote. |
| `git_clone` | Clones a repository into a local directory. |

---

## ✉️ Email Tool
Managed via the `himalaya` CLI, this tool allows the AI to be your gatekeeper.

- **Inbox Management**: Summarize long email threads.
- **Drafting and Sending**: Draft replies or send status updates to a whitelist of recipients.
- **Security Note**: To protect against "Prompt Injection via Email," the AI will never automatically execute commands found in an email body. It can only report them to you.

---

## 🐿️ Sub-agent Tool
The `subagent__spawn` tool is how Tamias orchestrates multiple brains.

- **Task**: A clear, actionable description of what the sub-agent should do.
- **Persona**: (Optional) Use a pre-defined agent like "Code Auditor" or "Expert Researcher."
- **Return**: The sub-agent will return a `report` that summarizes its work.

---

### Custom MCP Tools
Tamias supports the **Model Context Protocol**. If you have an MCP server running (e.g., a Google Drive connector), Tamias will automatically discover its tools and expose them to the AI.

To add an MCP server, use the `tamias config` command.

---

[Back to Home](./index.md)
