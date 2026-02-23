import { Client, GatewayIntentBits, Events, type Message } from 'discord.js'
import { getBotTokenForBridge, type TamiasConfig } from '../../utils/config.ts'
import { VERSION } from '../../utils/version.ts'
import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'

interface DiscordChannelState {
	/** Queue of messages awaiting processing for this channel */
	queue: Message[]
	/** The message currently being responded to */
	currentMessage?: Message
	/** typing keepalive interval */
	typingInterval?: ReturnType<typeof setInterval>
	/** Text buffer for the CURRENT response */
	buffer: string
}

export class DiscordBridge implements IBridge {
	name = 'discord'
	private client?: Client
	private onMessage?: (msg: BridgeMessage, sessionId: string) => void
	/** Map of channelId → channel orchestration state (set when a Discord message arrives) */
	private channelStates = new Map<string, DiscordChannelState>()
	/** Map of channelId → sessionId */
	private channelSessions = new Map<string, string>()
	/** Text buffer for cron/stateless sessions that have no incoming Discord message */
	private cronBuffers = new Map<string, string>()

	async initialize(config: TamiasConfig, onMessage: (msg: BridgeMessage, sessionId: string) => void): Promise<void> {
		this.onMessage = onMessage
		const token = getBotTokenForBridge('discord')
		if (!token) {
			console.error('[Discord Bridge] No bot token configured. Skipping.')
			return
		}

		const allowedChannels = config.bridges?.discord?.allowedChannels

		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
			],
		})

		this.client.on(Events.MessageCreate, async (message) => {
			if (message.author.bot) return
			if (allowedChannels?.length && !allowedChannels.includes(message.channelId)) return

			const channelId = message.channelId
			console.log(`[Discord Bridge] Message received in channel ${channelId} from ${message.author.username}: "${message.content.slice(0, 80)}"`)

			const sessionKey = this.channelSessions.get(channelId) ?? `dc_${channelId}`
			this.channelSessions.set(channelId, sessionKey)

			// 👀 React immediately on receive
			try {
				await message.react('👀')
			} catch { }

			// Add to queue for this channel
			let state = this.channelStates.get(channelId)
			if (!state) {
				state = { queue: [], buffer: '' }
				this.channelStates.set(channelId, state)
			}
			state.queue.push(message)

			const channelRef = message.channel
			const channelName = 'name' in channelRef ? `#${(channelRef as any).name}` : 'DM'

			const attachments: BridgeMessage['attachments'] = []
			if (message.attachments.size > 0) {
				for (const [_, attachment] of message.attachments) {
					try {
						const response = await fetch(attachment.url)
						if (!response.ok) throw new Error(`Failed to download attachment: ${response.statusText}`)
						const arrayBuffer = await response.arrayBuffer()
						const buffer = Buffer.from(arrayBuffer)

						attachments.push({
							type: attachment.contentType?.startsWith('image/') ? 'image' : 'file',
							url: attachment.url,
							buffer,
							mimeType: attachment.contentType || 'application/octet-stream'
						})
					} catch (err) {
						console.error(`[Discord Bridge] Failed to download attachment ${attachment.name}:`, err)
					}
				}
			}

			const bridgeMsg: BridgeMessage = {
				channelId: 'discord',
				channelUserId: channelId,
				channelName,
				authorId: message.author.id,
				authorName: message.author.username,
				content: message.content,
				attachments
			}

			console.log(`[Discord Bridge] Dispatching to onMessage with channelUserId=${channelId}${attachments.length ? ` and ${attachments.length} attachments` : ''}`)
			this.onMessage?.(bridgeMsg, sessionKey)
		})

		this.client.once(Events.ClientReady, (c) => {
			console.log(`[Discord Bridge] Started as ${c.user.tag}`)
		})

		await this.client.login(token)
	}

	async handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void> {
		if (!this.client) return
		const channelId = String(sessionContext?.channelUserId ?? '')
		if (!channelId) {
			console.error(`[Discord Bridge] handleDaemonEvent: no channelUserId in sessionContext`, sessionContext)
			return
		}

		const state = this.channelStates.get(channelId)

		switch (event.type) {
			case 'start': {
				console.log(`[Discord Bridge] Processing started for channel ${channelId}, state found: ${!!state}`)
				if (!state) {
					// Cron/stateless session — initialise fresh buffer
					this.cronBuffers.set(channelId, '')
				}
				if (state) {
					// Pop the next message from the queue
					const message = state.queue.shift()
					if (!message) {
						console.error(`[Discord Bridge] 'start' event received but no message in queue for channel ${channelId}`)
						return
					}
					state.currentMessage = message
					state.buffer = ''

					// 🧠 Add thinking reaction
					try { await message.react('🧠') } catch { }

					// Start typing indicator (Discord clears after ~9s so refresh every 7s)
					if (state.typingInterval) clearInterval(state.typingInterval)

					const channel = message.channel
					if ('sendTyping' in channel) {
						await channel.sendTyping().catch(() => { })
						state.typingInterval = setInterval(async () => {
							await channel.sendTyping().catch(() => { })
						}, 7000)
					}
				}
				break
			}
			case 'chunk': {
				if (state) {
					state.buffer += event.text
				} else {
					// Cron/stateless — accumulate in separate buffer
					this.cronBuffers.set(channelId, (this.cronBuffers.get(channelId) ?? '') + event.text)
				}
				break
			}
			case 'done': {
				// ── Cron / stateless path (no incoming Discord message) ─────────────
				if (!state && this.cronBuffers.has(channelId)) {
					const text = this.cronBuffers.get(channelId) ?? ''
					this.cronBuffers.delete(channelId)
					if (text.trim() && this.client) {
						try {
							const channel = await this.client.channels.fetch(channelId)
							if (channel && 'send' in channel) {
								const chunks = splitText(text, 1900)
								for (const chunk of chunks) {
									await (channel as any).send(chunk)
								}
								console.log(`[Discord Bridge] Sent cron response to channel ${channelId} (${text.length} chars)`)
							}
						} catch (err) {
							console.error(`[Discord Bridge] Failed to send cron message to ${channelId}:`, err)
						}
					}
					break
				}
				// ── Reply-to-message path (normal Discord conversation) ──────────
				if (state && state.currentMessage) {
					if (state.typingInterval) {
						clearInterval(state.typingInterval)
						state.typingInterval = undefined
					}

					const fullText = state.buffer
					const ctxMessage = state.currentMessage
					console.log(`[Discord Bridge] Sending response to ${channelId} (${fullText.length} chars)`)

					// Remove 👀 and 🧠 reactions
					try {
						const eye = ctxMessage.reactions.cache.get('👀')
						if (eye) await eye.users.remove(this.client!.user!.id)
					} catch { }
					try {
						const brain = ctxMessage.reactions.cache.get('🧠')
						if (brain) await brain.users.remove(this.client!.user!.id)
					} catch { }

					if (fullText.trim()) {
						try {
							const channel = ctxMessage.channel
							const anyChannel = channel as any
							if (typeof anyChannel.send === 'function') {
								const chunks = splitText(fullText, 1900)
								for (const chunk of chunks) {
									await anyChannel.send(chunk)
								}
							}
						} catch (err) {
							console.error(`[Discord Bridge] Failed to send to ${channelId}:`, err)
						}
					}

					// Clean up current message
					state.currentMessage = undefined
					state.buffer = ''

					// If queue is empty, we can potentially remove the state, but better to keep it for future messages
					// until destroy() is called or it times out (optional)
				}
				break
			}
			case 'error': {
				if (state && state.currentMessage) {
					if (state.typingInterval) {
						clearInterval(state.typingInterval)
						state.typingInterval = undefined
					}
					const ctxMessage = state.currentMessage
					try {
						const eye = ctxMessage.reactions.cache.get('👀')
						if (eye) await eye.users.remove(this.client!.user!.id)
					} catch { }
					try {
						const brain = ctxMessage.reactions.cache.get('🧠')
						if (brain) await brain.users.remove(this.client!.user!.id)
					} catch { }
					try {
						await (ctxMessage.channel as any).send?.(`⚠️ Error [v${VERSION}]: ${event.message}`)
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send error notification to channel ${channelId}:`, err)
					}
					state.currentMessage = undefined
					state.buffer = ''
				}
				break
			}
			case 'file': {
				if (state && state.currentMessage) {
					try {
						const channel = state.currentMessage.channel
						const anyChannel = channel as any
						if (typeof anyChannel.send === 'function') {
							await anyChannel.send({ files: [{ attachment: event.buffer, name: event.name }] })
						}
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send file to ${channelId}:`, err)
					}
				}
				break
			}
		}
	}

	async destroy(): Promise<void> {
		if (this.client) {
			// Clear all typing intervals
			for (const state of this.channelStates.values()) {
				if (state.typingInterval) clearInterval(state.typingInterval)
			}
			this.client.destroy()
			console.log('[Discord Bridge] Stopped.')
		}
	}
}

function splitText(text: string, maxLen: number): string[] {
	if (text.length <= maxLen) return [text]
	const chunks: string[] = []
	let remaining = text
	while (remaining.length > 0) {
		if (remaining.length <= maxLen) { chunks.push(remaining); break }
		let splitAt = remaining.lastIndexOf('\n', maxLen)
		if (splitAt <= 0) splitAt = maxLen
		chunks.push(remaining.slice(0, splitAt))
		remaining = remaining.slice(splitAt).trimStart()
	}
	return chunks
}
