# Introduction to Tamias 🐿️

Tamias is an agentic AI interface designed to turn your terminal into an intelligent assistant. While many AI tools exist, Tamias is built specifically for users who want to safely grant AI access to their filesystem, developer tools, and communication channels.

## What makes Tamias special?

### Client-Daemon Architecture
Tamias isn't just a simple script. It consists of a **Daemon** and a **Client**:
- **The Daemon**: A persistent background process that maintains chat sessions, manages the tool registry, and provides a unified API.
- **The Client**: The CLI window you interact with, which communicates with the daemon via REST/WebSockets.

This separation allows for:
- Concurrent chat sessions.
- A beautiful web Dashboard served by the daemon.
- Persistent state across different terminal windows.

### Built-in Agentic Tools
Tamias comes pre-loaded with tools that are "vetted" for safe terminal interaction:
- **Terminal**: Read/Write files, run commands, and explore directories.
- **GitHub**: Commit, push, pull, and clone repositories natively.
- **Email**: Send and receive emails using the `himalaya` CLI.

### MCP (Model Context Protocol) Support
Easily extend Tamias with any standard MCP server. Whether you need Google Drive integration, Notion access, or custom internal tools, Tamias can plug into them without additional code.

## The Goal
The goal of Tamias is to provide a **safe** and **efficient** way to use AI as a collaborator on your local machine. We believe that by giving AI the right tools and the right constraints, it can handle the "heavy lifting" of repetitive tasks while you focus on the creative decisions.

---

### Next Steps
- Learn how we keep your machine safe in [Safety & Security](./safety.md).
- Ready to see how sub-agents work? Check out [Efficient Agency](./efficient-agency.md).
