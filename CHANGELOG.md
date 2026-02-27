# Changelog

## [Unreleased]

### Features
- add comprehensive tests for channels API and Discord bridge modes
- implement progress update feature in DiscordBridge and enhance project context handling
- Enhance CLI documentation and add usage tracking
- ensure workspace directory exists before tests and streamline imports in sandbox tests
- implement Modal component and integrate it into various pages for improved UI
- add tool provider preference system and vector store implementation
- Enhance chat command with agent options and routing
- enhance memory management with structured templates and detailed responsibilities
- implement version bumping and enhance skills documentation
- refactor bot configuration to support multiple instances for Discord and Telegram
- implement sub-agent lifecycle management in AIService
- Enhance skills and usage pages with TypeScript types and error handling
- integrate caffeinate process management and add token command for dashboard access
- wrap HistoryContent in Suspense for improved loading state handling
- enhance browser tools with Playwright installation and management
- add UI and API for manual cron job testing with target selection
- introduce AI skill management, add browser command and tool, enhance AI request context, and improve terminal command auditing.
- Add image generation capabilities, subagent callback mechanism, and debug mode toggle.
- add support for photo and document attachments in Telegram bridge
- update version numbers and enhance logging and error handling in various components
- update version numbers and enhance workspace path handling for improved security and clarity
- enhance update command to support forced reinstallation and restart daemon after updates
- display version '1' next to TamiasOS in the navigation bar.
- allow bridge `onMessage` to return a boolean to prevent AI processing and enhance Discord typing indicator reliability.

### Bug Fixes
- update version display from '3' to 'i4' in the navigation component

### Maintenance
- bump version to 26.2.26.6 in package.json and dashboard package.json; update AGENTS.md formatting
- bump version to 26.2.25.7 in package.json files
- bump version to 26.2.25.5 in package.json files and improve code formatting
- bump version to 26.2.25.2 in package.json files
- bump tamias and dashboard package versions
- update package versions and standardize CI test command.
- Update CI workflow to run tests with `bun run test`.

### Documentation
- update README to reflect latest version and highlight new features

## [v2026.2.23.5] - 2026-02-23

### Features
- enhance email tool with auto-provisioning for Himalaya accounts, improve Discord message handling, and update CLI command structure

## [v2026.2.23.4] - 2026-02-23

### Features
- update cron job structure to support 'ai' and 'message' types, enhance cron management, and add tests for new functionality

## [v2026.2.23.3] - 2026-02-23

### Features
- introduce history page, enhance skills page UI with detailed explanations, and add version information to the dashboard status API.

## [v2026.2.23.1] - 2026-02-23

### Features
- Redefine email tool permissions logic and add a `restart` command for the daemon.

## [v2026.2.22.19] - 2026-02-22

### Features
- update Next.js standalone dashboard path, add email `canSend` permission, and introduce email tool tests

## [v2026.2.22.18] - 2026-02-22

### Bug Fixes
- update version to 2026.2.22.18
- enhance daemon and dashboard process termination logic
- update version to 2026.2.22.17 and add @openrouter/ai-sdk-provider dependency
- bun install --ignore-scripts in all ubuntu CI jobs
- use bun install --ignore-scripts in CI to avoid sharp/libvips build failure on ubuntu

## [v2026.2.22.16] - 2026-02-22

### Bug Fixes
- typecheck errors + kill all orphan daemons on stop + OpenRouter/Ollama compatibility mode (v2026.2.22.16)

## [v2026.2.22.14] - 2026-02-22

### Features
- verbose daemon logging + tamias logs command + tamias status diagnostics (v2026.2.22.15)

## [v2026.2.22.13] - 2026-02-22

### Features
- pre-build dashboard in CI + fix isCompiled binary update bug v2026.2.22.12

### Bug Fixes
- mkdir -p before copying static into standalone bundle v2026.2.22.13

## [v2026.2.22.11] - 2026-02-22

### Bug Fixes
- surface swallowed errors for fail-fast debugging
- heal stale session models directly in SQLite at startup

## [v2026.2.22.10] - 2026-02-22

### Bug Fixes
- VERSION now reads from package.json; heal stale session models at startup

## [v2026.2.22.9] - 2026-02-22

### Features
- update version to 2026.2.22.9 and enhance model fallback logic in AIService and config utilities

## [v2026.2.22.8] - 2026-02-22

### Features
- update version to 2026.2.22.8 and ensure TAMIAS_DIR is created before database initialization
- Update version to 2026.2.22.7 and refine session persistence logic in AIService
- Implement persistent AI model fallback, enhance README discovery, and improve dashboard update robustness with build error handling.

### Refactors
- Improve AI model fallback and cleanup logic for stale connections, centralize database directory path, and update version.

## [v2026.2.22.4] - 2026-02-22

### Features
- standardize default workspace path to ~/.tamias and update package version.
- enhance email account management with service selection and streamline onboarding workspace setup with an optional directory shortcut.

## [v2026.2.22.2] - 2026-02-22

### Features
- Introduce comprehensive changelog generation and display, alongside new documentation and environment path refactoring.

