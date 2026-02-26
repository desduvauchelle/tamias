# Skills Guide 🐿️

Skills are one of Tamias's most powerful features. They allow you to define modular, reusable instruction sets that the AI can "load" into its context.

## What is a Skill?

A skill is simply a folder containing a `SKILL.md` file.
- **Location**: `~/.tamias/skills/<skill-folder>/SKILL.md`
- **Structure**: YAML frontmatter + Markdown content.

## Why use Skills?

- **Coding Standards**: Give the AI your specific linting and style rules.
- **Internal Knowledge**: Load documentation for internal packages or APIs.
- **Workflows**: Break down complex tasks into manageable, multi-step sequences using the `parent` field.

## Management via CLI

### listing Skills
To see what skills you have (both built-in and custom):
```bash
tamias skills list
```

### Adding a Skill
The easiest way is interactive:
```bash
tamias skills add
```

Or via flags:
```bash
tamias skills add --name "My Skill" --description "Short desc" --content "Long instructions"
```

### Removing a Skill
Use the folder name (the one shown in `tamias skills list`):
```bash
tamias skills rm my-skill
```

## Advanced Features

### Tags
Tags help you organize skills in the Dashboard.
```bash
tamias skills add --name "Market Research" --tags "finance,research"
```

### Parent/Child Hierarchy
You can group related skills together by specifying a `parent` folder.
In the Dashboard, these will be nested, allowing for complex multi-step "Orchestrator" flows where a parent skill delegates parts of the work to child skills.

---

[Back to Clinical Reference](../README.md#cli-reference)
