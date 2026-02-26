/**
 * Layout migration v001: Create projects/ directory if it doesn't exist.
 */
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Migration } from '../types'

export const migration: Migration = {
	version: 1,
	domain: 'layout',
	description: 'Create projects/ directory',
	up: async (tamiasDirPath: string) => {
		const projectsDir = join(tamiasDirPath, 'projects')
		if (!existsSync(projectsDir)) {
			mkdirSync(projectsDir, { recursive: true })
			return { success: true, message: `Created ${projectsDir}` }
		}
		return { success: true, message: 'projects/ directory already exists' }
	},
}
