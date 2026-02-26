/**
 * Integration tests for the file navigator API routes.
 *
 * Strategy: mock `os.homedir` to point at a real temp directory so that
 * TAMIAS_DIR inside each route resolves to `<tmpdir>/.tamias`.
 * Dynamic imports are used so the mock is in place before the modules evaluate.
 */

import { describe, expect, test, beforeAll, afterAll, mock } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir as realHomedir } from 'os'
import { NextRequest } from 'next/server'

// ─── Temp filesystem setup ────────────────────────────────────────────────────

const fakeHome = await mkdtemp(join(tmpdir(), 'tamias-files-test-'))
const fakeTamiasDir = join(fakeHome, '.tamias')

// Mock `os` homedir BEFORE the route modules are imported.
// The re-export of all other os members keeps next/server happy.
import * as osModule from 'os'
mock.module('os', () => ({
	...osModule,
	homedir: () => fakeHome,
}))

// Populate the fake ~/.tamias with a known structure for tests.
await mkdir(fakeTamiasDir, { recursive: true })
await mkdir(join(fakeTamiasDir, 'my-repo'), { recursive: true })
await mkdir(join(fakeTamiasDir, 'my-repo', 'sub'), { recursive: true })
await writeFile(join(fakeTamiasDir, 'notes.md'), '# Hello\nWorld', 'utf8')
await writeFile(join(fakeTamiasDir, 'data.json'), '{"key":"value"}', 'utf8')
await writeFile(join(fakeTamiasDir, 'script.ts'), 'export const x = 1', 'utf8')
await writeFile(join(fakeTamiasDir, '.env'), 'SECRET=abc', 'utf8')          // must be hidden at root
await writeFile(join(fakeTamiasDir, 'dump.sql'), 'SELECT 1;', 'utf8')       // must be hidden at root
await writeFile(join(fakeTamiasDir, 'my-repo', 'README.md'), '# Repo', 'utf8')
await writeFile(join(fakeTamiasDir, 'my-repo', 'sub', 'deep.txt'), 'deep', 'utf8')

// Dynamic imports — route modules evaluate AFTER the mock above is registered.
const { GET: listDir, PATCH: renameEntry, DELETE: removeEntry } =
	await import('../app/api/files/route')
const { GET: readContent, PUT: writeContent } =
	await import('../app/api/files/content/route')

