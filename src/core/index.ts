/**
 * Core barrel — registry, domains, and adapters.
 * Importing this module registers all domain operations.
 */
export { registerOperation, getOperation, getOperations, getDomains, clearRegistry } from './registry'
export type { OperationDef, ArgDoc, Surface } from './registry'

// Side-effect: register all domain operations on import
import './domains/index'
