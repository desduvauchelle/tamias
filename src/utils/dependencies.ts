import { execSync } from 'child_process'
import * as p from '@clack/prompts'
import pc from 'picocolors'

export type Dependency = 'himalaya' | 'git' | 'tar' | 'curl' | 'unzip' | 'gemini' | 'bun'

const DEPENDENCY_MAP: Record<Dependency, { label: string; brew?: string; apt?: string }> = {
	himalaya: { label: 'Himalaya (Email CLI)', brew: 'himalaya' },
	git: { label: 'Git', brew: 'git' },
	tar: { label: 'Tar', brew: 'gnu-tar' },
	curl: { label: 'Curl', brew: 'curl' },
	unzip: { label: 'Unzip', brew: 'unzip' },
	gemini: { label: 'Gemini CLI', brew: 'gemini' },
	bun: { label: 'Bun', brew: 'bun' },
}

/**
 * Check if a command exists in the current environment
 */
export function hasDependency(name: string): boolean {
	try {
		execSync(`command -v ${name}`, { stdio: 'ignore' })
		return true
	} catch {
		return false
	}
}

/**
 * Attempt to install a dependency using the appropriate package manager
 */
export async function installDependency(name: Dependency): Promise<boolean> {
	const info = DEPENDENCY_MAP[name]
	const s = p.spinner()

	if (process.platform === 'darwin') {
		if (hasDependency('brew')) {
			s.start(`Installing ${pc.cyan(info.label)} via Homebrew...`)
			try {
				execSync(`brew install ${info.brew || name}`, { stdio: 'ignore' })
				s.stop(`${pc.green(info.label)} installed!`)
				return true
			} catch (err) {
				s.stop(`${pc.red('Failed')} to install via Homebrew.`)
				return false
			}
		}
	}

	// For non-macOS or if brew is missing, we might need manual intervention or other PKG managers
	return false
}

/**
 * Ensure a dependency is installed, prompting the user if it's missing
 */
export async function ensureDependency(name: Dependency, interactive = true): Promise<boolean> {
	if (hasDependency(name)) return true

	const info = DEPENDENCY_MAP[name]

	if (!interactive) return false

	const confirm = await p.confirm({
		message: `${pc.yellow('⚠️  ' + info.label)} is required but not found. Would you like Tamias to try and install it for you?`,
		initialValue: true,
	})

	if (p.isCancel(confirm) || !confirm) {
		return false
	}

	return await installDependency(name)
}

/**
 * Get the status of all Tamias dependencies
 */
export function getDependencyStatus() {
	return (Object.keys(DEPENDENCY_MAP) as Dependency[]).map(key => ({
		id: key,
		label: DEPENDENCY_MAP[key].label,
		installed: hasDependency(key)
	}))
}
