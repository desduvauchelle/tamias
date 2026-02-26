import { NextRequest, NextResponse } from 'next/server'
import { join, extname } from 'path'
import { homedir } from 'os'
import { readFile, writeFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

const TAMIAS_DIR = join(homedir(), '.tamias')

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url)
	const rawPath = searchParams.get('path') || ''

	const safeSub = rawPath
		.replace(/^~\/\.tamias\/?/, '')
		.replace(/^\/+/, '')

	if (!safeSub) {
		return NextResponse.json({ error: 'No path provided' }, { status: 400 })
	}

	const targetPath = join(TAMIAS_DIR, safeSub)

	if (!targetPath.startsWith(TAMIAS_DIR)) {
		return NextResponse.json({ error: 'Access denied' }, { status: 403 })
	}

	try {
		const ext = extname(safeSub).toLowerCase()
		const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp']
		const isImage = imageExts.includes(ext)

		if (isImage) {
			const buf = await readFile(targetPath)
			const mimeMap: Record<string, string> = {
				'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
				'.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
				'.ico': 'image/x-icon', '.bmp': 'image/bmp'
			}
			const mime = mimeMap[ext] || 'application/octet-stream'
			return NextResponse.json({
				type: 'image',
				base64: buf.toString('base64'),
				mimeType: mime,
				size: buf.length,
			})
		}

		const content = await readFile(targetPath, 'utf8')
		let type = 'text'
		if (ext === '.md' || ext === '.markdown') type = 'markdown'
		else if (ext === '.json') type = 'json'
		else if (['.ts', '.tsx', '.js', '.jsx', '.py', '.sh', '.yaml', '.yml', '.toml', '.env'].includes(ext)) type = 'code'

		return NextResponse.json({ type, content, ext, size: Buffer.byteLength(content, 'utf8') })
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			return NextResponse.json({ error: 'Not found' }, { status: 404 })
		}
		return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
	}
}

export async function PUT(request: NextRequest) {
	const { searchParams } = new URL(request.url)
	const rawPath = searchParams.get('path') || ''

	const safeSub = rawPath
		.replace(/^~\/\.tamias\/?/, '')
		.replace(/^\/+/, '')

	if (!safeSub) {
		return NextResponse.json({ error: 'No path provided' }, { status: 400 })
	}

	const targetPath = join(TAMIAS_DIR, safeSub)

	if (!targetPath.startsWith(TAMIAS_DIR)) {
		return NextResponse.json({ error: 'Access denied' }, { status: 403 })
	}

	try {
		const { content } = await request.json()
		if (typeof content !== 'string') {
			return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
		}
		await writeFile(targetPath, content, 'utf8')
		return NextResponse.json({ success: true })
	} catch (error) {
		return NextResponse.json({ error: 'Failed to write file' }, { status: 500 })
	}
}
