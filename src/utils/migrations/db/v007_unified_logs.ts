/**
 * DB migration v007: add unified_logs timeline table.
 */
import type { Migration } from '../types'

export const migration: Migration = {
	version: 7,
	domain: 'db',
	description: 'Add unified_logs table for daemon/channel/message/ai/tool/error timeline',
	up: async (_tamiasDirPath: string) => {
		// DB migrations are applied by src/utils/db.ts migration array.
		return { success: true, message: 'DB migration v007 applied via db.ts migration array' }
	},
}
