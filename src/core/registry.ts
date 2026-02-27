import { z, type ZodObject, type ZodRawShape } from 'zod'

// ── Domain types ──────────────────────────────────────────────────────────────

/** Visibility surfaces an operation can be exposed on */
export type Surface = 'cli' | 'ai' | 'dashboard' | 'docs'

/** Metadata for a single argument/field */
export interface ArgDoc {
	/** Human description shown in CLI --help, AI tool schema, and generated docs */
	description: string
	/** Example value for docs/help text */
	example?: string
	/** Whether this arg is required */
	required: boolean
}

/** A single registered operation */
export interface OperationDef<
	TInput extends ZodRawShape = ZodRawShape,
	TOutput = unknown,
> {
	/** Globally unique operation id: "domain.verb", e.g. "agents.create" */
	id: string
	/** Domain grouping, e.g. "agents", "tools", "channels" */
	domain: string
	/** Verb/action name, e.g. "create", "update", "remove", "list", "show" */
	verb: string
	/** Short human-readable summary (used in CLI --help, AI tool description, docs heading) */
	summary: string
	/** Longer description for docs and AI context */
	description: string
	/** Zod schema for validated input */
	inputSchema: ZodObject<TInput>
	/** Per-field documentation keyed by field name */
	args: Record<string, ArgDoc>
	/** Surfaces this operation is visible on */
	surfaces: Surface[]
	/** The handler that performs the mutation/query. Returns typed output. */
	handler: (input: z.infer<ZodObject<TInput>>) => Promise<TOutput>
	/** Equivalent CLI command string for cross-reference, e.g. "tamias agents add" */
	cliCommand?: string
	/** Safety/permission notes shown in docs */
	notes?: string
	/** Example invocations for docs */
	examples?: Array<{ label: string; input: Record<string, unknown> }>
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _operations = new Map<string, OperationDef>()

/**
 * Register an operation in the global registry.
 * Throws if the id is already taken.
 */
export function registerOperation<TInput extends ZodRawShape, TOutput>(
	op: OperationDef<TInput, TOutput>,
): OperationDef<TInput, TOutput> {
	if (_operations.has(op.id)) {
		throw new Error(`Operation '${op.id}' is already registered`)
	}
	_operations.set(op.id, op as unknown as OperationDef)
	return op
}

/** Get a single operation by id */
export function getOperation(id: string): OperationDef | undefined {
	return _operations.get(id)
}

/** Get all operations, optionally filtered by domain and/or surface */
export function getOperations(filter?: { domain?: string; surface?: Surface }): OperationDef[] {
	let ops = Array.from(_operations.values())
	if (filter?.domain) ops = ops.filter((o) => o.domain === filter.domain)
	if (filter?.surface) {
		const s = filter.surface
		ops = ops.filter((o) => o.surfaces.includes(s))
	}
	return ops
}

/** Get all registered domain names */
export function getDomains(): string[] {
	return [...new Set(Array.from(_operations.values()).map((o) => o.domain))]
}

/** Clear registry (for testing) */
export function clearRegistry(): void {
	_operations.clear()
}
