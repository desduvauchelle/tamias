import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('log paths helper', () => {
	test('returns canonical logs path and migrates legacy file', async () => {
		const root = join(tmpdir(), `tamias-logs-paths-${Date.now()}`)
		process.env.TAMIAS_DIR = root

		try {
			mkdirSync(root, { recursive: true })
			const legacy = join(root, 'daemon.log')
			writeFileSync(legacy, 'legacy line', 'utf8')

			const { getLogFilePath, getLogsDirPath } = await import('./logPaths.ts')
			const canonical = getLogFilePath('daemon.log')
			expect(canonical).toBe(join(root, 'logs', 'daemon.log'))
			expect(getLogsDirPath()).toBe(join(root, 'logs'))
			expect(existsSync(canonical)).toBe(true)
			expect(readFileSync(canonical, 'utf8')).toContain('legacy line')
		} finally {
			delete process.env.TAMIAS_DIR
			rmSync(root, { recursive: true, force: true })
		}
	})
})
