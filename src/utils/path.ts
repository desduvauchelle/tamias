import { join, resolve, isAbsolute, dirname } from 'path'
import { homedir } from 'os'
import { realpathSync } from 'fs'
import { getWorkspacePath } from './config.ts'

/**
 * Expand ~/ to absolute home directory path.
 */
export function expandHome(path: string): string {
	if (path.startsWith('~/')) {
		return join(homedir(), path.slice(2))
	}
	if (path === '~') {
		return homedir()
	}
	return path
}

/**
 * Validates that the target path is within the authorized workspace.
 * If no workspace is configured, it just expands home and resolves.
 * Throws an error if a workspace is configured and the path is outside.
 */
export const validatePath = (path: string): string => {
	const workspaceRoot = getWorkspacePath()
	const expandedPath = expandHome(path)

	// 1. Resolve to absolute path
	let absolutePath = isAbsolute(expandedPath) ? expandedPath : resolve(workspaceRoot, expandedPath)

	// 2. Resolve symlinks and .. to get final disk path
	try {
		// If it exists, get the real path
		absolutePath = realpathSync(absolutePath)
	} catch {
		// If it doesn't exist, we resolve its parent to be safe
		const parent = dirname(absolutePath)
		try {
			const realParent = realpathSync(parent)
			absolutePath = join(realParent, absolutePath.split('/').pop() || '')
		} catch {
			// If even parent doesn't exist (deep write), resolve it manually
			absolutePath = resolve(absolutePath)
		}
	}

	// 3. Ensure it starts with workspaceRoot
	// Note: getDefaultWorkspacePath() returns ~/Documents/Tamias by default.
	// If the user has a workspace configured, we MUST enforce it.
	try {
		const realWorkspace = realpathSync(workspaceRoot)
		if (!absolutePath.startsWith(realWorkspace)) {
			throw new Error(`Access denied: Path '${path}' is outside the authorized workspace '${realWorkspace}'.`)
		}
	} catch (err) {
		// If workspaceRoot doesn't exist yet, we can't realpath it.
		// In that case, we at least check if the string starts with workspaceRoot.
		if (!absolutePath.startsWith(workspaceRoot)) {
			throw new Error(`Access denied: Path '${path}' is outside the authorized workspace '${workspaceRoot}'.`)
		}
	}

	return absolutePath
}
