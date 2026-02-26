import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const rootDir = join(import.meta.dir, '../../')
const packagePaths = [
	join(rootDir, 'package.json'),
	join(rootDir, 'src/dashboard/package.json'),
]

const now = new Date()
const yy = String(now.getFullYear()).slice(-2)
const mm = String(now.getMonth() + 1) // no leading zero
const dd = String(now.getDate()) // no leading zero
const todayPrefix = `${yy}.${mm}.${dd}`

// Read current version from root package.json
const rootPkg = JSON.parse(readFileSync(packagePaths[0], 'utf-8'))
const currentVersion: string = rootPkg.version

// Parse current version
const parts = currentVersion.split('.')
const currentPrefix = parts.slice(0, 3).join('.')
const currentIncrement = parseInt(parts[3] ?? '0', 10)

const newIncrement = currentPrefix === todayPrefix ? currentIncrement + 1 : 1
const newVersion = `${todayPrefix}.${newIncrement}`

for (const pkgPath of packagePaths) {
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
	pkg.version = newVersion
	writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n')
}

console.log(`Version bumped: ${currentVersion} → ${newVersion}`)
