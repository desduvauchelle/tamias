import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	getAllEmailConfigs,
	getEmailConfig,
	deleteEmailConfig,
	renameEmailConfig,
	updateEmailConfig,
	setEmailConfig,
} from '../utils/config.ts'
import { generateSecureEnvKey, setEnv } from '../utils/env.ts'
import { hasDependency, ensureDependency } from '../utils/dependencies.ts'

/**
 * Display all configured email accounts
 */
export const runEmailsListCommand = async () => {
	if (!hasDependency('himalaya')) {
		p.log.warn(pc.yellow('⚠️  The "himalaya" CLI is missing. Email tools will not function. Run "tamias doctor" to fix.'))
	}
	p.intro(pc.bgBlue(pc.white(' Tamias — Email Accounts ')))
	const emails = getAllEmailConfigs()
	const emailList = Object.values(emails)

	if (emailList.length === 0) {
		console.log(pc.yellow('\n  No email accounts configured. Run `tamias emails add` to add one.'))
	} else {
		console.log(pc.bold(`\n  Found ${pc.cyan(emailList.length)} email account(s):`))
		console.log('')
		for (const email of emailList) {
			const status = email.enabled ? pc.green('enabled') : pc.dim('disabled')
			const def = email.isDefault ? pc.yellow(' [default]') : ''
			console.log(`  ${pc.bold(pc.cyan(email.nickname))}  ${pc.dim(email.accountName)}  (${status})${def}`)
			if (email.permissions?.whitelist?.length > 0) {
				console.log(`    ${pc.dim('Whitelist:')} ${email.permissions.whitelist.join(', ')}`)
			}
		}
		console.log('')
	}
	p.outro(pc.dim('Config stored at: ~/.tamias/config.json'))
}

/**
 * Add a new email account
 */
export const runEmailsAddCommand = async () => {
	await ensureDependency('himalaya') // Prompt to install if missing

	p.intro(pc.bgGreen(pc.white(' Tamias — Add Email Account ')))

	const nickname = await p.text({
		message: 'Enter a nickname for this account (e.g. personal, work):',
		validate: (v) => {
			if (!v) return 'Nickname is required'
			if (/\s/.test(v)) return 'Nickname cannot contain spaces'
			if (getEmailConfig(v)) return 'Nickname already exists'
		},
	})
	if (p.isCancel(nickname)) { p.cancel('Cancelled.'); process.exit(0) }

	const accountName = await p.text({
		message: 'Enter the Himalaya account name (from your himalaya config.toml):',
		placeholder: nickname as string,
		initialValue: nickname as string,
	})
	if (p.isCancel(accountName)) { p.cancel('Cancelled.'); process.exit(0) }

	const appPassword = await p.password({
		message: 'Enter your Gmail App Password (will be stored securely in .env):',
		validate: (v) => { if (!v) return 'Password is required' },
	})
	if (p.isCancel(appPassword)) { p.cancel('Cancelled.'); process.exit(0) }

	const whitelistInput = await p.text({
		message: 'Enter authorized recipient emails (comma separated, leave empty for no whitelist):',
	})
	if (p.isCancel(whitelistInput)) { p.cancel('Cancelled.'); process.exit(0) }
	const whitelist = (whitelistInput as string).split(',').map(s => s.trim()).filter(Boolean)

	const isDefault = await p.confirm({
		message: 'Set as default email account?',
		initialValue: Object.keys(getAllEmailConfigs()).length === 0,
	})
	if (p.isCancel(isDefault)) { p.cancel('Cancelled.'); process.exit(0) }

	try {
		const envKey = generateSecureEnvKey(`EMAIL_${(nickname as string).toUpperCase()}`)
		setEnv(envKey, appPassword as string)

		setEmailConfig(nickname as string, {
			nickname: nickname as string,
			enabled: true,
			accountName: accountName as string,
			envKeyName: envKey,
			isDefault: isDefault as boolean,
			permissions: { whitelist },
		})

		p.outro(pc.green(`✅ Email account '${nickname}' added successfully.`))
	} catch (err) {
		p.cancel(pc.red(`❌ ${err}`))
		process.exit(1)
	}
}

/**
 * Edit an existing email account
 */
