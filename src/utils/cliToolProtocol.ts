export type ToolSyncMode = 'required' | 'optional' | 'none'

export interface CliToolProtocolEntry {
	command: string
	mode: ToolSyncMode
	toolNamespaces: string[]
	reason: string
}

/**
 * Single source of truth for top-level CLI ↔ AI tool sync expectations.
 *
 * Rules:
 * - required: command MUST have one or more mirrored AI tool namespaces.
 * - optional: command may be partly mirrored in AI tools.
 * - none: command is intentionally CLI-only.
 */
export const CLI_TOOL_PROTOCOL: CliToolProtocolEntry[] = [
	{ command: 'agents', mode: 'required', toolNamespaces: ['agents'], reason: 'Persistent agent lifecycle must be AI-callable.' },
	{ command: 'tools', mode: 'required', toolNamespaces: ['config'], reason: 'Tool and MCP management is exposed via config tools.' },
	{ command: 'channels', mode: 'optional', toolNamespaces: ['channels'], reason: 'Channel configuration is exposed via channels tools.' },
	{ command: 'emails', mode: 'optional', toolNamespaces: ['config', 'email'], reason: 'Email account config is in config; send/read operations are email tool.' },
	{ command: 'model', mode: 'optional', toolNamespaces: ['config'], reason: 'Default model operations are mirrored through config tools.' },
	{ command: 'models', mode: 'optional', toolNamespaces: ['config'], reason: 'Model listing and defaults are mirrored through config tools.' },
	{ command: 'config', mode: 'optional', toolNamespaces: ['config'], reason: 'Configuration actions are mirrored through config tools.' },
	{ command: 'workspace', mode: 'optional', toolNamespaces: ['files'], reason: 'Workspace settings and file actions are in the files namespace.' },
	{ command: 'status', mode: 'optional', toolNamespaces: ['daemon'], reason: 'Daemon/session status can be queried via daemon tools.' },
	{ command: 'stop', mode: 'optional', toolNamespaces: ['daemon'], reason: 'Daemon stop is mirrored via daemon tools.' },
	{ command: 'start', mode: 'none', toolNamespaces: [], reason: 'Daemon boot command remains CLI-first.' },
	{ command: 'restart', mode: 'none', toolNamespaces: [], reason: 'Restart flow is operational and intentionally CLI-first.' },
	{ command: 'history', mode: 'none', toolNamespaces: [], reason: 'Log tail/follow operations are intentionally CLI-focused.' },
	{ command: 'usage', mode: 'none', toolNamespaces: [], reason: 'Usage reporting is currently CLI-only.' },
	{ command: 'setup', mode: 'none', toolNamespaces: [], reason: 'Interactive onboarding wizard is intentionally CLI-only.' },
	{ command: 'onboarding', mode: 'none', toolNamespaces: [], reason: 'Reset wizard flow is intentionally CLI-only.' },
	{ command: 'chat', mode: 'none', toolNamespaces: [], reason: 'Interactive chat entrypoint is CLI-only.' },
	{ command: 'cron', mode: 'optional', toolNamespaces: ['cron'], reason: 'Scheduling operations are handled by the cron tool namespace.' },
	{ command: 'skills', mode: 'optional', toolNamespaces: ['skills'], reason: 'Skill lifecycle is exposed under skills tool namespace.' },
	{ command: 'browser', mode: 'optional', toolNamespaces: ['web'], reason: 'Browser automation is in the web tool namespace.' },
	{ command: 'readme', mode: 'none', toolNamespaces: [], reason: 'Terminal README renderer is CLI-only.' },
	{ command: 'doctor', mode: 'none', toolNamespaces: [], reason: 'Health/fix command is operational CLI workflow.' },
	{ command: 'docs', mode: 'none', toolNamespaces: [], reason: 'Documentation generation is CLI automation only.' },
	{ command: 'migrate', mode: 'none', toolNamespaces: [], reason: 'Migration operations are intentionally CLI-admin only.' },
	{ command: 'project', mode: 'optional', toolNamespaces: ['memory', 'agents'], reason: 'Project context is partly reflected through memory/agents operations.' },
	{ command: 'tenant', mode: 'none', toolNamespaces: [], reason: 'Tenant administration is currently CLI-only.' },
	{ command: 'token', mode: 'none', toolNamespaces: [], reason: 'Dashboard auth token management is intentionally CLI-only.' },
	{ command: 'update', mode: 'none', toolNamespaces: [], reason: 'Binary update lifecycle is CLI-only.' },
	{ command: 'debug', mode: 'none', toolNamespaces: [], reason: 'Debug-mode toggling remains CLI-admin.' },
	{ command: 'backup', mode: 'none', toolNamespaces: [], reason: 'Backup operations are CLI-admin only.' },
	{ command: 'restore', mode: 'none', toolNamespaces: [], reason: 'Restore operations are CLI-admin only.' },
	{ command: 'uninstall', mode: 'none', toolNamespaces: [], reason: 'Destructive uninstall must remain CLI-only.' },
]
