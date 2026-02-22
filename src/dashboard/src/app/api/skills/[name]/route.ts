import { NextResponse } from 'next/server'
import { deleteTamiasSkill } from '../../tamias'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
	try {
		const { name } = await params
		await deleteTamiasSkill(name)
		return NextResponse.json({ success: true })
	} catch (error: any) {
		return NextResponse.json({ error: error.message }, { status: 500 })
	}
}
