import { tool } from 'ai'
import { z } from 'zod'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getEmailConfig, getEmailPassword } from '../utils/config.ts'

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
			const config = getEmailConfig(account)
			if (!config || !config.enabled) {
				const errorMsg = account ? `Email account '${account}' is not configured or enabled.` : 'No email account is configured or enabled.'
				return { success: false, error: errorMsg }
			}

			try {
				const { stdout } = await execAsync(
					`himalaya --account ${config.accountName} envelope list --page ${page} --page-size ${pageSize} --output json`
				)
				const envelopes = JSON.parse(stdout)
				return { success: true, envelopes }
			} catch (err: any) {
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
			const config = getEmailConfig(account)
			if (!config || !config.enabled) {
				return { success: false, error: 'Email tool is not enabled.' }
			}

			try {
				const { stdout } = await execAsync(`himalaya --account ${config.accountName} message read ${id}`)
				return { success: true, id, content: stdout }
			} catch (err: any) {
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
			const config = getEmailConfig(account)
			if (!config || !config.enabled) {
				return { success: false, error: 'Email tool is not enabled.' }
			}

			// Permission check: Whitelist
			if (config.permissions.whitelist.length > 0 && !config.permissions.whitelist.includes(to)) {
				return { success: false, error: `Recipient '${to}' is not in the authorized whitelist for account '${config.nickname}'.` }
			}

			const password = getEmailPassword(account)
			const env = { ...process.env }
			if (password) {
				env.EMAIL_PASSWORD = password
			}

			try {
				const { execSync } = await import('child_process')
				const template = `To: ${to}\nSubject: ${subject}\n\n${body}`

				execSync(`himalaya --account ${config.accountName} template send`, {
					env,
					input: template,
					encoding: 'utf-8',
				})

				return { success: true, message: `Email successfully sent to ${to}` }
			} catch (err: any) {
				return { success: false, error: `Failed to send email: ${err.message}` }
			}
		},
	}),
}

export const EMAIL_TOOL_NAME = 'email'
export const EMAIL_TOOL_LABEL = '📧 Email (himalaya CLI: list, read, send)'
