/**
 * Config migration v002: Add agent tool preferences and channel context fields.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Migration } from '../types'

export const migration: Migration = {
	version: 2,
	domain: 'config',
	description: 'Add channel mode/context fields and WhatsApp bridge config support',
	up: async (tamiasDirPath: string) => {
		const configPath = join(tamiasDirPath, 'config.json')
		if (!existsSync(configPath)) {
			return { success: true, message: 'config.json does not exist yet, skipping' }
		}

		const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
		let changed = false

		// Add whatsapps to bridges if not present
		if (raw.bridges && !raw.bridges.whatsapps) {
			raw.bridges.whatsapps = {}
			changed = true
		}

		// Ensure discords entries have mode field
		if (raw.bridges?.discords) {
			for (const [key, cfg] of Object.entries(raw.bridges.discords as Record<string, any>)) {
				if (!cfg.mode) {
					cfg.mode = 'mention-only'
					changed = true
				}
			}
		}

		raw._configVersion = 2

		if (changed) {
			writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8')
			return { success: true, message: 'Added WhatsApp bridge support and channel mode fields' }
		}

		writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf-8')
		return { success: true, message: 'Config already up to date, version bumped' }
	},
}
