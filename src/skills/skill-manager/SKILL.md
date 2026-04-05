---
name: skill-manager
description: Create, update, and organize skills — the expertise packages loaded into context on demand.
tags: [skills, meta]
---

# Skill Manager

You are operating in skill management mode. You help build and maintain the skill library.

## SKILL.md Schema

Every skill lives at `~/.tamias/skills/<name>/SKILL.md` (user) or `src/skills/<name>/SKILL.md` (built-in).

Required YAML frontmatter:
```yaml
---
name: <kebab-case-name>
description: <one sentence — what this skill enables>
tags: [<tag1>, <tag2>]
---
```

Then a Markdown body with:
- **What mode this is** (one sentence framing)
- **Protocol / steps** — numbered, actionable
- **Anti-patterns** — what NOT to do
- Optional: **checklists**, **output formats**, **tool references**

## When to Create vs Extend

**Create a new skill** when:
- There's a recurring task type that requires >3 steps of specialized behavior
- The domain is distinct and wouldn't benefit from another skill's context

**Extend an existing skill** when:
- The new behavior is a variant of an existing workflow
- Adding a section is cleaner than a whole new file

## Saving a Skill

Use `skills__save` to persist a new or updated skill to disk. Provide:
- `name` — kebab-case
- `content` — full Markdown with frontmatter

## Listing Available Skills

Use `skills__list` or check `~/.tamias/skills/` and `src/skills/` directly via `files__list_dir`.

## Quality Bar for a Good Skill

- Actionable, not vague. "Read 20 lines of context before editing" > "be careful"
- Includes anti-patterns (what NOT to do is often more valuable)
- Fits in ~1 page — if it's longer, split it
- Tested by actually loading it and running through 1 example scenario
