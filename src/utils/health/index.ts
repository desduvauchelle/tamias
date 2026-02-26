/**
 * Health check system for Tamias.
 *
 * Runs on every daemon start to verify configuration,
 * filesystem, providers, channels, and tools.
 *
 * Auto-fixes what it can, provides clear instructions for the rest.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { TAMIAS_DIR } from '../config.ts'
import { loadConfig, getApiKeyForConnection, getDefaultModels, getAllModelOptions } from '../config.ts'
import { readEnvFile } from '../env.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus = 'ok' | 'warn' | 'error' | 'fixed'

export interface HealthResult {
	id: string
	status: HealthStatus
	message: string
	fix?: { action: string; result: string }
	instructions?: string
}

export interface HealthReport {
	results: HealthResult[]
	hasErrors: boolean
	hasWarnings: boolean
	fixedCount: number
}

// ─── Check Runner ─────────────────────────────────────────────────────────────

export async function runHealthChecks(opts: { autoFix?: boolean; silent?: boolean } = {}): Promise<HealthReport> {
	const results: HealthResult[] = []

	// Run all checks
	results.push(...checkFilesystem())
	results.push(...checkIdentity(opts.autoFix))
	results.push(...checkProviders())
	results.push(...checkDefaultModels())
	results.push(...checkChannels())
	results.push(...checkTools())

	const hasErrors = results.some(r => r.status === 'error')
	const hasWarnings = results.some(r => r.status === 'warn')
	const fixedCount = results.filter(r => r.status === 'fixed').length

	return { results, hasErrors, hasWarnings, fixedCount }
}

// ─── Filesystem Checks ───────────────────────────────────────────────────────

function checkFilesystem(): HealthResult[] {
	const results: HealthResult[] = []

	const requiredDirs = [
		'memory',
		'memory/daily',
		'workspace',
		'projects',
	]

	for (const dir of requiredDirs) {
		const fullPath = join(TAMIAS_DIR, dir)
		if (!existsSync(fullPath)) {
			try {
				mkdirSync(fullPath, { recursive: true })
				results.push({
					id: `filesystem.${dir.replace(/\//g, '.')}`,
					status: 'fixed',
					message: `Created missing ${dir}/ directory`,
					fix: { action: `mkdir ${fullPath}`, result: 'Created' },
				})
			} catch (err: any) {
				results.push({
					id: `filesystem.${dir.replace(/\//g, '.')}`,
					status: 'error',
					message: `Cannot create ${dir}/ directory`,
					instructions: `Manually create: mkdir -p ${fullPath}`,
				})
			}
		} else {
			results.push({
				id: `filesystem.${dir.replace(/\//g, '.')}`,
				status: 'ok',
				message: `${dir}/ exists`,
			})
		}
	}

	// Check config.json exists
	const configPath = join(TAMIAS_DIR, 'config.json')
	if (!existsSync(configPath)) {
		results.push({
			id: 'filesystem.config',
			status: 'warn',
			message: 'config.json does not exist',
			instructions: 'Run `tamias config` to set up your first provider',
		})
	} else {
		results.push({ id: 'filesystem.config', status: 'ok', message: 'config.json exists' })
	}

	// Check .env exists
	const envPath = join(TAMIAS_DIR, '.env')
	if (!existsSync(envPath)) {
		results.push({
			id: 'filesystem.env',
			status: 'warn',
			message: '.env file does not exist (no API keys stored yet)',
			instructions: 'Run `tamias config` to add a provider with API key',
		})
	} else {
		results.push({ id: 'filesystem.env', status: 'ok', message: '.env exists' })
	}

	return results
}

// ─── Identity Checks ─────────────────────────────────────────────────────────

function checkIdentity(autoFix?: boolean): HealthResult[] {
	const results: HealthResult[] = []
	const memoryDir = join(TAMIAS_DIR, 'memory')
	const templatesDir = join(import.meta.dir, '../../templates')

	const files = [
		{ name: 'USER.md', required: true, scaffoldable: true },
		{ name: 'IDENTITY.md', required: true, scaffoldable: true },
		{ name: 'SOUL.md', required: false, scaffoldable: true },
		{ name: 'MEMORY.md', required: false, scaffoldable: true },
	]

	for (const file of files) {
		const filePath = join(memoryDir, file.name)
		if (!existsSync(filePath)) {
			if (autoFix && file.scaffoldable) {
				// Try to scaffold from template
				const templatePath = join(templatesDir, file.name)
				if (existsSync(templatePath)) {
					try {
						if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true })
						let content = readFileSync(templatePath, 'utf-8')
						// Strip frontmatter
						if (content.startsWith('---')) {
							const end = content.indexOf('---', 3)
							if (end !== -1) content = content.slice(end + 3).trimStart()
						}
						writeFileSync(filePath, content, 'utf-8')
						results.push({
							id: `identity.${file.name}`,
							status: 'fixed',
							message: `Scaffolded ${file.name} from template`,
							fix: { action: `Copy template → ${file.name}`, result: 'Created' },
						})
						continue
					} catch { }
				}
			}

			results.push({
				id: `identity.${file.name}`,
				status: file.required ? 'warn' : 'ok',
				message: `${file.name} not found`,
				instructions: file.required
					? `Run \`tamias onboarding\` to set up your identity`
					: undefined,
			})
		} else {
			const content = readFileSync(filePath, 'utf-8').trim()
			if (content.length < 10) {
				results.push({
					id: `identity.${file.name}`,
					status: 'warn',
					message: `${file.name} exists but appears empty`,
					instructions: `Run \`tamias onboarding\` to fill in your profile`,
				})
			} else {
				results.push({
					id: `identity.${file.name}`,
					status: 'ok',
					message: `${file.name} configured`,
				})
			}
		}
	}

	return results
}

// ─── Provider Checks ─────────────────────────────────────────────────────────

function checkProviders(): HealthResult[] {
	const results: HealthResult[] = []
	let config: any

	try {
		config = loadConfig()
	} catch {
		results.push({
			id: 'providers.config',
			status: 'error',
			message: 'Failed to parse config.json',
			instructions: 'Check config.json for syntax errors, or run `tamias config` to recreate',
		})
		return results
	}

	const connections = Object.entries(config.connections || {})
	if (connections.length === 0) {
		results.push({
			id: 'providers.none',
			status: 'error',
			message: 'No AI providers configured',
			instructions: 'Run `tamias config` to add your first AI provider (OpenAI, Anthropic, Google, etc.)',
		})
		return results
	}

	for (const [nickname, conn] of connections as [string, any][]) {
		const envVarName = conn.envKeyName
		if (!envVarName) {
			results.push({
				id: `providers.${nickname}`,
				status: 'warn',
				message: `Connection "${nickname}" has no API key variable set`,
				instructions: `Run \`tamias models edit ${nickname}\` to configure the API key`,
			})
			continue
		}

		const apiKey = getApiKeyForConnection(nickname)
		if (!apiKey) {
			results.push({
				id: `providers.${nickname}`,
				status: 'error',
				message: `API key missing for "${nickname}" (env: ${envVarName})`,
				instructions: `Set ${envVarName} in ~/.tamias/.env\n  → Or run: tamias config`,
			})
		} else if (apiKey.length < 10) {
			results.push({
				id: `providers.${nickname}`,
				status: 'warn',
				message: `API key for "${nickname}" looks suspiciously short (${apiKey.length} chars)`,
				instructions: `Check ${envVarName} in ~/.tamias/.env`,
			})
		} else {
			const modelCount = conn.selectedModels?.length || 0
			results.push({
				id: `providers.${nickname}`,
				status: 'ok',
				message: `"${nickname}" (${conn.provider}) — ${modelCount} model(s), key present`,
			})
		}
	}

	return results
}

// ─── Default Models Check ─────────────────────────────────────────────────────

function checkDefaultModels(): HealthResult[] {
	const results: HealthResult[] = []
	const defaultModels = getDefaultModels()
	const allModels = getAllModelOptions()

	if (defaultModels.length === 0) {
		if (allModels.length > 0) {
			results.push({
				id: 'models.default',
				status: 'warn',
				message: 'No default model set, but models are available',
				instructions: 'Run `tamias model set` to choose a default model',
			})
		} else {
			results.push({
				id: 'models.default',
				status: 'error',
				message: 'No models available',
				instructions: 'Run `tamias config` to add a provider and select models',
			})
		}
	} else {
		// Check that default models reference valid connections
		let config: any
		try { config = loadConfig() } catch { return results }

		for (const model of defaultModels) {
			const [nick] = model.split('/')
			if (!config.connections[nick]) {
				results.push({
					id: `models.default.${nick}`,
					status: 'warn',
					message: `Default model "${model}" references missing connection "${nick}"`,
					instructions: `Run \`tamias model set\` to update, or \`tamias config\` to add the "${nick}" connection`,
				})
			} else {
				results.push({
					id: `models.default.${nick}`,
					status: 'ok',
					message: `Default model "${model}" — connection valid`,
				})
			}
		}
	}

	return results
}

// ─── Channel Checks ──────────────────────────────────────────────────────────

function checkChannels(): HealthResult[] {
	const results: HealthResult[] = []
	let config: any
	try { config = loadConfig() } catch { return results }

	const bridges = config.bridges || {}

	// Discord instances
	for (const [key, cfg] of Object.entries(bridges.discords || {}) as [string, any][]) {
		if (!cfg.enabled) continue

		const envKey = cfg.envKeyName
		if (!envKey) {
			results.push({
				id: `channels.discord.${key}`,
				status: 'error',
				message: `Discord "${key}" enabled but no bot token configured`,
				instructions: `Run \`tamias channels edit\` to set the bot token`,
			})
		} else {
			const token = readEnvFile()[envKey]
			if (!token) {
				results.push({
					id: `channels.discord.${key}`,
					status: 'error',
					message: `Discord "${key}" — token env var ${envKey} is empty`,
					instructions: `Set ${envKey} in ~/.tamias/.env`,
				})
			} else {
				results.push({
					id: `channels.discord.${key}`,
					status: 'ok',
					message: `Discord "${key}" — configured`,
				})
			}
		}
	}

	// Telegram instances
	for (const [key, cfg] of Object.entries(bridges.telegrams || {}) as [string, any][]) {
		if (!cfg.enabled) continue

		const envKey = cfg.envKeyName
		if (!envKey) {
			results.push({
				id: `channels.telegram.${key}`,
				status: 'error',
				message: `Telegram "${key}" enabled but no bot token configured`,
				instructions: `Run \`tamias channels edit\` to set the bot token`,
			})
		} else {
			const token = readEnvFile()[envKey]
			if (!token) {
				results.push({
					id: `channels.telegram.${key}`,
					status: 'error',
					message: `Telegram "${key}" — token env var ${envKey} is empty`,
					instructions: `Set ${envKey} in ~/.tamias/.env`,
				})
			} else {
				results.push({
					id: `channels.telegram.${key}`,
					status: 'ok',
					message: `Telegram "${key}" — configured`,
				})
			}
		}
	}

	// WhatsApp instances
	for (const [key, cfg] of Object.entries(bridges.whatsapps || {}) as [string, any][]) {
		if (!cfg.enabled) continue

		if (!cfg.phoneNumberId || !cfg.accessToken) {
			results.push({
				id: `channels.whatsapp.${key}`,
				status: 'error',
				message: `WhatsApp "${key}" enabled but missing phoneNumberId or accessToken`,
				instructions: `Run \`tamias channels edit\` to configure WhatsApp Business API credentials`,
			})
		} else {
			results.push({
				id: `channels.whatsapp.${key}`,
				status: 'ok',
				message: `WhatsApp "${key}" — configured`,
			})
		}
	}

	return results
}

// ─── Tool Dependency Checks ──────────────────────────────────────────────────

function checkTools(): HealthResult[] {
	const results: HealthResult[] = []
	let config: any
	try { config = loadConfig() } catch { return results }

	// Check tool-specific dependencies
	const toolDeps: Array<{ tool: string; binary: string; installCmd: string }> = [
		{ tool: 'email', binary: 'himalaya', installCmd: 'brew install himalaya' },
		{ tool: 'browser', binary: 'playwright', installCmd: 'bunx playwright install' },
		{ tool: 'github', binary: 'git', installCmd: 'xcode-select --install' },
	]

	for (const dep of toolDeps) {
		const toolConfig = config.internalTools?.[dep.tool]

		// Only check if tool is enabled
		if (toolConfig && !toolConfig.enabled) continue

		try {
			const which = Bun.which(dep.binary)
			if (which) {
				results.push({
					id: `tools.${dep.tool}`,
					status: 'ok',
					message: `${dep.binary} found at ${which}`,
				})
			} else {
				results.push({
					id: `tools.${dep.tool}`,
					status: 'warn',
					message: `${dep.binary} not found`,
					instructions: `Install: ${dep.installCmd}\n  → Or disable the ${dep.tool} tool: tamias tools disable ${dep.tool}`,
				})
			}
		} catch {
			results.push({
				id: `tools.${dep.tool}`,
				status: 'warn',
				message: `Could not check for ${dep.binary}`,
			})
		}
	}

	return results
}

// ─── Format Helpers ──────────────────────────────────────────────────────────

export function formatHealthReport(report: HealthReport): string {
	const lines: string[] = []

	for (const result of report.results) {
		let icon: string
		switch (result.status) {
			case 'ok': icon = '✓'; break
			case 'warn': icon = '⚠'; break
			case 'error': icon = '✗'; break
			case 'fixed': icon = '🔧'; break
		}

		lines.push(`${icon} ${result.id} — ${result.message}`)

		if (result.fix) {
			lines.push(`  → ${result.fix.result}`)
		}

		if (result.instructions) {
			for (const line of result.instructions.split('\n')) {
				lines.push(`  → ${line}`)
			}
		}
	}

	return lines.join('\n')
}
