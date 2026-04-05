/**
 * Coding CLI delegation tool.
 *
 * Delegates coding tasks to external CLI tools (Claude Code, Copilot CLI, Aider, etc.)
 * with smart/normal model tier selection, ordered fallback, and streaming output.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { getCodingProviders, type CodingProvider } from '../utils/config.ts'
import { estimateComplexity } from '../utils/complexityEstimator.ts'
import { spawnProcess, type ProcessResult } from '../utils/processManager.ts'
import { existsSync } from 'fs'

export const CODING_CLI_TOOL_NAME = 'coding_cli'
export const CODING_CLI_TOOL_LABEL = '🖥️ Coding CLI (delegate to external coding tools)'

// ─── Pre-configured provider templates ──────────────────────────────────────

export interface ProviderPreset {
	name: string
	displayName: string
	command: string
	smartModel: string
	normalModel: string
	autoAcceptFlag: string
	outputFlag: string
	timeout: number
	/** Shell command to check if CLI is installed */
	detectCommand: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		name: 'claude-code',
		displayName: 'Claude Code',
		command: 'claude',
		smartModel: 'opus',
		normalModel: 'sonnet',
		autoAcceptFlag: '--permission-mode bypassPermissions',
		outputFlag: '--output-format stream-json -p',
		timeout: 600,
		detectCommand: 'which claude',
	},
	{
		name: 'copilot-cli',
		displayName: 'GitHub Copilot CLI',
		command: 'gh copilot',
		smartModel: '',
		normalModel: '',
		autoAcceptFlag: '',
		outputFlag: '',
		timeout: 300,
		detectCommand: 'gh copilot --help',
	},
	{
		name: 'aider',
		displayName: 'Aider',
		command: 'aider',
		smartModel: 'opus',
		normalModel: 'sonnet',
		autoAcceptFlag: '--yes --no-auto-commits',
		outputFlag: '',
		timeout: 600,
		detectCommand: 'which aider',
	},
]

/**
 * Check if a CLI command is available on the system.
 */
export function isCommandAvailable(detectCommand: string): boolean {
	try {
		const args = detectCommand.split(/\s+/)
		const cmd = args.shift()!
		const result = Bun.spawnSync([cmd, ...args], { stdout: 'pipe', stderr: 'pipe' })
		return result.exitCode === 0
	} catch {
		return false
	}
}

/**
 * Build the full CLI command arguments for a given provider and task.
 */
export function buildCliArgs(
	provider: CodingProvider,
	task: string,
	modelTier: 'smart' | 'normal',
): string[] {
	const args: string[] = []

	// Auto-accept flag
	if (provider.autoAcceptFlag) {
		args.push(...provider.autoAcceptFlag.split(/\s+/))
	}

	// Output flag
	if (provider.outputFlag) {
		args.push(...provider.outputFlag.split(/\s+/))
	}

	// Model selection based on tier
	const modelAlias = modelTier === 'smart' ? provider.smartModel : provider.normalModel
	if (modelAlias) {
		args.push('--model', modelAlias)
	}

	// Additional flags
	if (provider.additionalFlags) {
		args.push(...provider.additionalFlags.split(/\s+/))
	}

	// Task prompt (always last)
	args.push(task)

	return args
}

/**
 * Execute a coding task against a single provider.
 */
export async function executeWithProvider(
	provider: CodingProvider,
	task: string,
	cwd: string,
	modelTier: 'smart' | 'normal',
	sessionId: string,
	onProgress?: (text: string) => void,
): Promise<ProcessResult & { providerName: string; modelTier: 'smart' | 'normal' }> {
	const args = buildCliArgs(provider, task, modelTier)
	const [baseCmd, ...baseArgs] = provider.command.split(/\s+/)

	const result = await spawnProcess(`coding-${sessionId}-${provider.name}`, {
		command: baseCmd,
		args: [...baseArgs, ...args],
		cwd,
		timeout: provider.timeout,
		onStdout: onProgress,
		onStderr: onProgress,
	})

	return { ...result, providerName: provider.name, modelTier }
}

export interface DelegationResult {
	success: boolean
	providerName: string
	modelTier: 'smart' | 'normal'
	stdout: string
	stderr: string
	timedOut: boolean
	rateLimited: boolean
	durationMs: number
	error?: string
	/** Which providers were tried (in order) */
	attemptedProviders: string[]
}

/**
 * Attempt to delegate a coding task across configured providers with fallback.
 */
