
import { getTamiasCrons, saveTamiasCrons } from '../tamias'

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
		await saveTamiasCrons(crons || [])
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
