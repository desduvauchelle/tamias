/**
 * Core domain registrations.
 * Import this module to ensure all domain operations are registered in the global registry.
 * Each domain exports an idempotent register function — safe to call after clearRegistry().
 */
import { registerAgentsDomain } from './agents'

export { registerAgentsDomain }

// Future domains will be added here:
// import { registerToolsDomain } from './tools.ts'
// import { registerChannelsDomain } from './channels.ts'

/**
 * Re-register all domains. Call this after clearRegistry() to restore domain operations.
 * Each register function is idempotent — safe to call even if already registered.
 */
export function registerAllDomains(): void {
	registerAgentsDomain()
	// registerToolsDomain()
	// registerChannelsDomain()
}

// Auto-register on import
registerAllDomains()
