import { Client, GatewayIntentBits, Events, type Message } from 'discord.js'
import { getBotTokenForBridge, type TamiasConfig } from '../../utils/config.ts'
import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'

interface DiscordContext {
	message: Message
	channelId: string
	buffer: string
	/** typing keepalive interval */
	typingInterval?: ReturnType<typeof setInterval>
}

export class DiscordBridge implements IBridge {
	name = 'discord'
	private client?: Client
	private onMessage?: (msg: BridgeMessage, sessionId: string) => void
	/** Map of channelId → in-flight context */
	private contexts = new Map<string, DiscordContext>()
	/** Map of channelId → sessionId */
	private channelSessions = new Map<string, string>()

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
			const sessionKey = this.channelSessions.get(channelId) ?? `dc_${channelId}`
			this.channelSessions.set(channelId, sessionKey)

			// 👀 React immediately on receive
			try {
				await message.react('👀')
			} catch { }

			// Store context for this channel
			this.contexts.set(channelId, { message, channelId, buffer: '' })

			const channelRef = message.channel
			const channelName = 'name' in channelRef ? `#${(channelRef as any).name}` : 'DM'

			const bridgeMsg: BridgeMessage = {
				channelId: 'discord',
				channelUserId: channelId,
				channelName,
				authorId: message.author.id,
				authorName: message.author.username,
				content: message.content,
			}

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
		if (!channelId) return

		const ctx = this.contexts.get(channelId)

		switch (event.type) {
			case 'start': {
				if (ctx) {
					// 🧠 Add thinking reaction
					try { await ctx.message.react('🧠') } catch { }

					// Start typing indicator (Discord clears after ~9s so refresh every 7s)
					const channel = ctx.message.channel
					if ('sendTyping' in channel) {
						await channel.sendTyping().catch(() => { })
						ctx.typingInterval = setInterval(async () => {
							await channel.sendTyping().catch(() => { })
						}, 7000)
					}
					ctx.buffer = ''
				}
				break
			}
			case 'chunk': {
				if (ctx) ctx.buffer += event.text
				break
			}
			case 'done': {
				if (ctx) {
					clearInterval(ctx.typingInterval)
					const fullText = ctx.buffer
					this.contexts.delete(channelId)

					// Remove 👀 and 🧠 reactions
					try {
						const eye = ctx.message.reactions.cache.get('👀')
						if (eye) await eye.users.remove(this.client!.user!.id)
					} catch { }
					try {
						const brain = ctx.message.reactions.cache.get('🧠')
						if (brain) await brain.users.remove(this.client!.user!.id)
					} catch { }

					if (fullText.trim()) {
						try {
							const channel = ctx.message.channel
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
				}
				break
			}
			case 'error': {
				if (ctx) {
					clearInterval(ctx.typingInterval)
					this.contexts.delete(channelId)
					try {
						const eye = ctx.message.reactions.cache.get('👀')
						if (eye) await eye.users.remove(this.client!.user!.id)
					} catch { }
					try {
						const brain = ctx.message.reactions.cache.get('🧠')
						if (brain) await brain.users.remove(this.client!.user!.id)
					} catch { }
					try {
						await (ctx.message.channel as any).send?.(`⚠️ Error: ${event.message}`)
					} catch { }
				}
				break
			}
			case 'file': {
				if (ctx) {
					try {
						const channel = ctx.message.channel
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
