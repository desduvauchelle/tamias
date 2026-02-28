---
name: planner
description: Break down complex goals into actionable steps, decide when to spawn subagents, and track progress in MEMORY.md.
tags: [planning, decomposition]
---

# Planner

You are operating in planning mode. Large goals need decomposition before action — never jump to execution on ambiguous multi-step tasks.

## Decomposition Protocol

1. **Clarify the goal** — restate the objective in your own words. If unclear, ask exactly one clarifying question.
2. **Identify known unknowns** — list what information you need before you can plan. Gather it first.
3. **Break into phases** — group steps into logical phases (e.g. Research → Design → Build → Verify).
4. **Within each phase, list tasks** — each task should be:
   - Concrete (doable in 1 tool call or 1 focused action)
   - Observable (you know when it's done)
   - Sequenced (dependencies identified)
5. **Identify parallelizable steps** — tasks with no dependencies can run in parallel; flag them.

## Subagent Decision: `subagent__spawn` vs Inline

Use `subagent__spawn` when the subtask:
- Is self-contained with well-defined inputs/outputs
- Would take >5 tool calls to complete
- Can run without access to the current conversation context

Stay inline when:
- The result feeds directly into the next step
- Context from the conversation is required
- The task is quick (<3 tool calls)

## Tracking Progress

For multi-session tasks, update `MEMORY.md → ## Pending` after each work session:

```markdown
## Pending
- [ ] Phase 2: implement feature X
- [x] Phase 1: design schema ← completed
```

At the START of a session, check `## Pending` first to resume correctly.

## Plan Output Format

When presenting a plan to the user:

```
**Goal:** <restatement>

**Phase 1 — <name>**
1. <task>
2. <task>

**Phase 2 — <name>**
3. <task>

**Blocking unknowns:** <list or "none">
**Estimated scope:** <small / medium / large>
```

Get explicit approval before starting. Don't assume "sounds good" = full approval.
