# Safety & Security 🛡️

Safety is the cornerstone of Tamias. We believe that granting an AI access to your computer should be a controlled and transparent process.

## 1. Workspace Isolation
By default, Tamias encourages the use of a **restricted workspace**.
- **The `workspace` tool**: This tool is designed to only allow file operations (read, write, list) within a specific directory.
- **Path Validation**: Any attempt to use ".." or absolute paths outside the designated workspace is blocked by the daemon before the tool is even executed.
- **Configurable Paths**: You can set your workspace using `tamias workspace [path]`.

## 2. Command Sanitization & Blacklists
The `terminal` tool provides full shell access, but it's not unfiltered.
- **Keyword Blocking**: We block common destructive commands and flags (e.g., `rm -rf /`) to prevent accidental or malicious system damage.
- **Shell Escaping**: All inputs are properly escaped to prevent shell injection attacks.

## 3. Human-in-the-Loop 👥
Tamias keeps you in control:
- **Dashboard Monitoring**: The web dashboard provides a live stream of all AI activities.
- **Terminal Output**: When the AI runs a command, the output is printed to your terminal in real-time.
- **Sensitive Tool Flags**: Certain tools or commands can be configured to require explicit human approval before execution.

## 4. API & Daemon Security
- **Local-Only by Default**: The Tamias daemon runs locally. By default, it is not exposed to the public internet.
- **Token Storage**: All AI provider tokens are stored in your local `~/.tamias/config.json` and are NEVER sent to any external server other than the AI providers themselves.

## 5. Sub-agent Sandboxing
When a sub-agent is spawned, it inherits the security constraints of the main session but runs in an isolated context. This prevents a sub-agent from "polluting" the main session's history or state while still operating within the same safety boundaries.

---

### Key Takeaway
Tamias is designed to be a **trusted steward**. Use the workspace restrictions and keep an eye on the dashboard to ensure your AI assistant is working exactly as you intended.

---

### Next
- Learn about [Efficient Agency](./efficient-agency.md) to save on token costs.
- Explore the [Tool Guides](./tool-guides.md).
