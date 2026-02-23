import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync } from 'fs'

// Generate a truly isolated temporary config path for each test run
const testId = `tamias-test-${Date.now()}`
const testConfigPath = join(tmpdir(), testId, 'config.json')

process.env.TAMIAS_CONFIG_PATH = testConfigPath
process.env.NODE_ENV = 'test'

// Optional: isolate the entire tamias directory if needed
// process.env.TAMIAS_DIR = join(tmpdir(), testId)

const dir = join(tmpdir(), testId)
if (!existsSync(dir)) {
	mkdirSync(dir, { recursive: true })
}

console.log(`[test-setup] Isolated config path: ${testConfigPath}`)
