import { tool } from 'ai'
import { z } from 'zod'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getEmailConfig, getEmailPassword } from '../utils/config.ts'
import { hasDependency } from '../utils/dependencies.ts'

const execAsync = promisify(exec)

export const emailTools = {

	list_emails: tool({
		description: 'List recent email envelopes using the himalaya CLI.',
		inputSchema: z.object({
			account: z.string().optional().describe('Nickname of the email account to use'),
			page: z.number().optional().default(1).describe('Page number to list'),
			pageSize: z.number().optional().default(10).describe('Number of emails per page'),
		}),
		execute: async ({ account, page, pageSize }: { account?: string; page: number; pageSize: number }) => {
			if (!hasDependency('himalaya')) {
				return { success: false, error: 'The "himalaya" CLI is not installed. Please run "tamias doctor --fix" to install it automatically.' }
			}
			const config = getEmailConfig(account)
			if (!config || !config.enabled) {
				const errorMsg = account ? `Email account '${account}' is not configured or enabled.` : 'No email account is configured or enabled.'
				return { success: false, error: errorMsg }
			}

			try {
				console.log(`[daemon] Listing emails for account: ${config.nickname || config.accountName} (page ${page})`)
				const { stdout } = await execAsync(
					`himalaya --account ${config.accountName} envelope list --page ${page} --page-size ${pageSize} --output json`
				)
				const envelopes = JSON.parse(stdout)
				return { success: true, envelopes }
			} catch (err: any) {
				console.error(`[daemon] Failed to list emails: ${err.message}`)
				return { success: false, error: `Failed to list emails: ${err.message}` }
			}
		},
	}),

	read_email: tool({
		description: 'Read the full content of an email message by its ID.',
		inputSchema: z.object({
			account: z.string().optional().describe('Nickname of the email account to use'),
			id: z.string().describe('The ID of the email message to read'),
		}),
		execute: async ({ account, id }: { account?: string; id: string }) => {
			if (!hasDependency('himalaya')) {
				return { success: false, error: 'The "himalaya" CLI is not installed. Please run "tamias doctor --fix" to install it.' }
			}
			const config = getEmailConfig(account)
			if (!config) {
				return { success: false, error: account ? `Email account '${account}' not found.` : 'No email accounts configured.' }
			}
			if (!config.enabled) {
				return { success: false, error: `Email tool is disabled for account '${config.nickname}'.` }
			}

			try {
				console.log(`[daemon] Reading email ${id} using account: ${config.nickname}`)
				const { stdout } = await execAsync(`himalaya --account ${config.accountName} message read ${id}`)
				return { success: true, id, content: stdout }
			} catch (err: any) {
				console.error(`[daemon] Failed to read email ${id}: ${err.message}`)
				return { success: false, error: `Failed to read email ${id}: ${err.message}` }
			}
		},
	}),

	send_email: tool({
		description: 'Send an email to a recipient.',
		inputSchema: z.object({
			account: z.string().optional().describe('Nickname of the email account to use'),
			to: z.string().describe('Recipient email address'),
			subject: z.string().describe('Email subject line'),
			body: z.string().describe('Email message body content'),
		}),
		execute: async ({ account, to, subject, body }: { account?: string; to: string; subject: string; body: string }) => {
			if (!hasDependency('himalaya')) {
				return { success: false, error: 'The "himalaya" CLI is not installed. Run "tamias doctor --fix" to install it.' }
			}
			const config = getEmailConfig(account)
			if (!config) {
				return { success: false, error: account ? `Email account '${account}' not found.` : 'No email accounts configured.' }
			}
			if (!config.enabled) {
				return { success: false, error: `Email tool is disabled for account '${config.nickname}'.` }
			}

			// Permission check: If canSend is true, anyone is authorized.
			// If canSend is false, ONLY the whitelist is authorized.
			const isUnrestricted = config.permissions.canSend === true
			const isInWhitelist = config.permissions.whitelist.includes(to)

			if (!isUnrestricted && !isInWhitelist) {
				const errorMsg = config.permissions.whitelist.length > 0
					? `Recipient '${to}' is not in the authorized whitelist for account '${config.nickname}'.`
					: `Sending emails is disabled for account '${config.nickname}' (no whitelist configured).`
				console.warn(`[daemon] Send blocked: ${errorMsg}`)
				return { success: false, error: errorMsg }
			}

			const password = getEmailPassword(account)
			const env = { ...process.env }
			if (password) {
				env.EMAIL_PASSWORD = password
			}

			try {
				console.log(`[daemon] Attempting to send email to ${to} (Subject: "${subject}") using account: ${config.nickname}`)
				const { execSync } = await import('child_process')
				const template = `To: ${to}\nSubject: ${subject}\n\n${body}`

				execSync(`himalaya --account ${config.accountName} template send`, {
					env,
					input: template,
					encoding: 'utf-8',
				})

				console.log(`[daemon] Email successfully sent to ${to}`)
				return { success: true, message: `Email successfully sent to ${to}` }
			} catch (err: any) {
				console.error(`[daemon] Failed to send email to ${to}: ${err.message}`)
				return { success: false, error: `Failed to send email: ${err.message}` }
			}
		},
	}),
}

export const EMAIL_TOOL_NAME = 'email'
export const EMAIL_TOOL_LABEL = '📧 Email (himalaya CLI: list, read, send)'
