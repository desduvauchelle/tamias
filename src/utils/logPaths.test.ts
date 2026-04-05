import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
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

	test('paginates daemon.log to 200 lines and writes overflow pages', async () => {
		const root = join(tmpdir(), `tamias-logs-pagination-${Date.now()}`)
		process.env.TAMIAS_DIR = root

		try {
			mkdirSync(join(root, 'logs'), { recursive: true })
			const daemonLog = join(root, 'logs', 'daemon.log')
			const lines = Array.from({ length: 450 }, (_, i) => `line-${i + 1}`)
			writeFileSync(daemonLog, `${lines.join('\n')}\n`, 'utf8')

			const { paginateLogByLines, getLogFilePath, getLogsDirPath } = await import('./logPaths.ts')
			const result = paginateLogByLines('daemon.log', 200)

			expect(result.activeLines).toBe(200)
			expect(result.overflowLines).toBe(250)
			expect(result.pagesCreated).toBe(2)

			const logsDir = getLogsDirPath()
			const files = readdirSync(logsDir).sort()
			expect(files).toContain('daemon.log')
			expect(files).toContain('daemon.page-0001.log')
			expect(files).toContain('daemon.page-0002.log')

			const active = readFileSync(getLogFilePath('daemon.log'), 'utf8').trim().split('\n')
			expect(active[0]).toBe('line-251')
			expect(active[199]).toBe('line-450')
			expect(active.length).toBe(200)

			const page1 = readFileSync(join(logsDir, 'daemon.page-0001.log'), 'utf8').trim().split('\n')
			expect(page1[0]).toBe('line-1')
			expect(page1[199]).toBe('line-200')
			expect(page1.length).toBe(200)

			const page2 = readFileSync(join(logsDir, 'daemon.page-0002.log'), 'utf8').trim().split('\n')
			expect(page2[0]).toBe('line-201')
			expect(page2[49]).toBe('line-250')
			expect(page2.length).toBe(50)
		} finally {
			delete process.env.TAMIAS_DIR
			rmSync(root, { recursive: true, force: true })
		}
	})

	test('continues page numbering across repeated pagination runs', async () => {
		const root = join(tmpdir(), `tamias-logs-pagination-repeat-${Date.now()}`)
		process.env.TAMIAS_DIR = root

		try {
			mkdirSync(join(root, 'logs'), { recursive: true })
			const daemonLog = join(root, 'logs', 'daemon.log')
			const firstBatch = Array.from({ length: 230 }, (_, i) => `first-${i + 1}`)
			writeFileSync(daemonLog, `${firstBatch.join('\n')}\n`, 'utf8')

			const { paginateLogByLines, getLogsDirPath } = await import('./logPaths.ts')
			const firstResult = paginateLogByLines('daemon.log', 200)
			expect(firstResult.pagesCreated).toBe(1)

			const secondBatch = Array.from({ length: 220 }, (_, i) => `second-${i + 1}`)
			writeFileSync(daemonLog, `${secondBatch.join('\n')}\n`, 'utf8')
			const secondResult = paginateLogByLines('daemon.log', 200)
			expect(secondResult.pagesCreated).toBe(1)

			const files = readdirSync(getLogsDirPath()).sort()
			expect(files).toContain('daemon.page-0001.log')
			expect(files).toContain('daemon.page-0002.log')
		} finally {
			delete process.env.TAMIAS_DIR
			rmSync(root, { recursive: true, force: true })
		}
	})

	test('returns without changes when line count is below threshold', async () => {
		const root = join(tmpdir(), `tamias-logs-pagination-small-${Date.now()}`)
		process.env.TAMIAS_DIR = root

		try {
			mkdirSync(join(root, 'logs'), { recursive: true })
			const daemonLog = join(root, 'logs', 'daemon.log')
			writeFileSync(daemonLog, 'a\nb\nc\n', 'utf8')

			const { paginateLogByLines, getLogsDirPath } = await import('./logPaths.ts')
			const result = paginateLogByLines('daemon.log', 200)

			expect(result.activeLines).toBe(3)
			expect(result.overflowLines).toBe(0)
			expect(result.pagesCreated).toBe(0)
			const files = readdirSync(getLogsDirPath())
			expect(files.filter(f => f.startsWith('daemon.page-')).length).toBe(0)
		} finally {
			delete process.env.TAMIAS_DIR
			rmSync(root, { recursive: true, force: true })
		}
	})
})
