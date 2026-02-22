import { validatePath } from '../utils/path.ts'
import { getWorkspacePath } from '../utils/config.ts'
import { realpathSync } from 'fs'

const root = getWorkspacePath()
console.log(`Workspace root: ${root}`)

try {
	console.log('Testing path inside workspace...')
	const inside = validatePath('test.txt')
	console.log(`✅ Success: ${inside}`)
} catch (e: any) {
	console.log(`❌ Failed: ${e.message}`)
}

try {
	console.log('Testing path outside workspace (/etc/passwd)...')
	validatePath('/etc/passwd')
	console.log('❌ Error: Should have blocked access to /etc/passwd')
} catch (e: any) {
	console.log(`✅ Success (Blocked): ${e.message}`)
}

try {
	console.log('Testing path outside workspace (~/.ssh)...')
	validatePath('~/.ssh')
	console.log('❌ Error: Should have blocked access to ~/.ssh')
} catch (e: any) {
	console.log(`✅ Success (Blocked): ${e.message}`)
}

try {
	console.log('Testing relative path escaping (../../)...')
	validatePath('../../etc/passwd')
	console.log('❌ Error: Should have blocked escaping via ..')
} catch (e: any) {
	console.log(`✅ Success (Blocked): ${e.message}`)
}
