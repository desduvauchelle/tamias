# Efficient Agency & Token Optimization ⚡

Agentic AI can be expensive. Without careful management, an AI might enter an infinite loop of tool calls or spawn dozens of agents, consuming your token budget in minutes. Tamias is designed to prevent this "token sprawl."

## 1. The Power of Sub-agents
The `subagent__spawn` tool is a powerful way to delegate work without bloating the main conversation.

### When to spawn a sub-agent:
- **Complex Research**: "Find three different ways to implement a rate limiter in Bun."
- **File Processing**: "Refactor all files in `src/utils` to use the new logging service."
- **Isolated Debugging**: "Try to reproduce this error in a temporary folder."

### Benefits:
- **Clean Context**: The main chat session stays focused on the high-level goal.
- **Parallelism**: The daemon can manage sub-agents while you continue chatting.
- **Summarization**: When a sub-agent finishes, it provides a concise report. Only the report (not the entire sub-conversation) is injected into your main chat.

## 2. Preventing Token Abuse 🛑
Tamias includes built-in safeguards to protect your wallet:
- **Recursion Limits**: Sub-agents cannot infinitely spawn other sub-agents.
- **Max Iterations**: The daemon limits the number of tool calls an AI can make in a single "turn."
- **Token Budgeting**: (Coming Soon) Set hard limits on how many tokens a specific session or agent can use.

## 3. Model Specialization
Not every task needs the world's most powerful model.
- **Use Cheap Models** (e.g., GPT-4o-mini, Claude Haiku) for: Simple file reads, status checks, and data transformation.
- **Use Powerful Models** (e.g., GPT-4o, Claude Opus, Gemini 1.5 Pro) for: Complex architecture planning, difficult debugging, and sub-agent spawning.

You can configure agents with specific models via `tamias agents add`.

## 4. Prompt Engineering for Tools
To save tokens, the AI is instructed to be **concise**:
- **Specific Pathing**: Don't `list_dir` the whole root; go directly to the needed folder.
- **Chunked Reading**: Use `read_file` with specific line ranges if possible.
- **Batching**: Group multiple file changes into a single edit when appropriate.

---

### Best Practice
Before asking your AI to do something huge, ask yourself: *"Could this be a sub-agent task?"* If the answer is yes, you'll save context, tokens, and time.

---

### Next
- Visit the [Tool Guides](./tool-guides.md) for technical details on each tool.
- Go back to the [Home Page](./index.md).
