
import { getTamiasCrons, saveTamiasCrons } from '../tamias'
import { z } from 'zod'

const CronJobSchema = z.object({
	id: z.string(),
	name: z.string(),
	schedule: z.string(),
	type: z.enum(['ai', 'message']).default('ai'),
	prompt: z.string(),
	target: z.string().optional().default('last'),
	enabled: z.boolean().default(true),
	lastRun: z.string().datetime().optional(),
	lastStatus: z.enum(['success', 'error']).optional(),
	lastError: z.string().optional(),
	createdAt: z.string().datetime(),
})

const CronJobsSchema = z.array(CronJobSchema)

export const dynamic = 'force-dynamic'

export async function GET() {
	try {
		const crons = await getTamiasCrons()
		return new Response(JSON.stringify({ crons: Array.isArray(crons) ? crons : [] }), {
			headers: { 'Content-Type': 'application/json' }
		})
	} catch (error) {
		return new Response(JSON.stringify({ crons: [] }), {
			headers: { 'Content-Type': 'application/json' }
		})
	}
}

export async function POST(request: Request) {
	try {
		const { crons } = await request.json()
		const validated = CronJobsSchema.parse(crons || [])
		await saveTamiasCrons(validated)
		return new Response(JSON.stringify({ success: true }), {
			headers: { 'Content-Type': 'application/json' }
		})
	} catch (error) {
		console.error(error)
		return new Response(JSON.stringify({ error: 'Failed to update crons' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		})
	}
}
