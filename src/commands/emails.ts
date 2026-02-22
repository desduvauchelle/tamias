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
			const serviceLabel = pc.dim(`(${email.service || 'gmail'})`)
			console.log(`  ${pc.bold(pc.cyan(email.nickname))}  ${pc.dim(email.email || email.accountName)}  ${serviceLabel}  (${status})${def}`)
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

	// 1. Service Selection
	const service = await p.select({
		message: 'Select your email provider:',
		options: [
			{ value: 'gmail', label: 'Gmail (recommmended — uses App Passwords)' },
			{ value: 'outlook', label: 'Outlook' },
			{ value: 'icloud', label: 'iCloud' },
			{ value: 'other', label: 'Other (custom SMTP/IMAP)' },
		],
	})
	if (p.isCancel(service)) { p.cancel('Cancelled.'); process.exit(0) }

	// 2. Email Address
	const email = await p.text({
		message: 'Enter your email address:',
		placeholder: 'you@example.com',
		validate: (v) => {
			if (!v) return 'Email is required'
			if (!v.includes('@')) return 'Invalid email address'
		},
	})
	if (p.isCancel(email)) { p.cancel('Cancelled.'); process.exit(0) }

	// 3. Password / App Password
	const passMsg = service === 'gmail'
		? 'Enter your Gmail App Password (will be stored securely in .env):'
		: 'Enter your email password (will be stored securely in .env):'

	const appPassword = await p.password({
		message: passMsg,
		validate: (v) => { if (!v) return 'Password is required' },
	})
	if (p.isCancel(appPassword)) { p.cancel('Cancelled.'); process.exit(0) }

	// 4. Himalaya Account ID
	const accountName = await p.text({
		message: 'Himalaya Account ID (Internal ID for himalaya CLI):',
		placeholder: email as string,
		initialValue: email as string,
	})
	if (p.isCancel(accountName)) { p.cancel('Cancelled.'); process.exit(0) }

	// 5. Whitelist / Permissions
	const whitelistInput = await p.text({
		message: 'Authorized recipient emails (comma separated, leave empty for no whitelist):',
	})
	if (p.isCancel(whitelistInput)) { p.cancel('Cancelled.'); process.exit(0) }
	const whitelist = (whitelistInput as string).split(',').map(s => s.trim()).filter(Boolean)

	// 6. Default Flag
	const isDefault = await p.confirm({
		message: 'Set as default email account?',
		initialValue: Object.keys(getAllEmailConfigs()).length === 0,
	})
	if (p.isCancel(isDefault)) { p.cancel('Cancelled.'); process.exit(0) }

	// 7. Nickname (Last)
	const nickname = await p.text({
		message: 'Give this account a nickname (e.g. Personal, Work, Tech):',
		placeholder: 'Personal',
		validate: (v) => {
			if (!v) return 'Nickname is required'
			if (/\s/.test(v)) return 'Nickname cannot contain spaces'
			if (getEmailConfig(v)) return 'Nickname already exists'
		},
	})
	if (p.isCancel(nickname)) { p.cancel('Cancelled.'); process.exit(0) }

	try {
		const envKey = generateSecureEnvKey(`EMAIL_${(nickname as string).toUpperCase()}`)
		setEnv(envKey, appPassword as string)

		setEmailConfig(nickname as string, {
			nickname: nickname as string,
			email: email as string,
			service: service as string,
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
			{ value: 'service', label: '🌐  Email service (Gmail, Outlook...)' },
			{ value: 'email', label: '📧  Email address' },
			{ value: 'accountName', label: '🏷️  Himalaya account name' },
			{ value: 'password', label: '🔑 Update App Password' },
			{ value: 'whitelist', label: '📜 Update Whitelist' },
			{ value: 'canSend', label: config.permissions?.canSend ? '❌ Disable "Can Send"' : '✅ Enable "Can Send"' },
			{ value: 'toggle', label: config.enabled ? '❌ Disable Account' : '✅ Enable Account' },
			{ value: 'default', label: '⭐️ Set as default' },
		],
		required: true,
	})
	if (p.isCancel(fields)) { p.cancel('Cancelled.'); process.exit(0) }

	const selected = fields as string[]
	const updates: any = {}

	if (selected.includes('nickname')) {
		const newNickname = await p.text({
			message: 'New Display Name:',
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

	if (selected.includes('service')) {
		const newVal = await p.select({
			message: 'Select email provider:',
			options: [
				{ value: 'gmail', label: 'Gmail' },
				{ value: 'outlook', label: 'Outlook' },
				{ value: 'icloud', label: 'iCloud' },
				{ value: 'other', label: 'Other' },
			],
		})
		if (p.isCancel(newVal)) { p.cancel('Cancelled.'); process.exit(0) }
		updates.service = newVal
	}

	if (selected.includes('email')) {
		const newVal = await p.text({
			message: 'New email address:',
			initialValue: config.email,
			validate: (v) => {
				if (!v) return 'Required'
				if (!v.includes('@')) return 'Invalid email'
			}
		})
		if (p.isCancel(newVal)) { p.cancel('Cancelled.'); process.exit(0) }
		updates.email = newVal
	}

	if (selected.includes('accountName')) {
		const newVal = await p.text({ message: 'New Himalaya Account ID (from config.toml):' })
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

	if (selected.includes('canSend')) {
		updates.permissions = {
			...(updates.permissions || config.permissions),
			canSend: !config.permissions?.canSend
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