afterAll(async () => {
	await rm(fakeHome, { recursive: true, force: true })
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return new NextRequest(new URL(url, 'http://localhost:3000'), init as any)
}

// ─── GET /api/files ───────────────────────────────────────────────────────────

describe('GET /api/files – list directory', () => {
	test('lists root without hidden files', async () => {
		const res = await listDir(req('/api/files?path='))
		expect(res.status).toBe(200)
		const { items } = await res.json() as { items: Array<{ name: string; isDirectory: boolean }> }
		const names = items.map(i => i.name)

		expect(names).toContain('my-repo')
		expect(names).toContain('notes.md')
		expect(names).toContain('data.json')
		expect(names).toContain('script.ts')

		// Hidden at root
		expect(names).not.toContain('.env')
		expect(names).not.toContain('dump.sql')
	})

	test('sorts directories before files', async () => {
		const res = await listDir(req('/api/files?path='))
		const { items } = await res.json() as { items: Array<{ name: string; isDirectory: boolean }> }
		const dirs = items.filter(i => i.isDirectory)
		const files = items.filter(i => !i.isDirectory)

		// All dirs before all files
		const lastDirIdx = Math.max(...dirs.map(d => items.indexOf(d)))
		const firstFileIdx = Math.min(...files.map(f => items.indexOf(f)))
		expect(lastDirIdx).toBeLessThan(firstFileIdx)
	})

	test('lists a subdirectory', async () => {
		const res = await listDir(req('/api/files?path=my-repo'))
		expect(res.status).toBe(200)
		const { items } = await res.json() as { items: Array<{ name: string }> }
		const names = items.map(i => i.name)
		expect(names).toContain('README.md')
		expect(names).toContain('sub')
	})

	test('lists a deeply nested directory', async () => {
		const res = await listDir(req('/api/files?path=my-repo/sub'))
		expect(res.status).toBe(200)
		const { items } = await res.json() as { items: Array<{ name: string }> }
		expect(items[0].name).toBe('deep.txt')
	})

	test('.env is not hidden inside a subdirectory', async () => {
		// Write a .env inside a sub-repo – it should be visible there
		await writeFile(join(fakeTamiasDir, 'my-repo', '.env'), 'NESTED=1', 'utf8')
		const res = await listDir(req('/api/files?path=my-repo'))
		const { items } = await res.json() as { items: Array<{ name: string }> }
		expect(items.map(i => i.name)).toContain('.env')
		// cleanup
		await rm(join(fakeTamiasDir, 'my-repo', '.env'))
	})

	test('returns 404 for non-existent path', async () => {
		const res = await listDir(req('/api/files?path=nonexistent'))
		expect(res.status).toBe(404)
	})

	test('returns 403 for path traversal attempt', async () => {
		const res = await listDir(req('/api/files?path=../../etc'))
		expect(res.status).toBe(403)
	})

	test('strips ~/,tamias prefix from path param', async () => {
		const res = await listDir(req('/api/files?path=~/.tamias/my-repo'))
		expect(res.status).toBe(200)
		const { items } = await res.json() as { items: Array<{ name: string }> }
		expect(items.map(i => i.name)).toContain('README.md')
	})

	test('each item path is relative to tamias root', async () => {
		const res = await listDir(req('/api/files?path=my-repo'))
		const { items } = await res.json() as { items: Array<{ name: string; path: string }> }
		const readme = items.find(i => i.name === 'README.md')
		expect(readme?.path).toBe('my-repo/README.md')
	})
})

// ─── PATCH /api/files ────────────────────────────────────────────────────────

describe('PATCH /api/files – rename', () => {
	test('renames a file at root level', async () => {
		await writeFile(join(fakeTamiasDir, 'rename-me.txt'), 'content', 'utf8')

		const res = await renameEntry(req('/api/files?path=rename-me.txt', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: 'renamed.txt' }),
		}))
		expect(res.status).toBe(200)
		const body = await res.json() as { success: boolean; newPath: string }
		expect(body.success).toBe(true)
		expect(body.newPath).toBe('renamed.txt')

		// Old gone, new exists
		expect(await Bun.file(join(fakeTamiasDir, 'rename-me.txt')).exists()).toBe(false)
		const content = await readFile(join(fakeTamiasDir, 'renamed.txt'), 'utf8')
		expect(content).toBe('content')
		await rm(join(fakeTamiasDir, 'renamed.txt'))
	})

	test('renames a file inside a subdirectory', async () => {
		await writeFile(join(fakeTamiasDir, 'my-repo', 'old.md'), '# old', 'utf8')

		const res = await renameEntry(req('/api/files?path=my-repo/old.md', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: 'new.md' }),
		}))
		expect(res.status).toBe(200)
		const body = await res.json() as { success: boolean; newPath: string }
		expect(body.newPath).toBe('my-repo/new.md')
		const content = await readFile(join(fakeTamiasDir, 'my-repo', 'new.md'), 'utf8')
		expect(content).toBe('# old')
		await rm(join(fakeTamiasDir, 'my-repo', 'new.md'))
	})

	test('renames a directory', async () => {
		await mkdir(join(fakeTamiasDir, 'old-dir'), { recursive: true })
		await writeFile(join(fakeTamiasDir, 'old-dir', 'file.txt'), 'hi', 'utf8')

		const res = await renameEntry(req('/api/files?path=old-dir', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: 'new-dir' }),
		}))
		expect(res.status).toBe(200)
		const content = await readFile(join(fakeTamiasDir, 'new-dir', 'file.txt'), 'utf8')
		expect(content).toBe('hi')
		await rm(join(fakeTamiasDir, 'new-dir'), { recursive: true })
	})

	test('returns 400 when path is empty', async () => {
		const res = await renameEntry(req('/api/files?path=', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: 'foo' }),
		}))
		expect(res.status).toBe(400)
	})

	test('returns 400 when newName contains a slash', async () => {
		const res = await renameEntry(req('/api/files?path=notes.md', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: 'evil/path.md' }),
		}))
		expect(res.status).toBe(400)
	})

	test('returns 400 when newName contains a backslash', async () => {
		const res = await renameEntry(req('/api/files?path=notes.md', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: 'evil\\path.md' }),
		}))
		expect(res.status).toBe(400)
	})

	test('returns 400 when newName is empty string', async () => {
		const res = await renameEntry(req('/api/files?path=notes.md', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: '' }),
		}))
		expect(res.status).toBe(400)
	})

	test('returns 404 when source does not exist', async () => {
		const res = await renameEntry(req('/api/files?path=ghost.txt', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newName: 'other.txt' }),
		}))
		expect(res.status).toBe(404)
	})
})

// ─── DELETE /api/files ────────────────────────────────────────────────────────

describe('DELETE /api/files – remove', () => {
	test('deletes a file', async () => {
		await writeFile(join(fakeTamiasDir, 'to-delete.txt'), 'bye', 'utf8')
		const res = await removeEntry(req('/api/files?path=to-delete.txt', { method: 'DELETE' }))
		expect(res.status).toBe(200)
		const body = await res.json() as { success: boolean }
		expect(body.success).toBe(true)
		expect(Bun.file(join(fakeTamiasDir, 'to-delete.txt')).exists()).resolves.toBe(false)
	})

	test('deletes a directory recursively', async () => {
		await mkdir(join(fakeTamiasDir, 'nuke-me', 'inside'), { recursive: true })
		await writeFile(join(fakeTamiasDir, 'nuke-me', 'inside', 'f.txt'), 'x', 'utf8')
		const res = await removeEntry(req('/api/files?path=nuke-me', { method: 'DELETE' }))
		expect(res.status).toBe(200)
		expect(Bun.file(join(fakeTamiasDir, 'nuke-me')).exists()).resolves.toBe(false)
	})

	test('returns 400 when path is empty (root protection)', async () => {
		const res = await removeEntry(req('/api/files?path=', { method: 'DELETE' }))
		expect(res.status).toBe(400)
	})

	test('returns 403 for path traversal attempt', async () => {
		const res = await removeEntry(req('/api/files?path=../../etc/passwd', { method: 'DELETE' }))
		expect(res.status).toBe(403)
	})

	test('returns 404 for non-existent entry', async () => {
		const res = await removeEntry(req('/api/files?path=does-not-exist.txt', { method: 'DELETE' }))
		expect(res.status).toBe(404)
	})
})

