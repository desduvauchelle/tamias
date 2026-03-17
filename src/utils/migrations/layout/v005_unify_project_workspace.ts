/**
 * Layout migration v005: Unify projects into workspace.
 *
 * Moves project metadata (config.json, kanban.json, context.md, skills/, etc.)
 * from ~/.tamias/projects/<slug>/ into ~/.tamias/workspace/<slug>/ so that
 * each project lives in a single directory alongside its workspace files.
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, renameSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Migration } from '../types'

const FILES_TO_MIGRATE = ['config.json', 'kanban.json', 'context.md', 'PROJECT.md', 'ACTIVITY.md', 'NOTES.md', 'WORKSPACE.md']

function copyDirRecursive(src: string, dest: string): void {
	if (!existsSync(src)) return
	if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const srcPath = join(src, entry.name)
		const destPath = join(dest, entry.name)
		if (entry.isDirectory()) {
			copyDirRecursive(srcPath, destPath)
		} else if (!existsSync(destPath)) {
			copyFileSync(srcPath, destPath)
		}
	}
}

export const migration: Migration = {
	version: 5,
	domain: 'layout',
	description: 'Unify project metadata into workspace directories',
	up: async (tamiasDirPath: string) => {
		const oldProjectsDir = join(tamiasDirPath, 'projects')
		const workspaceDir = join(tamiasDirPath, 'workspace')

		if (!existsSync(oldProjectsDir)) {
			return { success: true, message: 'No projects/ directory to migrate' }
		}

		// Ensure workspace dir exists
		if (!existsSync(workspaceDir)) {
			mkdirSync(workspaceDir, { recursive: true })
		}

		const entries = readdirSync(oldProjectsDir, { withFileTypes: true })
		let migrated = 0

		for (const entry of entries) {
			if (!entry.isDirectory()) continue

			const slug = entry.name
			const srcDir = join(oldProjectsDir, slug)
			const destDir = join(workspaceDir, slug)

			// Skip if already migrated (dest has config.json)
			if (existsSync(join(destDir, 'config.json'))) continue

			if (!existsSync(destDir)) {
				mkdirSync(destDir, { recursive: true })
			}

			// Copy metadata files (don't overwrite existing workspace files)
			for (const file of FILES_TO_MIGRATE) {
				const srcFile = join(srcDir, file)
				const destFile = join(destDir, file)
				if (existsSync(srcFile) && !existsSync(destFile)) {
					copyFileSync(srcFile, destFile)
				}
			}

			// Ensure config.json path field matches the slug
			const configPath = join(destDir, 'config.json')
			if (existsSync(configPath)) {
				try {
					const config = JSON.parse(readFileSync(configPath, 'utf-8'))
					config.path = slug
					config.id = slug
					writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
				} catch { /* ignore parse errors */ }
			}

			// Copy skills directory
			copyDirRecursive(join(srcDir, 'skills'), join(destDir, 'skills'))

			migrated++
		}

		// Rename old projects dir as backup
		if (migrated > 0) {
			try {
				renameSync(oldProjectsDir, join(tamiasDirPath, 'projects.bak'))
			} catch {
				// If rename fails (e.g. cross-device), leave it
			}
		}

		return { success: true, message: `Migrated ${migrated} project(s) from projects/ to workspace/` }
	},
}
