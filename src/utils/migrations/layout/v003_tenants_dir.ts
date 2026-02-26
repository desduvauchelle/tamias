/**
 * Layout migration v003: Create tenants/ directory and ensure workspace structure.
 */
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Migration } from '../types'

export const migration: Migration = {
	version: 3,
	domain: 'layout',
	description: 'Create tenants/ directory for multi-tenancy',
	up: async (tamiasDirPath: string) => {
		const tenantsDir = join(tamiasDirPath, 'tenants')
		if (!existsSync(tenantsDir)) {
			mkdirSync(tenantsDir, { recursive: true })
			return { success: true, message: `Created ${tenantsDir}` }
		}
		return { success: true, message: 'tenants/ directory already exists' }
	},
}