export async function delegateCodingTask(
	task: string,
	cwd: string,
	sessionId: string,
	complexityHint?: 'smart' | 'normal',
	onProgress?: (text: string) => void,
): Promise<DelegationResult> {
	const providers = getCodingProviders()

	if (providers.length === 0) {
		return {
			success: false,
			providerName: 'none',
			modelTier: 'normal',
			stdout: '',
			stderr: '',
			timedOut: false,
			rateLimited: false,
			durationMs: 0,
			error: 'No coding providers configured. Add providers in Settings → Coding or in config.json under "codingProviders".',
			attemptedProviders: [],
		}
	}

	const attemptedProviders: string[] = []

	for (const provider of providers) {
		attemptedProviders.push(provider.name)

		// Determine model tier
		const tier = complexityHint ?? estimateComplexity(task, provider.complexityThreshold).tier

		// Try this provider (with retries)
		for (let attempt = 0; attempt <= provider.maxRetries; attempt++) {
			try {
				const result = await executeWithProvider(
					provider, task, cwd, tier, sessionId, onProgress,
				)

				if (result.success) {
					return {
						success: true,
						providerName: provider.name,
						modelTier: tier,
						stdout: result.stdout,
						stderr: result.stderr,
						timedOut: false,
						rateLimited: false,
						durationMs: result.durationMs,
						attemptedProviders,
					}
				}

				// If rate-limited, break to next provider immediately
				if (result.rateLimited) {
					onProgress?.(`⚠️ ${provider.name} is rate-limited, trying next provider...`)
					break
				}

				// If timed out, break to next provider
				if (result.timedOut) {
					onProgress?.(`⚠️ ${provider.name} timed out after ${provider.timeout}s, trying next provider...`)
					break
				}

				// Non-rate-limit failure: retry if we have attempts left
				if (attempt < provider.maxRetries) {
					onProgress?.(`⚠️ ${provider.name} failed (attempt ${attempt + 1}/${provider.maxRetries + 1}), retrying...`)
				}
			} catch (err) {
				// CLI not found or other spawn error
				const msg = err instanceof Error ? err.message : String(err)
				onProgress?.(`⚠️ ${provider.name} error: ${msg}`)
				break
			}
		}
	}

	// All providers exhausted
	return {
		success: false,
		providerName: 'none',
		modelTier: 'normal',
		stdout: '',
		stderr: '',
		timedOut: false,
		rateLimited: false,
		durationMs: 0,
		error: `All coding providers failed. Tried: ${attemptedProviders.join(', ')}. Consider handling the task in-process with terminal tools instead.`,
		attemptedProviders,
	}
}

// ─── AI Tool exports ────────────────────────────────────────────────────────

export const createCodingCliTools = (_aiService: unknown, sessionId: string) => ({

	delegate_coding_task: tool({
		description: `Delegate a coding task to an external coding CLI (Claude Code, Copilot, Aider, etc.). The system will automatically select the best available provider, choose smart/normal model tier based on task complexity, and handle fallback if a provider is rate-limited or fails. Use this for substantial coding work — file edits, feature implementation, refactoring, test writing, etc.`,
		inputSchema: z.object({
			task: z.string().describe('Detailed description of the coding task to delegate.'),
			directory: z.string().describe('Absolute path to the working directory (project root) where the coding CLI should operate.'),
			complexity_hint: z.enum(['smart', 'normal']).optional().describe('Optional override: "smart" forces the powerful model, "normal" forces the standard model. If omitted, complexity is auto-estimated.'),
		}),
		execute: async ({ task, directory, complexity_hint }: {
			task: string
			directory: string
			complexity_hint?: 'smart' | 'normal'
		}) => {
			if (!existsSync(directory)) {
				return {
					success: false,
					error: `Directory does not exist: ${directory}`,
				}
			}

			const result = await delegateCodingTask(
				task, directory, sessionId, complexity_hint,
			)

			if (result.success) {
				return {
					success: true,
					provider: result.providerName,
					modelTier: result.modelTier,
					output: result.stdout.slice(-10000), // Last 10k chars
					durationSeconds: Math.round(result.durationMs / 1000),
					attemptedProviders: result.attemptedProviders,
				}
			}

			return {
				success: false,
				error: result.error,
				attemptedProviders: result.attemptedProviders,
				lastStderr: result.stderr.slice(-2000),
			}
		},
	}),

	check_coding_providers: tool({
		description: 'List configured coding CLI providers, their status, and whether each CLI is detected on the system.',
		inputSchema: z.object({}),
		execute: async () => {
			const providers = getCodingProviders()
			const presets = PROVIDER_PRESETS

			const configured = providers.map(p => {
				const preset = presets.find(pr => pr.name === p.name)
				const detectCmd = preset?.detectCommand ?? `which ${p.command.split(/\s+/)[0]}`
				const installed = isCommandAvailable(detectCmd)

				return {
					name: p.name,
					command: p.command,
					enabled: p.enabled,
					priority: p.priority,
					smartModel: p.smartModel ?? '(default)',
					normalModel: p.normalModel ?? '(default)',
					timeout: p.timeout,
					installed,
				}
			})

			const availablePresets = presets
				.filter(pr => !providers.some(p => p.name === pr.name))
				.map(pr => ({
					name: pr.name,
					displayName: pr.displayName,
					installed: isCommandAvailable(pr.detectCommand),
				}))

			return {
				configuredProviders: configured,
				availablePresets,
				totalConfigured: configured.length,
				totalInstalled: configured.filter(c => c.installed).length,
			}
		},
	}),
})
