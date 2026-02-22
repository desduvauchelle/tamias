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
