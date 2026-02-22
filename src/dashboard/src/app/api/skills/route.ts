import { NextResponse } from 'next/server'
import { getTamiasSkills, saveTamiasSkill } from '../tamias'

export const dynamic = 'force-dynamic'

export async function GET() {
	const skills = await getTamiasSkills()
	return NextResponse.json(skills)
}

export async function POST(req: Request) {
	try {
		const body = await req.json()
		const { name, description, content } = body
		if (!name || !content) {
			return NextResponse.json({ error: 'Missing name or content' }, { status: 400 })
		}
		await saveTamiasSkill(name, description || '', content)
		return NextResponse.json({ success: true })
	} catch (error: any) {
		return NextResponse.json({ error: error.message }, { status: 500 })
	}
}