## [v2026.2.22.1] - 2026-02-22



## [v26.2.26.17] - 2026-02-26

### Bug Fixes
- update version display from '3' to 'i4' in the navigation component

## [v26.2.26.16] - 2026-02-26

### Features
- add comprehensive tests for channels API and Discord bridge modes

## [v26.2.26.15] - 2026-02-26

### Features
- implement progress update feature in DiscordBridge and enhance project context handling
- Enhance CLI documentation and add usage tracking

## [v26.2.26.11] - 2026-02-26

### Features
- ensure workspace directory exists before tests and streamline imports in sandbox tests
- implement Modal component and integrate it into various pages for improved UI
- add tool provider preference system and vector store implementation

## [v26.2.26.7] - 2026-02-26

### Features
- Enhance chat command with agent options and routing

### Maintenance
- bump version to 26.2.26.6 in package.json and dashboard package.json; update AGENTS.md formatting

## [v26.2.26.3] - 2026-02-26

### Features
- enhance memory management with structured templates and detailed responsibilities

## [v26.2.26.2] - 2026-02-26

### Features
- implement version bumping and enhance skills documentation

## [v26.2.25.7] - 2026-02-25

### Features
- refactor bot configuration to support multiple instances for Discord and Telegram

### Maintenance
- bump version to 26.2.25.7 in package.json files

## [v26.2.25.5] - 2026-02-25

### Features
- implement sub-agent lifecycle management in AIService
- Enhance skills and usage pages with TypeScript types and error handling

### Maintenance
- bump version to 26.2.25.5 in package.json files and improve code formatting

## [v26.2.25.3] - 2026-02-25

### Features
- integrate caffeinate process management and add token command for dashboard access

## [v26.2.25.2] - 2026-02-25

### Features
- wrap HistoryContent in Suspense for improved loading state handling
- enhance browser tools with Playwright installation and management
- add UI and API for manual cron job testing with target selection
- introduce AI skill management, add browser command and tool, enhance AI request context, and improve terminal command auditing.
- Add image generation capabilities, subagent callback mechanism, and debug mode toggle.

### Maintenance
- bump version to 26.2.25.2 in package.json files
- bump tamias and dashboard package versions

## [v26.2.23.9] - 2026-02-23

### Features
- add support for photo and document attachments in Telegram bridge
- update version numbers and enhance logging and error handling in various components

### Documentation
- update README to reflect latest version and highlight new features

## [v26.2.23.7] - 2026-02-23

### Features
- update version numbers and enhance workspace path handling for improved security and clarity
- enhance update command to support forced reinstallation and restart daemon after updates

## [v26.2.23.6] - 2026-02-23

### Features
- display version '1' next to TamiasOS in the navigation bar.
- allow bridge `onMessage` to return a boolean to prevent AI processing and enhance Discord typing indicator reliability.
- enhance email tool with auto-provisioning for Himalaya accounts, improve Discord message handling, and update CLI command structure
- update cron job structure to support 'ai' and 'message' types, enhance cron management, and add tests for new functionality
- introduce history page, enhance skills page UI with detailed explanations, and add version information to the dashboard status API.
- Redefine email tool permissions logic and add a `restart` command for the daemon.
- update Next.js standalone dashboard path, add email `canSend` permission, and introduce email tool tests
- verbose daemon logging + tamias logs command + tamias status diagnostics (v2026.2.22.15)
- pre-build dashboard in CI + fix isCompiled binary update bug v2026.2.22.12
- update version to 2026.2.22.9 and enhance model fallback logic in AIService and config utilities
- update version to 2026.2.22.8 and ensure TAMIAS_DIR is created before database initialization
- Update version to 2026.2.22.7 and refine session persistence logic in AIService
- Implement persistent AI model fallback, enhance README discovery, and improve dashboard update robustness with build error handling.
- standardize default workspace path to ~/.tamias and update package version.
- enhance email account management with service selection and streamline onboarding workspace setup with an optional directory shortcut.
- Introduce comprehensive changelog generation and display, alongside new documentation and environment path refactoring.
- Implement AI model fallback and priority selection, alongside a new robust update mechanism.

### Bug Fixes
- update version to 2026.2.22.18
- enhance daemon and dashboard process termination logic
- update version to 2026.2.22.17 and add @openrouter/ai-sdk-provider dependency
- bun install --ignore-scripts in all ubuntu CI jobs
- use bun install --ignore-scripts in CI to avoid sharp/libvips build failure on ubuntu
- typecheck errors + kill all orphan daemons on stop + OpenRouter/Ollama compatibility mode (v2026.2.22.16)
- mkdir -p before copying static into standalone bundle v2026.2.22.13
- surface swallowed errors for fail-fast debugging
- heal stale session models directly in SQLite at startup
- VERSION now reads from package.json; heal stale session models at startup

### Refactors
- Improve AI model fallback and cleanup logic for stale connections, centralize database directory path, and update version.

### Maintenance
- update package versions and standardize CI test command.
- Update CI workflow to run tests with `bun run test`.

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
