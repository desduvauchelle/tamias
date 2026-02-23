/**
 * himalaya.ts — Auto-provision himalaya CLI account configs from Tamias email settings.
 *
 * When a himalaya command is about to run, we verify the account exists in
 * ~/.config/himalaya/config.toml (or equivalent XDG path).  If it is missing we
 * generate the correct IMAP + SMTP TOML block and append it, so the user never
 * has to configure himalaya manually.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ─── Paths ─────────────────────────────────────────────────────────────────

const HIMALAYA_CONFIG_DIR = process.env.XDG_CONFIG_HOME
	? join(process.env.XDG_CONFIG_HOME, 'himalaya')
	: join(homedir(), '.config', 'himalaya')

export const HIMALAYA_CONFIG_PATH = join(HIMALAYA_CONFIG_DIR, 'config.toml')

// ─── Types ──────────────────────────────────────────────────────────────────

export type EmailServiceConfig = {
	accountName: string
	email: string
	service: string
	password: string
}

// ─── Service presets ────────────────────────────────────────────────────────

const IMAP_PRESET: Record<string, { host: string; port: number; starttls?: boolean }> = {
	gmail: { host: 'imap.gmail.com', port: 993 },
	outlook: { host: 'outlook.office365.com', port: 993 },
	icloud: { host: 'imap.mail.me.com', port: 993 },
}

const SMTP_PRESET: Record<string, { host: string; port: number; starttls?: boolean }> = {
	gmail: { host: 'smtp.gmail.com', port: 465 },
	outlook: { host: 'smtp-mail.outlook.com', port: 587, starttls: true },
	icloud: { host: 'smtp.mail.me.com', port: 587, starttls: true },
}

// ─── TOML generator ─────────────────────────────────────────────────────────

function generateAccountToml({ accountName, email, service, password }: EmailServiceConfig): string | null {
	const imap = IMAP_PRESET[service]
	const smtp = SMTP_PRESET[service]

	if (!imap || !smtp) {
		// "other" — we don't know the server details, can't auto-config
		return null
	}

	// iCloud IMAP login is the username part (before @), SMTP uses full address
	const imapLogin = service === 'icloud' ? email.split('@')[0] : email
	const smtpLogin = email

	const encryptionType = smtp.starttls ? 'start-tls' : 'tls'

	return [
		`[accounts.${accountName}]`,
		`email = "${email}"`,
		``,
		`backend.type = "imap"`,
		`backend.host = "${imap.host}"`,
		`backend.port = ${imap.port}`,
		`backend.login = "${imapLogin}"`,
		`backend.auth.type = "password"`,
		`backend.auth.raw = "${password.replace(/"/g, '\\"')}"`,
		``,
		`message.send.backend.type = "smtp"`,
		`message.send.backend.host = "${smtp.host}"`,
		`message.send.backend.port = ${smtp.port}`,
		...(smtp.starttls ? [`message.send.backend.encryption.type = "${encryptionType}"`] : []),
		`message.send.backend.login = "${smtpLogin}"`,
		`message.send.backend.auth.type = "password"`,
		`message.send.backend.auth.raw = "${password.replace(/"/g, '\\"')}"`,
		``,
	].join('\n')
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Checks whether `accountName` is present in the himalaya config.
 * If not — and if we have enough info — writes the block automatically.
 *
 * Returns `{ ok: true }` when the account is present (or was just created).
 * Returns `{ ok: false, reason: string }` when auto-provisioning is not possible.
 */
export function ensureHimalayaAccount(cfg: EmailServiceConfig): { ok: true } | { ok: false; reason: string } {
	const { accountName, service } = cfg

	// Read existing config (may not exist)
	let existingContent = ''
	if (existsSync(HIMALAYA_CONFIG_PATH)) {
		existingContent = readFileSync(HIMALAYA_CONFIG_PATH, 'utf-8')
	}

	// Quick check: is the account already declared?
	const accountHeader = `[accounts.${accountName}]`
	if (existingContent.includes(accountHeader)) {
		return { ok: true }
	}

	// Need to auto-create it
	console.log(`[daemon] Himalaya account '${accountName}' not found in config — auto-provisioning…`)

	if (!cfg.email) {
		return {
			ok: false,
			reason: `Account '${accountName}' is missing from himalaya config and no email address is stored in Tamias to auto-create it. Please run \`tamias emails edit\` to set the email address, or configure himalaya manually.`,
		}
	}

	if (!cfg.password) {
		return {
			ok: false,
			reason: `Account '${accountName}' is missing from himalaya config and no password is stored in Tamias (envKeyName may not be set). Please run \`tamias emails edit\` to update the password.`,
		}
	}

	const toml = generateAccountToml(cfg)
	if (!toml) {
		return {
			ok: false,
			reason: `Account '${accountName}' is missing from himalaya config. Service '${service}' requires manual IMAP/SMTP setup — please run \`himalaya account configure ${accountName}\` or add the config to ${HIMALAYA_CONFIG_PATH} manually.`,
		}
	}

	// Ensure the directory exists
	if (!existsSync(HIMALAYA_CONFIG_DIR)) {
		mkdirSync(HIMALAYA_CONFIG_DIR, { recursive: true })
	}

	// Append to existing file (or create it)
	const separator = existingContent.length > 0 && !existingContent.endsWith('\n\n') ? '\n' : ''
	writeFileSync(HIMALAYA_CONFIG_PATH, existingContent + separator + toml, 'utf-8')

	console.log(`[daemon] Auto-provisioned himalaya account '${accountName}' in ${HIMALAYA_CONFIG_PATH}`)
	return { ok: true }
}
