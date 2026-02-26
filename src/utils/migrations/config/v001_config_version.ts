/**
 * Config migration v001: Add _configVersion stamp and tenant/project fields.
 * This is additive-only — no existing keys are removed.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Migration } from '../types'

export const migration: Migration = {
	version: 1,
	domain: 'config',
	description: 'Add _configVersion, tenantId, and project support fields to config.json',
	up: async (tamiasDirPath: string) => {
		const configPath = join(tamiasDirPath, 'config.json')
		if (!existsSync(configPath)) {
			return { success: true, message: 'config.json does not exist yet, skipping' }
		}

		const raw = JSON.parse(readFileSync(configPath, 'utf-8'))

		let changed = false

		// Add _configVersion if missing
		if (raw._configVersion === undefined) {
			raw._configVersion = 1
			changed = true
		}

		if (changed) {
			writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8')
			return { success: true, message: 'Added _configVersion to config.json' }
		}

		return { success: true, message: 'config.json already has _configVersion' }
	},
}
