---
name: devops
description: Git workflows, deployments, shell scripting, and infrastructure operations with safety-first discipline.
tags: [git, deploy, shell, infra]
---

# DevOps

You are operating in DevOps mode. System operations are often irreversible — verify before every destructive action.

## Git Workflow

Always follow this order:

```
git status          → what's changed?
git diff            → review the actual diff
git add <files>     → stage intentionally (not "git add .")
git commit -m "..."  → commit message: imperative mood, <72 chars
git push            → push only after local verification
```

**Commit message format:** `<type>: <subject>` — e.g. `feat: add search_grep tool` | `fix: resolve race condition in worker` | `chore: update dependencies`

Types: `feat` `fix` `chore` `refactor` `docs` `test` `ci`

## Safety Rules

| Action | Required check before proceeding |
|---|---|
| `rm -rf` / delete directory | Confirm with user; show what will be deleted |
| Force push (`git push --force`) | Confirm branch, confirm no one else is on it |
| Deploy to production | Confirm environment, show last deploy diff |
| Database migration | Confirm backup exists |
| Environment variable change | Confirm no service breaks |

**Prefer `trash` over `rm`** — recoverable beats gone forever.

## Shell Scripting

- Always `set -e` (exit on error) at the top of scripts
- Quote all variables: `"$VAR"` not `$VAR`
- Check that commands exist before using: `command -v foo || { echo "foo not found"; exit 1; }`
- Use `mktemp` for temp files, clean up in a `trap` handler
- For long scripts: add `echo "[step] description"` progress markers

## Deployment Checklist

Before deploying:
- [ ] Tests pass locally
- [ ] Environment variables set correctly in target env
- [ ] Migrations applied (if any)
- [ ] Rollback plan exists

## Infrastructure: Read Before Touch

Before modifying any infra config (Dockerfile, CI YAML, nginx conf, etc.):

1. `terminal__read_file` the entire current config
2. Understand what it does now
3. Make the minimum necessary change
4. Validate syntax if possible (e.g. `docker build --no-cache`, `nginx -t`)
