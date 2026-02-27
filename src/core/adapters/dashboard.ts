/**
 * Dashboard Adapter
 *
 * Generates Next.js-compatible request handlers from registry operations
 * that have the 'dashboard' surface. Dashboard API routes can delegate to
 * these instead of reimplementing mutation logic.
 */
import { getOperations, getOperation } from '../registry'
import type { OperationDef } from '../registry'

// Ensure domain registrations are loaded
import '../domains/index'

/**
 * Execute a registry operation by id with the given input.
 * Validates input against the operation's zod schema before calling the handler.
 * Returns a structured result suitable for NextResponse.json().
 */
export async function executeOperation(
	operationId: string,
	rawInput: unknown,
): Promise<{ status: number; body: unknown }> {
	const op = getOperation(operationId)
	if (!op) {
		return { status: 404, body: { error: `Operation '${operationId}' not found` } }
	}
	if (!op.surfaces.includes('dashboard')) {
		return { status: 403, body: { error: `Operation '${operationId}' is not available on the dashboard` } }
	}

	const parsed = op.inputSchema.safeParse(rawInput)
	if (!parsed.success) {
		return { status: 400, body: { error: 'Validation failed', issues: parsed.error.issues } }
	}

	try {
		const result = await op.handler(parsed.data)
		return { status: 200, body: result }
	} catch (err: unknown) {
		return { status: 500, body: { error: (err as Error).message } }
	}
}

/**
 * Get operation metadata for a domain, suitable for dashboard UI rendering.
 * Returns operation summaries, available verbs, and argument documentation.
 */
export function getDashboardOperations(domain?: string) {
	const ops = getOperations({ domain, surface: 'dashboard' })
	return ops.map((op) => ({
		id: op.id,
		domain: op.domain,
		verb: op.verb,
		summary: op.summary,
		description: op.description,
		args: op.args,
		cliCommand: op.cliCommand,
	}))
}
