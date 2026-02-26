# How to Write a Skill

Skills live at `~/.tamias/skills/<folder-name>/SKILL.md`.

## Creating a Skill

**Via tool (preferred in-session):**
`tamias__save_skill` — pass name, description, content, and optionally tags, parent, model.

**Via CLI:**
```bash
tamias skills add                          # interactive prompts
tamias skills add -n "Name" -d "desc" -c "content"
tamias skills add -n "Name" -d "desc" -c "content" -t "tag1,tag2" -p "parent-folder" -m "xai/grok-3"
tamias skills list                         # list all skills
tamias skills rm <folder-name>             # delete a skill
```

## Frontmatter Fields

```yaml
---
name: "My Skill Name"             # human-readable display name
description: "Use this when..."   # TRIGGER PHRASE — see below
model: "xai/grok-3"               # optional preferred model for sub-agents
tags: ["tag1", "tag2"]            # optional, for grouping/filtering
parent: "orchestrator-folder"     # optional, marks this as a child step
---
```

## The One Rule That Matters Most

The `description` is the **only** thing visible in the system prompt before the AI decides whether to read the full skill. Write it as a trigger phrase, not a title.

- ❌ `"Investment research skill using Grok and web tools"` — describes implementation
- ✅ `"Use this when the user asks to research stocks, run investment analysis, or evaluate companies"` — tells the AI *when* to reach for it

## Suggested SKILL.md Structure

This is a guide, not a rule. Adapt to the skill's needs.

```markdown
---
name: "My Skill Name"
description: "Use this when the user asks to [specific trigger scenario]."
tags: ["tag1", "tag2"]
---

# My Skill Name

## Purpose
One sentence: what problem does this solve?

## When to Use
- Specific trigger 1
- Specific trigger 2

## Input
What input does this skill expect? Format, examples, where it comes from.

## Steps
1. Step one — what to do, which tools to use
2. Step two — ...

## Output
What should the final output look like? Format, file location, channel to post to.

## Tools Needed
List which tool groups this skill relies on (e.g., workspace, browser, subagent).

## Notes
Edge cases, gotchas, preferences the user has expressed about this skill.
```

## Multi-Step / Agentic Skills

For workflows with multiple steps (like `investment-master-research`):

- Create one **orchestrator** skill that defines the sequence and spawns sub-agents sequentially (not in parallel — steps often depend on prior output).
- Create each step as a **child** skill with `parent: "orchestrator-folder-name"`.
- Child descriptions should say: `"Step N of [orchestrator]: [what this step does]"`.
- Each step should read its input from a JSON file written by the previous step, and write its output to a new JSON file.
- Use a unique per-run folder (e.g., `runs/YYYY-MM-DD-N/`) to keep runs isolated.
