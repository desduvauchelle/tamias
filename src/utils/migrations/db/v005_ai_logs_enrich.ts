/**
 * DB migration v005: Enrich ai_logs with tenant, agent, and cost breakdown columns.
 * Also adds agentId to sessions.
 */
import type { Migration } from '../types'

export const migration: Migration = {
	version: 5,
	domain: 'db',
	description: 'Add tenantId, agentId, channel breakdown, and estimatedCostUsd to ai_logs',
	up: async (tamiasDirPath: string) => {
		// DB migrations are handled by the db.ts module's migration array.
		// This file serves as documentation and version tracking.
		// The actual SQL is applied via the db.ts migration system.
		return { success: true, message: 'DB migration v005 applied via db.ts migration array' }
	},
}
