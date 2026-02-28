/**
 * Unofficial WhatsApp Bridge for Tamias (Baileys / WhatsApp Web).
 *
 * Uses @whiskeysockets/baileys to connect via the WhatsApp Web protocol.
 * Authentication is via QR code scan — no Meta Business account needed.
 * Maintains a persistent WebSocket connection (no webhooks required).
 *
 * Config shape in config.json:
 *   bridges.whatsappUnofficials.<key> = {
 *     enabled: true,
 *     mode: "read-only",           // "read-only" | "full"
 *     allowedGroups: ["...@g.us"],  // group JIDs, or ["*"] for all
 *     allowedContacts: ["+1..."],   // E.164 phone numbers, or ["*"] for all
 *     authDir: "/custom/path",     // optional override
 *   }
 */

import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'
import type { TamiasConfig } from '../../utils/config.ts'
import { TAMIAS_DIR } from '../../utils/config.ts'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'fs'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface WhatsAppUnofficialConfig {
	enabled: boolean
	mode?: 'full' | 'read-only'
	allowedGroups?: string[]
	allowedContacts?: string[]
	authDir?: string
}

interface AvailableGroup {
	jid: string
	name: string
	participantCount: number
}

// ─── Reconnect Policy ─────────────────────────────────────────────────────────

const RECONNECT = {
	initialMs: 2_000,
	maxMs: 30_000,
	factor: 1.8,
	jitter: 0.25,
	maxAttempts: 12,
}

function computeBackoff(attempt: number): number {
	const base = Math.min(RECONNECT.initialMs * Math.pow(RECONNECT.factor, attempt), RECONNECT.maxMs)
	const jitter = base * RECONNECT.jitter * (Math.random() * 2 - 1)
	return Math.round(base + jitter)
}

// ─── Bridge Class ──────────────────────────────────────────────────────────────

export class WhatsAppUnofficialBridge implements IBridge {
	name: string
	private instanceKey: string
	private mode: 'full' | 'read-only' = 'read-only'
	private allowedGroups: string[] = []
	private allowedContacts: string[] = []
	private authDir = ''
	private onMessage!: (msg: BridgeMessage, sid: string) => Promise<boolean> | boolean
	private messageBuffer = new Map<string, string[]>()
	private sock: any = null
	private connectionStatus: 'disconnected' | 'connecting' | 'qr-pending' | 'connected' = 'disconnected'
	private currentQr: string | null = null
	private reconnectAttempt = 0
	private shouldReconnect = true
	private availableGroups: AvailableGroup[] = []
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null

	constructor(instanceKey: string) {
		this.instanceKey = instanceKey
		this.name = `whatsapp-unofficial:${instanceKey}`
	}

	async initialize(
		config: TamiasConfig,
		onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean,
	): Promise<void> {
		this.onMessage = onMessage
		const waCfg = (config.bridges as any)?.whatsappUnofficials?.[this.instanceKey] as WhatsAppUnofficialConfig | undefined

		if (!waCfg?.enabled) throw new Error(`WhatsApp Unofficial instance "${this.instanceKey}" is not enabled`)

		this.mode = waCfg.mode ?? 'read-only'
		this.allowedGroups = waCfg.allowedGroups ?? []
		this.allowedContacts = waCfg.allowedContacts ?? []
		this.authDir = waCfg.authDir ?? join(TAMIAS_DIR, 'whatsapp-auth', this.instanceKey)

		// Ensure auth directory exists
		if (!existsSync(this.authDir)) {
			mkdirSync(this.authDir, { recursive: true })
		}

		console.log(`[WA-Unofficial:${this.instanceKey}] Initializing — mode=${this.mode}, authDir=${this.authDir}`)

		// Only connect if auth state already exists (previously linked)
		if (existsSync(join(this.authDir, 'creds.json'))) {
			await this.connectSocket()
		} else {
			console.log(`[WA-Unofficial:${this.instanceKey}] Not linked yet — use 'tamias channels add' or the setup tool to link via QR code`)
		}
	}

	// ─── Baileys Socket Connection ──────────────────────────────────────────────

