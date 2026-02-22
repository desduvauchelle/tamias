import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const templatesDir = path.join(process.cwd(), '../src/templates')

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url)
	const file = searchParams.get('file')

	if (!file) {
		// List markdown files in the templates directory
		try {
			const files = await fs.readdir(templatesDir)
			const mdFiles = files.filter(f => f.endsWith('.md'))
			return NextResponse.json({ files: mdFiles })
		} catch (error) {
			console.error('Error reading templates directory:', error)
			return NextResponse.json({ error: 'Failed to read templates directory' }, { status: 500 })
		}
	}

	// Read specific file
	try {
		const filePath = path.join(templatesDir, file)

		// Basic security check to prevent directory traversal
		if (!filePath.startsWith(templatesDir)) {
			return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
		}

		const content = await fs.readFile(filePath, 'utf-8')
		return NextResponse.json({ content })
	} catch (error) {
		console.error(`Error reading file ${file}:`, error)
		return NextResponse.json({ error: `Failed to read file ${file}` }, { status: 500 })
	}
}

export async function POST(request: Request) {
	try {
		const { file, content } = await request.json()

		if (!file || typeof content !== 'string') {
			return NextResponse.json({ error: 'File name and content are required' }, { status: 400 })
		}

		const filePath = path.join(templatesDir, file)

		// Basic security check to prevent directory traversal
		if (!filePath.startsWith(templatesDir)) {
			return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
		}

		// Ensure file exists and ends with .md
		if (!file.endsWith('.md')) {
			return NextResponse.json({ error: 'Only .md files are allowed' }, { status: 400 })
		}

		await fs.writeFile(filePath, content, 'utf-8')
		return NextResponse.json({ success: true })
	} catch (error) {
		console.error('Error saving file:', error)
		return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
	}
}