// ─── GET /api/files/content ───────────────────────────────────────────────────

describe('GET /api/files/content – read file', () => {
	test('reads a markdown file with correct type', async () => {
		const res = await readContent(req('/api/files/content?path=notes.md'))
		expect(res.status).toBe(200)
		const body = await res.json() as { type: string; content: string }
		expect(body.type).toBe('markdown')
		expect(body.content).toContain('Hello')
	})

	test('reads a JSON file with correct type', async () => {
		const res = await readContent(req('/api/files/content?path=data.json'))
		expect(res.status).toBe(200)
		const body = await res.json() as { type: string; content: string }
		expect(body.type).toBe('json')
		expect(JSON.parse(body.content)).toEqual({ key: 'value' })
	})

	test('reads a TypeScript file as code', async () => {
		const res = await readContent(req('/api/files/content?path=script.ts'))
		expect(res.status).toBe(200)
		const body = await res.json() as { type: string; content: string }
		expect(body.type).toBe('code')
		expect(body.content).toContain('export const x')
	})

	test('reads a nested file', async () => {
		const res = await readContent(req('/api/files/content?path=my-repo/README.md'))
		expect(res.status).toBe(200)
		const body = await res.json() as { type: string; content: string }
		expect(body.type).toBe('markdown')
		expect(body.content).toContain('Repo')
	})

	test('reads an SVG image as base64', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
		await writeFile(join(fakeTamiasDir, 'icon.svg'), svg, 'utf8')
		const res = await readContent(req('/api/files/content?path=icon.svg'))
		expect(res.status).toBe(200)
		const body = await res.json() as { type: string; base64: string; mimeType: string }
		expect(body.type).toBe('image')
		expect(body.mimeType).toBe('image/svg+xml')
		expect(Buffer.from(body.base64, 'base64').toString('utf8')).toBe(svg)
		await rm(join(fakeTamiasDir, 'icon.svg'))
	})

	test('returns size in response', async () => {
		const res = await readContent(req('/api/files/content?path=notes.md'))
		const body = await res.json() as { size: number }
		expect(typeof body.size).toBe('number')
		expect(body.size).toBeGreaterThan(0)
	})

	test('returns 400 when path is empty', async () => {
		const res = await readContent(req('/api/files/content?path='))
		expect(res.status).toBe(400)
	})

	test('returns 404 for non-existent file', async () => {
		const res = await readContent(req('/api/files/content?path=no-such-file.md'))
		expect(res.status).toBe(404)
	})

	test('returns 403 for path traversal attempt', async () => {
		const res = await readContent(req('/api/files/content?path=../../etc/passwd'))
		expect(res.status).toBe(403)
	})

	test('strips ~/,tamias prefix in path param', async () => {
		const res = await readContent(req('/api/files/content?path=~/.tamias/notes.md'))
		expect(res.status).toBe(200)
		const body = await res.json() as { type: string }
		expect(body.type).toBe('markdown')
	})
})

// ─── PUT /api/files/content ───────────────────────────────────────────────────

describe('PUT /api/files/content – write file', () => {
	test('writes content to an existing file', async () => {
		await writeFile(join(fakeTamiasDir, 'editable.md'), '# Before', 'utf8')

		const res = await writeContent(req('/api/files/content?path=editable.md', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: '# After' }),
		}))
		expect(res.status).toBe(200)
		const body = await res.json() as { success: boolean }
		expect(body.success).toBe(true)

		const saved = await readFile(join(fakeTamiasDir, 'editable.md'), 'utf8')
		expect(saved).toBe('# After')
		await rm(join(fakeTamiasDir, 'editable.md'))
	})

	test('creates a new file if it does not exist', async () => {
		const res = await writeContent(req('/api/files/content?path=new-file.txt', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: 'brand new' }),
		}))
		expect(res.status).toBe(200)
		const saved = await readFile(join(fakeTamiasDir, 'new-file.txt'), 'utf8')
		expect(saved).toBe('brand new')
		await rm(join(fakeTamiasDir, 'new-file.txt'))
	})

	test('returns 400 when content is not a string', async () => {
		const res = await writeContent(req('/api/files/content?path=notes.md', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: 42 }),
		}))
		expect(res.status).toBe(400)
	})

	test('returns 400 when path is empty', async () => {
		const res = await writeContent(req('/api/files/content?path=', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: 'x' }),
		}))
		expect(res.status).toBe(400)
	})

	test('returns 403 for path traversal attempt', async () => {
		const res = await writeContent(req('/api/files/content?path=../../evil.txt', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: 'hacked' }),
		}))
		expect(res.status).toBe(403)
	})
})