	private async connectSocket(): Promise<void> {
		this.connectionStatus = 'connecting'

		try {
			const baileys = await import('@whiskeysockets/baileys')
			const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } = baileys
			const pino = (await import('pino')).default

			// Silent pino logger for Baileys
			const logger = pino({ level: 'silent' })

			const { version } = await fetchLatestBaileysVersion()

			// Auth state with backup/restore
			await this.maybeRestoreCredsFromBackup()
			const { state, saveCreds } = await useMultiFileAuthState(this.authDir)

			// Wrap saveCreds with backup
			const safelyPersistCreds = async () => {
				try {
					await this.backupCreds()
					await saveCreds()
				} catch (err) {
					console.error(`[WA-Unofficial:${this.instanceKey}] Failed to save creds:`, err)
				}
			}

			this.sock = makeWASocket({
				auth: {
					creds: state.creds,
					keys: makeCacheableSignalKeyStore(state.keys, logger),
				},
				version,
				logger,
				printQRInTerminal: false,
				browser: ['tamias', 'cli', '1.0'],
				syncFullHistory: false,
				markOnlineOnConnect: false,
			})

			// Handle connection updates
			this.sock.ev.on('connection.update', async (update: any) => {
				const { connection, lastDisconnect, qr } = update

				if (qr) {
					this.currentQr = qr
					this.connectionStatus = 'qr-pending'
					console.log(`[WA-Unofficial:${this.instanceKey}] QR code available — scan to link`)
				}

				if (connection === 'close') {
					this.connectionStatus = 'disconnected'
					const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
					const loggedOut = statusCode === DisconnectReason.loggedOut

					if (loggedOut) {
						console.log(`[WA-Unofficial:${this.instanceKey}] Logged out — clearing auth`)
						this.shouldReconnect = false
						// Clear auth state
						try { rmSync(this.authDir, { recursive: true, force: true }) } catch { /* ignore */ }
					} else if (this.shouldReconnect && this.reconnectAttempt < RECONNECT.maxAttempts) {
						const delay = computeBackoff(this.reconnectAttempt)
						this.reconnectAttempt++
						console.log(`[WA-Unofficial:${this.instanceKey}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${RECONNECT.maxAttempts})`)
						this.reconnectTimer = setTimeout(() => this.connectSocket(), delay)
					} else {
						console.error(`[WA-Unofficial:${this.instanceKey}] Max reconnect attempts reached or reconnect disabled`)
					}
				}

				if (connection === 'open') {
					this.connectionStatus = 'connected'
					this.currentQr = null
					this.reconnectAttempt = 0
					console.log(`[WA-Unofficial:${this.instanceKey}] Connected successfully`)

					// Discover available groups
					try {
						await this.discoverGroups()
					} catch (err) {
						console.warn(`[WA-Unofficial:${this.instanceKey}] Failed to discover groups:`, err)
					}
				}
			})

			// Persist credentials on update
			this.sock.ev.on('creds.update', safelyPersistCreds)

			// Handle incoming messages
			this.sock.ev.on('messages.upsert', async (upsert: any) => {
				if (upsert.type !== 'notify') return // Skip offline catch-up messages

				for (const msg of upsert.messages) {
					try {
						await this.handleIncomingMessage(msg)
					} catch (err) {
						console.error(`[WA-Unofficial:${this.instanceKey}] Error handling message:`, err)
					}
				}
			})

		} catch (err) {
			console.error(`[WA-Unofficial:${this.instanceKey}] Failed to connect:`, err)
			this.connectionStatus = 'disconnected'
		}
	}

	// ─── Incoming Message Handling ──────────────────────────────────────────────

	private async handleIncomingMessage(msg: any): Promise<void> {
		if (!msg.message) return
		if (msg.key.fromMe) return // Ignore own messages

		const jid = msg.key.remoteJid
		if (!jid) return

		// Skip status and broadcast
		if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) return

		const isGroup = jid.endsWith('@g.us')
		const isDirectMessage = jid.endsWith('@s.whatsapp.net')

		// ─── Filtering ──────────────────────────────────────────────────
		if (isGroup) {
			if (this.allowedGroups.length === 0) return // No groups allowed
			if (!this.allowedGroups.includes('*') && !this.allowedGroups.includes(jid)) return
		} else if (isDirectMessage) {
			if (this.allowedContacts.length === 0) return // No DMs allowed
			const phone = jid.replace('@s.whatsapp.net', '')
			if (!this.allowedContacts.includes('*') && !this.allowedContacts.includes(phone) && !this.allowedContacts.includes(`+${phone}`)) return
		} else {
			return // Unknown JID type
		}

		// ─── Extract message content ────────────────────────────────────
		const content = this.extractMessageText(msg)
		if (!content) return // No text content to process

		// Build author info
		const senderJid = isGroup ? (msg.key.participant || jid) : jid
		const senderPhone = senderJid.replace('@s.whatsapp.net', '')
		const pushName = msg.pushName || senderPhone

		// Get group name for context
		let channelName = `WhatsApp Unofficial (${this.instanceKey})`
		if (isGroup) {
			const group = this.availableGroups.find(g => g.jid === jid)
			channelName = group ? `WA: ${group.name}` : `WA Group: ${jid}`
		} else {
			channelName = `WA DM: ${pushName}`
		}

		await this.onMessage({
			channelId: this.name,
			channelUserId: jid, // Use the full JID as channel user ID
			channelName,
			authorId: senderPhone,
			authorName: pushName,
			content,
		}, '')
	}

	private extractMessageText(msg: any): string | null {
		const m = msg.message
		if (!m) return null

		// Handle various message types
		if (m.conversation) return m.conversation
		if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
		if (m.imageMessage?.caption) return m.imageMessage.caption
		if (m.videoMessage?.caption) return m.videoMessage.caption
		if (m.documentMessage?.caption) return m.documentMessage.caption
		if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText
		if (m.listResponseMessage?.title) return m.listResponseMessage.title
		if (m.templateButtonReplyMessage?.selectedDisplayText) return m.templateButtonReplyMessage.selectedDisplayText

		return null
	}

	// ─── Group Discovery ────────────────────────────────────────────────────────

	async discoverGroups(): Promise<AvailableGroup[]> {
		if (!this.sock || this.connectionStatus !== 'connected') {
			return this.availableGroups
		}

		try {
			const groups = await this.sock.groupFetchAllParticipating()
			this.availableGroups = Object.entries(groups).map(([jid, meta]: [string, any]) => ({
				jid,
				name: meta.subject || jid,
				participantCount: meta.participants?.length ?? 0,
			}))

			console.log(`[WA-Unofficial:${this.instanceKey}] Discovered ${this.availableGroups.length} groups`)
			return this.availableGroups
		} catch (err) {
			console.error(`[WA-Unofficial:${this.instanceKey}] Group discovery failed:`, err)
			return this.availableGroups
		}
	}

	listAvailableGroups(): AvailableGroup[] {
		return this.availableGroups
	}

	// ─── QR Login Flow ──────────────────────────────────────────────────────────

	/**
	 * Start the QR login flow. Returns QR data in both text and PNG formats.
	 * The caller should display the QR to the user and poll getConnectionStatus().
	 */
	async loginWithQr(): Promise<{ qrText: string; qrPng: Buffer } | null> {
		if (this.connectionStatus === 'connected') {
			return null // Already connected
		}

		// Ensure auth directory exists
		if (!existsSync(this.authDir)) {
			mkdirSync(this.authDir, { recursive: true })
		}

		// Start connecting (will generate QR)
		const qrPromise = new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('QR timeout')), 60_000)

			const checkQr = () => {
				if (this.currentQr) {
					clearTimeout(timeout)
					resolve(this.currentQr)
				} else if (this.connectionStatus === 'connected') {
					clearTimeout(timeout)
					reject(new Error('Already connected'))
				} else {
					setTimeout(checkQr, 500)
				}
			}

			// Start connection if not already connecting
			if (this.connectionStatus !== 'connecting' && this.connectionStatus !== 'qr-pending') {
				this.connectSocket()
			}

			checkQr()
		})

		try {
			const qrText = await qrPromise

			// Generate PNG from QR text
			const qrImage = await import('qr-image')
			const pngStream = qrImage.default.imageSync(qrText, { type: 'png', size: 8 })
			const qrPng = Buffer.from(pngStream)

			return { qrText, qrPng }
		} catch (err) {
			console.error(`[WA-Unofficial:${this.instanceKey}] QR login failed:`, err)
			return null
		}
	}

	/**
	 * Wait for connection to be established after QR scan.
	 * Returns true if connected within the timeout.
	 */
	async waitForConnection(timeoutMs = 120_000): Promise<boolean> {
		const start = Date.now()
		while (Date.now() - start < timeoutMs) {
			if (this.connectionStatus === 'connected') return true
			await new Promise(r => setTimeout(r, 1000))
		}
		return false
	}

	/**
	 * Render QR code in terminal using qrcode-terminal.
	 */
	async printQrInTerminal(): Promise<void> {
		if (!this.currentQr) {
			console.log(`[WA-Unofficial:${this.instanceKey}] No QR code available`)
			return
		}

		const qrcodeTerminal = await import('qrcode-terminal')
		qrcodeTerminal.default.generate(this.currentQr, { small: true })
	}

	// ─── Outbound Messages ──────────────────────────────────────────────────────

	async handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void> {
		const session = sessionContext as { channelUserId?: string }
		const recipientJid = session?.channelUserId
		if (!recipientJid) return

		// In read-only mode, log but don't send
		if (this.mode === 'read-only') {
			if (event.type === 'done') {
				const chunks = this.messageBuffer.get(recipientJid) ?? []
				const fullMessage = chunks.join('')
				this.messageBuffer.delete(recipientJid)
				if (fullMessage.trim()) {
					console.log(`[WA-Unofficial:${this.instanceKey}] [READ-ONLY] Suppressed outbound to ${recipientJid}: ${fullMessage.substring(0, 100)}...`)
				}
			}
			if (event.type === 'chunk') {
				if (!this.messageBuffer.has(recipientJid)) {
					this.messageBuffer.set(recipientJid, [])
				}
				this.messageBuffer.get(recipientJid)!.push(event.text)
			}
			return
		}

		// Full mode — send messages
		if (event.type === 'chunk') {
			if (!this.messageBuffer.has(recipientJid)) {
				this.messageBuffer.set(recipientJid, [])
			}
			this.messageBuffer.get(recipientJid)!.push(event.text)
		}

		if (event.type === 'done') {
			const chunks = this.messageBuffer.get(recipientJid) ?? []
			const fullMessage = chunks.join('')
			this.messageBuffer.delete(recipientJid)

			if (fullMessage.trim() && !(event as any).suppressed) {
				await this.sendTextMessage(recipientJid, fullMessage)
			}
		}

		if (event.type === 'error') {
			await this.sendTextMessage(recipientJid, `⚠️ Error: ${event.message}`)
		}

		if (event.type === 'subagent-status') {
			const icon = event.status === 'completed' ? '✅' : event.status === 'failed' ? '❌' : '🧠'
			await this.sendTextMessage(recipientJid, `${icon} Sub-agent: ${event.message}`)
		}

		if (event.type === 'agent-handoff') {
			const handoffMsg = `🐝 Agent Handoff\n\n` +
				`From: ${event.fromAgent}\n` +
				`To: ${event.toAgent}\n` +
				`Reason: ${event.reason}\n\n` +
				`The conversation is now being handled by ${event.toAgent}.`
			await this.sendTextMessage(recipientJid, handoffMsg)
		}

		if (event.type === 'file') {
			await this.sendFileMessage(recipientJid, event.buffer, event.name, event.mimeType)
		}
	}

	private async sendTextMessage(to: string, text: string): Promise<void> {
		if (!this.sock || this.connectionStatus !== 'connected') {
			console.warn(`[WA-Unofficial:${this.instanceKey}] Cannot send — not connected`)
			return
		}

		const MAX_LEN = 4000
		const parts = text.length > MAX_LEN
			? text.match(new RegExp(`.{1,${MAX_LEN}}`, 'gs')) ?? [text]
			: [text]

		for (const part of parts) {
			try {
				await this.sock.sendMessage(to, { text: part })
			} catch (err) {
				console.error(`[WA-Unofficial:${this.instanceKey}] Send error:`, err)
			}
		}
	}

	private async sendFileMessage(to: string, buffer: Buffer, fileName: string, mimeType: string): Promise<void> {
		if (!this.sock || this.connectionStatus !== 'connected') {
			console.warn(`[WA-Unofficial:${this.instanceKey}] Cannot send file — not connected`)
			return
		}

		try {
			if (mimeType.startsWith('image/')) {
				await this.sock.sendMessage(to, { image: buffer, caption: fileName })
			} else if (mimeType.startsWith('video/')) {
				await this.sock.sendMessage(to, { video: buffer, caption: fileName })
			} else if (mimeType.startsWith('audio/')) {
				await this.sock.sendMessage(to, { audio: buffer, mimetype: mimeType })
			} else {
				await this.sock.sendMessage(to, { document: buffer, mimetype: mimeType, fileName })
			}
		} catch (err) {
			console.error(`[WA-Unofficial:${this.instanceKey}] Send file error:`, err)
		}
	}

	// ─── Creds Backup/Restore ───────────────────────────────────────────────────

	private async backupCreds(): Promise<void> {
		const credsPath = join(this.authDir, 'creds.json')
		const backupPath = join(this.authDir, 'creds.json.bak')

		if (existsSync(credsPath)) {
			try {
				// Validate existing creds are parseable before backing up
				const raw = readFileSync(credsPath, 'utf-8')
				JSON.parse(raw)
				copyFileSync(credsPath, backupPath)
			} catch {
				// Existing creds file is corrupt — don't overwrite backup
			}
		}
	}

	private async maybeRestoreCredsFromBackup(): Promise<void> {
		const credsPath = join(this.authDir, 'creds.json')
		const backupPath = join(this.authDir, 'creds.json.bak')

		if (!existsSync(credsPath) && existsSync(backupPath)) {
			try {
				const raw = readFileSync(backupPath, 'utf-8')
				JSON.parse(raw) // Validate
				writeFileSync(credsPath, raw, { mode: 0o600 })
				console.log(`[WA-Unofficial:${this.instanceKey}] Restored creds from backup`)
			} catch {
				console.warn(`[WA-Unofficial:${this.instanceKey}] Backup creds also corrupt — fresh login required`)
			}
		}
	}

	// ─── Status & Config ────────────────────────────────────────────────────────

	getConnectionStatus(): string {
		return this.connectionStatus
	}

	getCurrentQr(): string | null {
		return this.currentQr
	}

	getMode(): string {
		return this.mode
	}

	getAllowedGroups(): string[] {
		return this.allowedGroups
	}

	getAllowedContacts(): string[] {
		return this.allowedContacts
	}

	getAuthDir(): string {
		return this.authDir
	}

	getInstanceKey(): string {
		return this.instanceKey
	}

	/**
	 * Update the allowed groups list at runtime and persist to config.
	 */
	async updateAllowedGroups(groups: string[]): Promise<void> {
		this.allowedGroups = groups
		await this.persistConfig()
	}

	/**
	 * Update the allowed contacts list at runtime and persist to config.
	 */
	async updateAllowedContacts(contacts: string[]): Promise<void> {
		this.allowedContacts = contacts
		await this.persistConfig()
	}

	/**
	 * Update the mode at runtime and persist to config.
	 */
	async updateMode(mode: 'full' | 'read-only'): Promise<void> {
		this.mode = mode
		await this.persistConfig()
	}

	private async persistConfig(): Promise<void> {
		try {
			const { getBridgesConfig, setBridgesConfig } = await import('../../utils/config.ts')
			const bridges = getBridgesConfig()
			if (!bridges.whatsappUnofficials) bridges.whatsappUnofficials = {}
			bridges.whatsappUnofficials[this.instanceKey] = {
				enabled: true,
				mode: this.mode,
				allowedGroups: this.allowedGroups.length ? this.allowedGroups : undefined,
				allowedContacts: this.allowedContacts.length ? this.allowedContacts : undefined,
				authDir: this.authDir !== join(TAMIAS_DIR, 'whatsapp-auth', this.instanceKey) ? this.authDir : undefined,
			}
			setBridgesConfig(bridges)
		} catch (err) {
			console.error(`[WA-Unofficial:${this.instanceKey}] Failed to persist config:`, err)
		}
	}

	/**
	 * Unlink: disconnect, clear auth, remove config entry.
	 */
	async unlink(): Promise<void> {
		this.shouldReconnect = false
		if (this.sock) {
			try { await this.sock.logout() } catch { /* ignore */ }
			try { this.sock.end(undefined) } catch { /* ignore */ }
			this.sock = null
		}
		// Clear auth data
		try { rmSync(this.authDir, { recursive: true, force: true }) } catch { /* ignore */ }
		this.connectionStatus = 'disconnected'
		this.currentQr = null
		this.availableGroups = []

		// Remove from config
		try {
			const { getBridgesConfig, setBridgesConfig } = await import('../../utils/config.ts')
			const bridges = getBridgesConfig()
			if (bridges.whatsappUnofficials?.[this.instanceKey]) {
				delete bridges.whatsappUnofficials[this.instanceKey]
				setBridgesConfig(bridges)
			}
		} catch { /* ignore */ }
	}

	// ─── Lifecycle ──────────────────────────────────────────────────────────────

	async destroy(): Promise<void> {
		console.log(`[WA-Unofficial:${this.instanceKey}] Bridge destroying...`)
		this.shouldReconnect = false
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.sock) {
			try { this.sock.end(undefined) } catch { /* ignore */ }
			this.sock = null
		}
		this.messageBuffer.clear()
		this.connectionStatus = 'disconnected'
		console.log(`[WA-Unofficial:${this.instanceKey}] Bridge destroyed`)
	}
}
