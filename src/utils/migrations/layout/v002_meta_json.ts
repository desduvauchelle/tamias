/**
 * Layout migration v002: Create meta.json if it doesn't exist.
 */
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Migration } from '../types'
import { DEFAULT_META } from '../types'

export const migration: Migration = {
	version: 2,
	domain: 'layout',
	description: 'Create meta.json metadata file',
	up: async (tamiasDirPath: string) => {
		const metaPath = join(tamiasDirPath, 'meta.json')
		if (!existsSync(metaPath)) {
			writeFileSync(metaPath, JSON.stringify(DEFAULT_META, null, 2), 'utf-8')
			return { success: true, message: `Created ${metaPath}` }
		}
		return { success: true, message: 'meta.json already exists' }
	},
}
