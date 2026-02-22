# Changelog

## [v2026.2.22.1] - 2026-02-22

### Features
- Implement AI model fallback and priority selection, alongside a new robust update mechanism.

## [v1.0.19] - 2026-02-21

### Maintenance
- Update `useChat` prop from `initialMessages` to `messages`, rename `type-check` script, and bump package version.

## [v1.0.18] - 2026-02-21

### Features
- Implement attachment handling in AI service, add dynamic routing to dashboard APIs, introduce a documentation page, and update session history retrieval.

### Refactors
- Update API route JSON responses and add confirmation dialog for cron job deletion.

### Maintenance
- bump package version to 1.0.17

## [v1.0.16] - 2026-02-21

### Features
- centralize version management, enable dashboard email account configuration, and improve update process robustness.

## [v1.0.14] - 2026-02-21

### Features
- add 'tamias doctor' command to check and fix system dependencies
- enhance tool selection and configuration UI

## [v1.0.13] - 2026-02-21

### Other Changes
- v1.0.13: add Discord/bridge debug logging, surface connection errors

## [v1.0.12] - 2026-02-21

### Features
- Remove outdated README and script files for SEO audit skill
- Enhance onboarding and installation scripts with symlink for convenience
- Add multi-agent support with agent management commands and enhance onboarding process

### Bug Fixes
- exclude src/dashboard from root tsconfig — has its own tsconfig + deps

### Other Changes
- v1.0.12: re-trigger release after CI fix
- v1.0.11: add dashboard source to git, fix onboarding storage prompt, fix dashboard path detection

## [v1.0.10] - 2026-02-21

### Maintenance
- Update version to 1.0.10 and enhance installation script with improved prompts and error handling

## [v1.0.9] - 2026-02-21

### Maintenance
- Bump version to 1.0.9 and add CI onboarding support for non-interactive mode

## [v1.0.8] - 2026-02-21

### Maintenance
- Update version to 1.0.8 and adjust imports in config tests
- Add CI workflow and enhance onboarding process with channel setup

## [v1.0.7] - 2026-02-21

### Maintenance
- Add dashboard dependencies and build artifacts.

## [v1.0.6] - 2026-02-21

### Maintenance
- add new project dependencies and build artifacts.

## [v1.0.5] - 2026-02-21

### Maintenance
- Add dashboard dependencies and build artifacts.

## [v1.0.4] - 2026-02-21

### Maintenance
- Install dashboard dependencies and update Next.js configuration.

## [v1.0.3] - 2026-02-20

### Features
- Add project dependencies, build artifacts, and a new audio asset.
- Add `--heartbeat` option to `cron add` command for quick setup of the default heartbeat job.
- implement cron job management and refactor AI engine into a dedicated service.

### Maintenance
- add dashboard dependencies and generated build artifacts.
- Add new project dependencies and build outputs for the dashboard.
- Install project dependencies and generate build artifacts.

## [v1.0.2] - 2026-02-20

### Features
- Introduce core AI daemon service for managing sessions and model interactions, alongside new cron utilities.
- dynamically tag releases with the package version.
- Add manual trigger and restrict push-based releases to main branch and package.json changes.
- Implement self-update command, daemon auto-update, and GitHub Actions release workflow with bridge notifications.
- Implement secure environment variable management for API keys and add Ollama provider support
- implement functional Discord and Telegram bridges and add their setup instructions.
- introduce a new bridge system with Discord and Telegram channels, implement logging and pricing utilities, and add corresponding commands.
- Implement session management with disk persistence, conversation summarization, and dynamic persona updates.
- Introduce AI memory management and onboarding, and establish a client-daemon architecture.
- Implement daemon, tool, model, and session management with new commands, utilities, and a self-management tool.

### Maintenance
- bump package version to 1.0.1

### Other Changes
- first commit