export const runEmailsEditCommand = async (slug?: string) => {
	p.intro(pc.bgYellow(pc.black(' Tamias — Edit Email Account ')))
	const emails = getAllEmailConfigs()

	if (Object.keys(emails).length === 0) {
		p.cancel(pc.yellow('No email accounts to edit.'))
		process.exit(0)
	}

	let chosen = slug
	if (!chosen) {
		const result = await p.select({
			message: 'Which email account do you want to edit?',
			options: Object.values(emails).map((e) => ({
				value: e.nickname,
				label: `${pc.bold(e.nickname)} ${pc.dim(`(${e.accountName})`)}`,
			})),
		})
		if (p.isCancel(result)) { p.cancel('Cancelled.'); process.exit(0) }
		chosen = result as string
	}

	const config = emails[chosen]
	if (!config) {
		p.cancel(pc.red(`Email account '${chosen}' not found.`))
		process.exit(1)
	}

	const fields = await p.multiselect({
		message: `Editing ${pc.bold(chosen)}. What do you want to change?`,
		options: [
			{ value: 'nickname', label: '✏️  Rename nickname' },
			{ value: 'accountName', label: '🏷️  Himalaya account name' },
			{ value: 'password', label: '🔑 Update App Password' },
			{ value: 'whitelist', label: '📜 Update Whitelist' },
			{ value: 'toggle', label: config.enabled ? '❌ Disable' : '✅ Enable' },
			{ value: 'default', label: '⭐️ Set as default' },
		],
		required: true,
	})
	if (p.isCancel(fields)) { p.cancel('Cancelled.'); process.exit(0) }

	const selected = fields as string[]
	const updates: any = {}

	if (selected.includes('nickname')) {
		const newNickname = await p.text({
			message: 'New nickname:',
			validate: (v) => {
				if (!v) return 'Required'
				if (/\s/.test(v)) return 'No spaces'
				if (v !== chosen && getEmailConfig(v)) return 'Nickname already exists'
			},
		})
		if (p.isCancel(newNickname)) { p.cancel('Cancelled.'); process.exit(0) }
		renameEmailConfig(chosen, newNickname as string)
		chosen = newNickname as string
	}

	if (selected.includes('accountName')) {
		const newVal = await p.text({ message: 'New Himalaya account name:' })
		if (p.isCancel(newVal)) { p.cancel('Cancelled.'); process.exit(0) }
		updates.accountName = newVal
	}

	if (selected.includes('password')) {
		const newVal = await p.password({ message: 'New App Password:' })
		if (p.isCancel(newVal)) { p.cancel('Cancelled.'); process.exit(0) }
		const envKey = config.envKeyName || generateSecureEnvKey(`EMAIL_${chosen.toUpperCase()}`)
		setEnv(envKey, newVal as string)
		updates.envKeyName = envKey
	}

	if (selected.includes('whitelist')) {
		const newVal = await p.text({
			message: 'Authorized recipient emails (comma separated):',
			initialValue: config.permissions?.whitelist?.join(', ') || '',
		})
		if (p.isCancel(newVal)) { p.cancel('Cancelled.'); process.exit(0) }
		updates.permissions = {
			...config.permissions,
			whitelist: (newVal as string).split(',').map(s => s.trim()).filter(Boolean)
		}
	}

	if (selected.includes('toggle')) {
		updates.enabled = !config.enabled
	}

	if (selected.includes('default')) {
		updates.isDefault = true
	}

	try {
		updateEmailConfig(chosen, updates)
		p.outro(pc.green(`✅ Email account '${chosen}' updated.`))
	} catch (err) {
		p.cancel(pc.red(`❌ ${err}`))
		process.exit(1)
	}
}

/**
 * Delete an email account
 */
export const runEmailsDeleteCommand = async (slug?: string) => {
	p.intro(pc.bgRed(pc.white(' Tamias — Delete Email Account ')))
	const emails = getAllEmailConfigs()

	if (Object.keys(emails).length === 0) {
		p.cancel(pc.yellow('No email accounts to delete.'))
		process.exit(0)
	}

	let chosen = slug
	if (!chosen) {
		const result = await p.select({
			message: 'Which email account do you want to delete?',
			options: Object.values(emails).map((e) => ({
				value: e.nickname,
				label: `${pc.bold(e.nickname)} ${pc.dim(`(${e.accountName})`)}`,
			})),
		})
		if (p.isCancel(result)) { p.cancel('Cancelled.'); process.exit(0) }
		chosen = result as string
	}

	const confirmed = await p.confirm({
		message: `Are you sure you want to delete ${pc.bold(pc.red(chosen))}? This will NOT remove secrets from your .env but will remove it from config.json.`,
		initialValue: false,
	})
	if (p.isCancel(confirmed) || !confirmed) { p.cancel('Cancelled.'); process.exit(0) }

	try {
		deleteEmailConfig(chosen)
		p.outro(pc.green(`✅ Email account '${chosen}' deleted.`))
	} catch (err) {
		p.cancel(pc.red(`❌ ${err}`))
		process.exit(1)
	}
}

/**
 * Main interactive menu
 */
export const runEmailsCommand = async () => {
	p.intro(pc.bgBlue(pc.white(' Tamias — Email Management ')))

	const action = await p.select({
		message: 'What would you like to do?',
		options: [
			{ value: 'list', label: '📋 List email accounts' },
			{ value: 'add', label: '➕ Add an email account' },
			{ value: 'edit', label: '✏️  Edit an email account' },
			{ value: 'delete', label: '🗑️  Delete an email account' },
		],
	})

	if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0) }

	switch (action) {
		case 'list': return runEmailsListCommand()
		case 'add': return runEmailsAddCommand()
		case 'edit': return runEmailsEditCommand()
		case 'delete': return runEmailsDeleteCommand()
	}
}
