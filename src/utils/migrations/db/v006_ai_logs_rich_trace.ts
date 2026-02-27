/**
 * DB migration v006: add rich tracing columns to ai_logs.
 */
import type { Migration } from '../types'

export const migration: Migration = {
	version: 6,
	domain: 'db',
	description: 'Add system prompt, sent messages, tool calls/results, usage JSON, and providerCostUsd to ai_logs',
	up: async (_tamiasDirPath: string) => {
		// DB migrations are applied by src/utils/db.ts migration array.
		return { success: true, message: 'DB migration v006 applied via db.ts migration array' }
	},
}
