import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getWorkspacePath, setWorkspacePath } from '../utils/config.ts'
import { existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

export const runWorkspaceCommand = async (newPath?: string) => {
	const currentPath = getWorkspacePath()

	if (newPath) {
		const absolutePath = resolve(newPath.replace(/^~/, homedir()))
		try {
			if (!existsSync(absolutePath)) {
				const confirm = await p.confirm({
					message: `Directory ${pc.cyan(absolutePath)} does not exist. Create it?`,
					initialValue: true,
				})
				if (p.isCancel(confirm) || !confirm) {
					p.cancel('Cancelled.')
					process.exit(0)
				}
				mkdirSync(absolutePath, { recursive: true })
			}
			setWorkspacePath(absolutePath)
			p.outro(pc.green(`✅ Workspace path updated to: ${pc.bold(absolutePath)}`))
		} catch (err) {
			p.cancel(pc.red(`❌ Failed to set workspace path: ${err}`))
			process.exit(1)
		}
		return
	}

	p.intro(pc.bgBlue(pc.white(' Tamias — Workspace Management ')))

	p.note(`Current Restricted Workspace: ${pc.bold(pc.cyan(currentPath))}`, 'Status')

	const action = await p.select({
		message: 'What would you like to do?',
		options: [
			{ value: 'view', label: '👁️  View current path' },
			{ value: 'change', label: '✏️  Change workspace path' },
			{ value: 'exit', label: '🚪 Exit' },
		],
	})

	if (p.isCancel(action) || action === 'exit') {
		p.outro('Done.')
		return
	}

	if (action === 'view') {
		p.outro(`Current path: ${pc.cyan(currentPath)}`)
		return
	}

	if (action === 'change') {
		const result = await p.text({
			message: 'Enter new workspace path:',
			placeholder: currentPath,
			validate: (v) => {
				if (!v) return 'Path is required'
			},
		})

		if (p.isCancel(result)) {
			p.cancel('Cancelled.')
			return
		}

		await runWorkspaceCommand(result as string)
	}
}
