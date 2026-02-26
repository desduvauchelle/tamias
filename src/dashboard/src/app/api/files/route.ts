import { NextRequest, NextResponse } from 'next/server'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { readdir, stat, rename, rm } from 'fs/promises'

export const dynamic = 'force-dynamic'

const TAMIAS_DIR = join(homedir(), '.tamias')

// Files/patterns to hide at the root level of ~/.tamias
const ROOT_HIDE_LIST = ['.env', /\.sql$/i]

function isHidden(name: string, isRoot: boolean): boolean {
	if (isRoot) {
		return ROOT_HIDE_LIST.some(rule =>
			typeof rule === 'string' ? rule === name : rule.test(name)
		)
	}
	return false
}

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url)
	const rawPath = searchParams.get('path') || ''

	// Resolve path relative to ~/.tamias
	// Accept either empty/root or a sub-path like "my-repo" or "my-repo/subdir"
	const safeSub = rawPath
		.replace(/^~\/\.tamias\/?/, '') // strip prefix if user sends full path
		.replace(/^\/+/, '')

	const targetPath = safeSub ? join(TAMIAS_DIR, safeSub) : TAMIAS_DIR

	// Security: ensure we stay within ~/.tamias
	if (!targetPath.startsWith(TAMIAS_DIR)) {
		return NextResponse.json({ error: 'Access denied' }, { status: 403 })
	}

	const isRoot = targetPath === TAMIAS_DIR

	try {
		const entries = await readdir(targetPath, { withFileTypes: true })
		const items = await Promise.all(
			entries
				.filter(e => !isHidden(e.name, isRoot))
				.map(async (e) => {
					const fullPath = join(targetPath, e.name)
					let size: number | null = null
					try {
						const s = await stat(fullPath)
						size = s.size
					} catch {
						// ignore
					}
					return {
						name: e.name,
						isDirectory: e.isDirectory(),
						isFile: e.isFile(),
						size,
						path: safeSub ? `${safeSub}/${e.name}` : e.name,
					}
				})
		)

		// Sort: directories first, then files, both alphabetically
		items.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
			return a.name.localeCompare(b.name)
		})

		return NextResponse.json({ items, path: safeSub || '' })
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			return NextResponse.json({ error: 'Not found' }, { status: 404 })
		}
		return NextResponse.json({ error: 'Failed to read directory' }, { status: 500 })
	}
}

// Rename: PATCH /api/files?path=<relative> { newName: string }
export async function PATCH(request: NextRequest) {
	const { searchParams } = new URL(request.url)
	const rawPath = searchParams.get('path') || ''

	const safeSub = rawPath
		.replace(/^~\/\.tamias\/?/, '')
		.replace(/^\/+/, '')

	if (!safeSub) {
		return NextResponse.json({ error: 'No path provided' }, { status: 400 })
	}

	const oldFull = join(TAMIAS_DIR, safeSub)

	if (!oldFull.startsWith(TAMIAS_DIR)) {
		return NextResponse.json({ error: 'Access denied' }, { status: 403 })
	}

	try {
		const { newName } = await request.json() as { newName?: string }
		if (!newName || typeof newName !== 'string' || newName.includes('/') || newName.includes('\\')) {
			return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
		}

		const newFull = join(dirname(oldFull), newName)

		if (!newFull.startsWith(TAMIAS_DIR)) {
			return NextResponse.json({ error: 'Access denied' }, { status: 403 })
		}

		// Verify old path exists
		await stat(oldFull)
		await rename(oldFull, newFull)

		const parentSub = safeSub.includes('/') ? safeSub.split('/').slice(0, -1).join('/') : ''
		const newSubPath = parentSub ? `${parentSub}/${newName}` : newName

		return NextResponse.json({ success: true, newPath: newSubPath })
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			return NextResponse.json({ error: 'Not found' }, { status: 404 })
		}
		if (err.code === 'EEXIST') {
			return NextResponse.json({ error: 'A file with that name already exists' }, { status: 409 })
		}
		return NextResponse.json({ error: 'Failed to rename' }, { status: 500 })
	}
}

// Remove: DELETE /api/files?path=<relative>
export async function DELETE(request: NextRequest) {
	const { searchParams } = new URL(request.url)
	const rawPath = searchParams.get('path') || ''

	const safeSub = rawPath
		.replace(/^~\/\.tamias\/?/, '')
		.replace(/^\/+/, '')

	if (!safeSub) {
		return NextResponse.json({ error: 'Cannot delete root' }, { status: 400 })
	}

	const targetPath = join(TAMIAS_DIR, safeSub)

	if (!targetPath.startsWith(TAMIAS_DIR) || targetPath === TAMIAS_DIR) {
		return NextResponse.json({ error: 'Access denied' }, { status: 403 })
	}

	try {
		await stat(targetPath) // throws ENOENT if missing
		await rm(targetPath, { recursive: true, force: false })
		return NextResponse.json({ success: true })
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			return NextResponse.json({ error: 'Not found' }, { status: 404 })
		}
		return NextResponse.json({ error: 'Failed to remove' }, { status: 500 })
	}
}
