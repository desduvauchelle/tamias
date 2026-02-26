/**
 * WhatsApp Business Cloud API Bridge for Tamias.
 *
 * Uses the official Meta Graph API to send and receive messages.
 * Incoming messages arrive via webhooks — the daemon must be exposed via HTTPS
 * (or through a tunnel like ngrok/cloudflare) for Meta to deliver webhook events.
 *
 * Config shape in config.json:
 *   bridges.whatsapps.<key> = {
 *     enabled: true,
 *     phoneNumberId: "123456789",
 *     envKeyName: "WHATSAPP_<KEY>_TOKEN",   // env var holding the permanent access token
 *     verifyToken: "my-verify-token",        // webhook verification token
 *     webhookPath: "/webhook/whatsapp/<key>", // path the daemon exposes
 *   }
 */

import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'
import type { TamiasConfig } from '../../utils/config.ts'
import { getEnv } from '../../utils/env.ts'

interface WhatsAppConfig {
	enabled: boolean
	phoneNumberId?: string
	envKeyName?: string
	verifyToken?: string
	webhookPath?: string
	mode?: 'full' | 'mention-only'
}

export class WhatsAppBridge implements IBridge {
	name: string
	private instanceKey: string
	private phoneNumberId = ''
	private accessToken = ''
	private verifyToken = ''
	private webhookPath = ''
	private mode: 'full' | 'mention-only' = 'full'
	private onMessage!: (msg: BridgeMessage, sid: string) => Promise<boolean> | boolean
	private messageBuffer = new Map<string, string[]>()

	constructor(instanceKey: string) {
		this.instanceKey = instanceKey
		this.name = `whatsapp:${instanceKey}`
	}

	async initialize(
		config: TamiasConfig,
		onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean,
	): Promise<void> {
		this.onMessage = onMessage
		const waCfg = (config.bridges as any).whatsapps?.[this.instanceKey] as WhatsAppConfig | undefined

		if (!waCfg?.enabled) throw new Error(`WhatsApp instance "${this.instanceKey}" is not enabled`)
		if (!waCfg.phoneNumberId) throw new Error(`WhatsApp instance "${this.instanceKey}" missing phoneNumberId`)

		this.phoneNumberId = waCfg.phoneNumberId
		this.accessToken = waCfg.envKeyName ? (getEnv(waCfg.envKeyName) ?? '') : ''
		this.verifyToken = waCfg.verifyToken ?? `tamias-wa-${this.instanceKey}`
		this.webhookPath = waCfg.webhookPath ?? `/webhook/whatsapp/${this.instanceKey}`
		this.mode = waCfg.mode ?? 'full'

		if (!this.accessToken) {
			throw new Error(`WhatsApp instance "${this.instanceKey}": access token not found in env var "${waCfg.envKeyName}"`)
		}

		console.log(`[WhatsApp:${this.instanceKey}] Initialized — phone=${this.phoneNumberId}, webhook=${this.webhookPath}`)
	}

	/** Called by the HTTP server in start.ts for GET (verification) */
	handleWebhookVerification(query: Record<string, string>): Response {
		const mode = query['hub.mode']
		const token = query['hub.verify_token']
		const challenge = query['hub.challenge']

		if (mode === 'subscribe' && token === this.verifyToken) {
			console.log(`[WhatsApp:${this.instanceKey}] Webhook verified`)
			return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
		}

		return new Response('Forbidden', { status: 403 })
	}

	/** Called by the HTTP server in start.ts for POST (incoming messages) */
	async handleWebhookPayload(body: any): Promise<void> {
		try {
			const entries = body?.entry ?? []
			for (const entry of entries) {
				const changes = entry?.changes ?? []
				for (const change of changes) {
					if (change.field !== 'messages') continue
					const value = change.value
					const contacts = value?.contacts ?? []
					const messages = value?.messages ?? []

					for (const msg of messages) {
						if (msg.type !== 'text') continue // Only handle text for now

						const from = msg.from // phone number
						const text = msg.text?.body ?? ''
						const contactName = contacts.find((c: any) => c.wa_id === from)?.profile?.name ?? from

						await this.onMessage({
							channelId: this.name,
							channelUserId: from,
							channelName: `WhatsApp (${this.instanceKey})`,
							authorId: from,
							authorName: contactName,
							content: text,
						}, '')
					}
				}
			}
		} catch (err) {
			console.error(`[WhatsApp:${this.instanceKey}] Error processing webhook payload:`, err)
		}
	}

	async handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void> {
		const session = sessionContext as { channelUserId?: string }
		const recipientPhone = session?.channelUserId
		if (!recipientPhone) return

		if (event.type === 'chunk') {
			// Buffer chunks until 'done'
			if (!this.messageBuffer.has(recipientPhone)) {
				this.messageBuffer.set(recipientPhone, [])
			}
			this.messageBuffer.get(recipientPhone)!.push(event.text)
		}

		if (event.type === 'done') {
			const chunks = this.messageBuffer.get(recipientPhone) ?? []
			const fullMessage = chunks.join('')
			this.messageBuffer.delete(recipientPhone)

			if (fullMessage.trim() && !(event as any).suppressed) {
				await this.sendTextMessage(recipientPhone, fullMessage)
			}
		}

		if (event.type === 'error') {
			await this.sendTextMessage(recipientPhone, `⚠️ Error: ${event.message}`)
		}

		if (event.type === 'subagent-status') {
			const icon = event.status === 'completed' ? '✅' : event.status === 'failed' ? '❌' : '🧠'
			await this.sendTextMessage(recipientPhone, `${icon} Sub-agent: ${event.message}`)
		}

		if (event.type === 'agent-handoff') {
			const handoffMsg = `🐝 Agent Handoff\n\n` +
				`From: ${event.fromAgent}\n` +
				`To: ${event.toAgent}\n` +
				`Reason: ${event.reason}\n\n` +
				`The conversation is now being handled by ${event.toAgent}.`
			await this.sendTextMessage(recipientPhone, handoffMsg)
		}
	}

	/** Send a text message via the Graph API */
	private async sendTextMessage(to: string, text: string): Promise<void> {
		// WhatsApp has a 4096 char limit per message — split if needed
		const MAX_LEN = 4000
		const parts = text.length > MAX_LEN
			? text.match(new RegExp(`.{1,${MAX_LEN}}`, 'gs')) ?? [text]
			: [text]

		for (const part of parts) {
			try {
				const response = await fetch(
					`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${this.accessToken}`,
						},
						body: JSON.stringify({
							messaging_product: 'whatsapp',
							to,
							type: 'text',
							text: { body: part },
						}),
					}
				)

				if (!response.ok) {
					const errBody = await response.text()
					console.error(`[WhatsApp:${this.instanceKey}] Send failed (${response.status}):`, errBody)
				}
			} catch (err) {
				console.error(`[WhatsApp:${this.instanceKey}] Send error:`, err)
			}
		}
	}

	getWebhookPath(): string {
		return this.webhookPath
	}

	getVerifyToken(): string {
		return this.verifyToken
	}

	async destroy(): Promise<void> {
		console.log(`[WhatsApp:${this.instanceKey}] Bridge destroyed`)
		this.messageBuffer.clear()
	}
}
