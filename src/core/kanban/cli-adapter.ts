export interface KanbanConfig {
	cliProvider: 'claude' | 'gemini' | 'codex' | 'aider' | 'copilot' | 'custom'
	cliCustomCommand: string
	model: string
	maxBudgetUsd: number
	planThinking: 'smart' | 'basic' | null
	executeThinking: 'smart' | 'basic'
	autoCommit: boolean
	autoPush: boolean
	branchMode: 'current' | 'new' | 'specific'
	branchName: string
	customInstructions: string
}

export const DEFAULT_KANBAN_CONFIG: KanbanConfig = {
	cliProvider: 'claude',
	cliCustomCommand: '',
	model: 'claude-opus-4-6',
	maxBudgetUsd: 10,
	planThinking: 'smart',
	executeThinking: 'smart',
	autoCommit: false,
	autoPush: false,
	branchMode: 'current',
	branchName: '',
	customInstructions: '',
}

export interface CliCommand {
	args: string[]
	supportsStreamJson: boolean
	supportsSession: boolean
}

export function buildCliCommand(config: KanbanConfig, prompt: string, sessionId: string, phase: 'plan' | 'execute', resume?: boolean): CliCommand {
	switch (config.cliProvider) {
		case 'claude':
			return buildClaudeCommand(config, prompt, sessionId, phase, resume)
		case 'gemini':
			return buildGeminiCommand(config, prompt)
		case 'codex':
			return buildCodexCommand(config, prompt)
		case 'aider':
			return buildAiderCommand(config, prompt)
		case 'custom':
			return buildCustomCommand(config, prompt)
		default:
			throw new Error(`Unknown CLI provider: ${config.cliProvider}`)
	}
}

function buildClaudeCommand(config: KanbanConfig, prompt: string, sessionId: string, phase: 'plan' | 'execute', resume?: boolean): CliCommand {
	const args = ['claude', '-p', prompt, '--output-format', 'stream-json', '--verbose']
	args.push('--append-system-prompt', 'IMPORTANT: Do not add any Co-authored-by trailers or similar attribution to git commits. All commits must be authored solely by the user\'s git identity.')
	if (resume) {
		args.push('--resume', sessionId)
	} else {
		args.push('--session-id', sessionId)
	}
	if (config.model) args.push('--model', config.model)
	if (config.maxBudgetUsd > 0) args.push('--max-budget-usd', String(config.maxBudgetUsd))
	if (phase === 'execute') args.push('--dangerously-skip-permissions')
	return { args, supportsStreamJson: true, supportsSession: true }
}

function buildGeminiCommand(config: KanbanConfig, prompt: string): CliCommand {
	const args = ['gemini', '-p', prompt]
	if (config.model) args.push('--model', config.model)
	return { args, supportsStreamJson: false, supportsSession: false }
}

function buildCodexCommand(config: KanbanConfig, prompt: string): CliCommand {
	const args = ['codex', prompt]
	if (config.model) args.push('--model', config.model)
	args.push('--auto-confirm')
	return { args, supportsStreamJson: false, supportsSession: false }
}

function buildAiderCommand(config: KanbanConfig, prompt: string): CliCommand {
	const args = ['aider', '--message', prompt, '--yes']
	if (config.model) args.push('--model', config.model)
	return { args, supportsStreamJson: false, supportsSession: false }
}

function buildCustomCommand(config: KanbanConfig, prompt: string): CliCommand {
	const customCmd = (config.cliCustomCommand ?? '').trim()
	if (!customCmd) throw new Error('Custom CLI provider selected but no command configured.')
	const parts = customCmd.split(/\s+/)
	return { args: [...parts, prompt], supportsStreamJson: false, supportsSession: false }
}
