import { Client, GatewayIntentBits, Events, type Message } from 'discord.js'
import { getBotTokenForInstance, type TamiasConfig } from '../../utils/config.ts'
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
	private instanceKey: string
	private client?: Client
	private onMessage?: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean

	constructor(key = 'discord') {
		this.instanceKey = key
	}
	/** Map of channelId → channel orchestration state (set when a Discord message arrives) */
	private channelStates = new Map<string, DiscordChannelState>()
	/** Map of channelId → sessionId */
	private channelSessions = new Map<string, string>()
	/** Text buffer for cron/stateless sessions that have no incoming Discord message */
	private cronBuffers = new Map<string, string>()
	/** Deduplication guard: set of Discord message IDs already dispatched for processing */
	private seenMessageIds = new Set<string>()
	/** Threads created for progress updates: sessionId → Discord ThreadChannel */
	private progressThreads = new Map<string, any>()
	/** Threads created for sub-agents: subagentId → Discord ThreadChannel */
	private subagentThreads = new Map<string, any>()

	private async clearStatusReactions(message: Message): Promise<void> {
		if (!this.client?.user?.id) return
		for (const emoji of ['👀', '⏳', '🧠']) {
			try {
				const reaction = message.reactions.cache.get(emoji)
				if (reaction) await reaction.users.remove(this.client.user.id)
			} catch { }
		}
	}

	private async promoteNextQueuedMessage(state: DiscordChannelState): Promise<void> {
		if (state.currentMessage || state.queue.length === 0) return
		const nextUp = state.queue[0]
		await this.clearStatusReactions(nextUp)
		nextUp.react('👀').catch(() => { })
	}

	async initialize(config: TamiasConfig, onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean): Promise<void> {
		this.onMessage = onMessage
		const token = getBotTokenForInstance('discords', this.instanceKey)
		if (!token) {
			console.error(`[Discord Bridge] No bot token configured for instance '${this.instanceKey}'. Skipping.`)
			return
		}

		const instanceCfg = config.bridges?.discords?.[this.instanceKey]
		const allowedChannels = instanceCfg?.allowedChannels
		const mode: string = (instanceCfg as any)?.mode ?? 'full'

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

			// Mode enforcement:
			// - 'listen-only': never respond (bridge is destroyed, but guard here too)
			// - 'mention-only': only respond when bot is mentioned
			// - 'full' (default): respond to all messages
			if (mode === 'listen-only') return
			if (mode === 'mention-only') {
				const botId = this.client?.user?.id
				const mentioned = botId && message.mentions.users.has(botId)
				if (!mentioned) return
			}

			// Guard against duplicate Discord gateway events (e.g. reconnect replays)
			if (this.seenMessageIds.has(message.id)) {
				console.warn(`[Discord Bridge] Duplicate MessageCreate for ${message.id} — ignoring`)
				return
			}
			this.seenMessageIds.add(message.id)
			// Keep the set bounded to the last 1000 messages
			if (this.seenMessageIds.size > 1000) {
				const oldest = this.seenMessageIds.values().next().value
				if (oldest) this.seenMessageIds.delete(oldest)
			}

			const channelId = message.channelId
			console.log(`[Discord Bridge] Message received in channel ${channelId} from ${message.author.username}: "${message.content.slice(0, 80)}"`)

			const sessionKey = this.channelSessions.get(channelId) ?? `dc_${channelId}`
			this.channelSessions.set(channelId, sessionKey)

			// Add to queue for this channel
			let state = this.channelStates.get(channelId)
			if (!state) {
				state = { queue: [], buffer: '' }
				this.channelStates.set(channelId, state)
			}
			state.queue.push(message)

			// Queue-aware receipt reaction: 👀 when next-up, ⏳ when queued
			const isQueued = !!state.currentMessage || state.queue.length > 1
			try {
				await message.react(isQueued ? '⏳' : '👀')
			} catch { }

			const channelRef = message.channel
			const discordChannelName = 'name' in channelRef ? (channelRef as { name: string }).name : null
			const guildName = message.guild?.name ?? null
			const channelName = discordChannelName
				? guildName
					? `#${discordChannelName} (${guildName})`
					: `#${discordChannelName}`
				: 'DM'

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
			const handled = await this.onMessage?.(bridgeMsg, sessionKey)
			if (handled === false && state.queue.includes(message)) {
				state.queue = state.queue.filter(m => m !== message)
				console.log(`[Discord Bridge] Message rejected by onMessage, removed from queue: "${message.content.slice(0, 40)}"`)
				// Clear receipt/legacy reactions for rejected messages
				await this.clearStatusReactions(message)
				await this.promoteNextQueuedMessage(state)
			}
		})

		this.client.once(Events.ClientReady, (c) => {
			console.log(`[Discord Bridge] Started as ${c.user.tag}`)
		})

		await this.client.login(token)
	}

	async handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void> {
		if (!this.client) {
			console.error(`[Discord Bridge] handleDaemonEvent called but client is NOT ready (event=${event.type}, channelUserId=${sessionContext?.channelUserId}). Is the bot token configured and the bot connected?`)
			return
		}
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
					await this.clearStatusReactions(message)

					// Start typing indicator synchronously
					if (state.typingInterval) clearInterval(state.typingInterval)

					const channel = message.channel
					if ('sendTyping' in channel) {
						channel.sendTyping().catch(() => { })
						const intervalId = setInterval(() => {
							// Self-cancel if no longer processing or if interval was replaced
							if (!state || state.currentMessage === undefined || state.typingInterval !== intervalId) {
								clearInterval(intervalId)
								if (state && state.typingInterval === intervalId) state.typingInterval = undefined
								return
							}
							channel.sendTyping().catch(() => { })
						}, 7000)
						state.typingInterval = intervalId
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
					console.log(`[Discord Bridge] Cron done — channelId=${channelId}, text length=${text.length}`)
					if (text.trim()) {
						try {
							console.log(`[Discord Bridge] Fetching Discord channel ${channelId} to send cron message...`)
							const channel = await this.client.channels.fetch(channelId)
							if (channel && 'send' in channel) {
								const chunks = splitText(text, 1900)
								for (const chunk of chunks) {
									await (channel as any).send(chunk)
								}
								console.log(`[Discord Bridge] Sent cron response to channel ${channelId} (${text.length} chars)`)
							} else {
								console.error(`[Discord Bridge] Channel ${channelId} not found or not sendable`)
							}
						} catch (err) {
							console.error(`[Discord Bridge] Failed to send cron message to ${channelId}:`, err)
						}
					} else {
						console.warn(`[Discord Bridge] Cron text was empty for channel ${channelId} — nothing sent`)
					}
					break
				}
				// ── Reply-to-message path (normal Discord conversation) ──────────
				if (state) {
					if (state.typingInterval) {
						clearInterval(state.typingInterval)
						state.typingInterval = undefined
					}

					if (!state.currentMessage) break

					const fullText = state.buffer
					const ctxMessage = state.currentMessage
					console.log(`[Discord Bridge] Sending response to ${channelId} (${fullText.length} chars)`)

					await this.clearStatusReactions(ctxMessage)

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
					await this.promoteNextQueuedMessage(state)

					// Clean up progress thread for this session
					const doneSessionId = sessionContext?.sessionId ?? channelId
					if (this.progressThreads.has(doneSessionId)) {
						this.progressThreads.delete(doneSessionId)
					}

					// If queue is empty, we can potentially remove the state, but better to keep it for future messages
					// until destroy() is called or it times out (optional)
				}
				break
			}
			case 'error': {
				if (state) {
					if (state.typingInterval) {
						clearInterval(state.typingInterval)
						state.typingInterval = undefined
					}
					if (!state.currentMessage) break
					const ctxMessage = state.currentMessage
					await this.clearStatusReactions(ctxMessage)
					try {
						await (ctxMessage.channel as any).send?.(`⚠️ Error [v${VERSION}]: ${event.message}`)
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send error notification to channel ${channelId}:`, err)
					}
					state.currentMessage = undefined
					state.buffer = ''
					await this.promoteNextQueuedMessage(state)
				}
				break
			}
			case 'file': {
				const filePayload = { files: [{ attachment: event.buffer, name: event.name }] }
				if (state && state.currentMessage) {
					try {
						const anyChannel = state.currentMessage.channel as any
						if (typeof anyChannel.send === 'function') await anyChannel.send(filePayload)
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send file to ${channelId}:`, err)
					}
				} else {
					// Cron / stateless path
					try {
						const channel = await this.client!.channels.fetch(channelId)
						if (channel && 'send' in channel) await (channel as any).send(filePayload)
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send file (cron) to ${channelId}:`, err)
					}
				}
				break
			}
			case 'subagent-status': {
				if (event.status === 'started') {
					// Try to create a Discord thread from the message that triggered the parent.
					// state.currentMessage is still set because the parent is still streaming.
					const triggeringMessage = state?.currentMessage
					if (triggeringMessage && typeof (triggeringMessage as any).startThread === 'function') {
						try {
							const threadName = event.task.slice(0, 100)
							const thread = await (triggeringMessage as any).startThread({
								name: threadName,
								autoArchiveDuration: 60,
							})
							this.subagentThreads.set(event.subagentId, thread)
							await thread.send(`🧠 **Sub-agent started**\n📋 ${event.task}\n🔑 Session: \`${event.subagentId}\``)
						} catch (err) {
							console.warn(`[Discord Bridge] Could not create thread for sub-agent ${event.subagentId}:`, err)
							// Fallback: post in-channel with session ID
							try {
								const channel = await this.client!.channels.fetch(channelId)
								if (channel && 'send' in channel) {
									await (channel as any).send(`🧠 *Working on:* _${event.task}_…\n🔑 Session: \`${event.subagentId}\``)
								}
							} catch { }
						}
					} else {
						// DM or no current message — post to channel with session ID
						try {
							const channel = await this.client!.channels.fetch(channelId)
							if (channel && 'send' in channel) {
								await (channel as any).send(`🧠 *Working on:* _${event.task}_…\n🔑 Session: \`${event.subagentId}\``)
							}
						} catch (err) {
							console.error(`[Discord Bridge] Failed to send subagent started to ${channelId}:`, err)
						}
					}
				} else if (event.status === 'progress') {
					const thread = this.subagentThreads.get(event.subagentId)
					const target = thread ?? await this.client!.channels.fetch(channelId).catch(() => null)
					if (target && 'send' in target) {
						await (target as any).send(`⏳ ${event.message}`).catch(console.error)
					}
				} else if (event.status === 'completed') {
					const thread = this.subagentThreads.get(event.subagentId)
					if (thread) {
						await thread.send('✅ Done — main agent is processing the results.').catch(console.error)
						this.subagentThreads.delete(event.subagentId)
					} else {
						const channel = await this.client!.channels.fetch(channelId).catch(() => null)
						if (channel && 'send' in channel) {
							await (channel as any).send('✅ _Sub-agent done — generating response…_').catch(console.error)
						}
					}
				} else if (event.status === 'failed') {
					const thread = this.subagentThreads.get(event.subagentId)
					const msg = `❌ *Sub-agent failed:* ${event.message}`
					if (thread) {
						await thread.send(msg).catch(console.error)
						this.subagentThreads.delete(event.subagentId)
					} else {
						const channel = await this.client!.channels.fetch(channelId).catch(() => null)
						if (channel && 'send' in channel) {
							await (channel as any).send(msg).catch(console.error)
						}
					}
				}
				break
			}
			case 'progress-update': {
				const sessionId = sessionContext?.sessionId ?? channelId
				const stepLabel = event.step && event.totalSteps
					? ` (${event.step}/${event.totalSteps})`
					: event.step ? ` (step ${event.step})` : ''
				const updateMsg = `📋${stepLabel} ${event.message}`

				// Try to reuse an existing progress thread for this session
				let thread = this.progressThreads.get(sessionId)
				if (thread) {
					try {
						await thread.send(updateMsg)
					} catch {
						this.progressThreads.delete(sessionId)
						thread = null
					}
				}

				// Create a new thread if none exists
				if (!thread) {
					const triggerMsg = state?.currentMessage
					if (triggerMsg && typeof (triggerMsg as any).startThread === 'function') {
						try {
							const threadName = (event.title || 'Task Progress').slice(0, 100)
							thread = await (triggerMsg as any).startThread({
								name: threadName,
								autoArchiveDuration: 60,
							})
							this.progressThreads.set(sessionId, thread)
							await thread.send(updateMsg)
						} catch (err) {
							console.warn(`[Discord Bridge] Could not create progress thread:`, err)
							// Fallback: post in channel
							try {
								const ch = await this.client!.channels.fetch(channelId)
								if (ch && 'send' in ch) await (ch as any).send(updateMsg)
							} catch { }
						}
					} else {
						// DM or no current message — post in channel
						try {
							const ch = await this.client!.channels.fetch(channelId)
							if (ch && 'send' in ch) await (ch as any).send(updateMsg)
						} catch (err) {
							console.error(`[Discord Bridge] Failed to send progress update to ${channelId}:`, err)
						}
					}
				}
				break
			}
			case 'agent-handoff': {
				const handoffMsg = `🐝 **Agent Handoff**\n\n` +
					`**From:** ${event.fromAgent}\n` +
					`**To:** ${event.toAgent}\n` +
					`**Reason:** ${event.reason}\n\n` +
					`_The conversation is now being handled by **${event.toAgent}**._`
				try {
					if (state?.currentMessage) {
						const channel = state.currentMessage.channel as any
						if (typeof channel.send === 'function') await channel.send(handoffMsg)
					} else {
						const channel = await this.client!.channels.fetch(channelId)
						if (channel && 'send' in channel) await (channel as any).send(handoffMsg)
					}
				} catch (err) {
					console.error(`[Discord Bridge] Failed to send handoff notification to ${channelId}:`, err)
				}
				break
			}
		}
	}

	async listCronTargets(): Promise<Array<{ target: string; label: string; platform: 'discord'; source: string }>> {
		if (!this.client || !this.client.isReady()) return []

		const discovered: Array<{ target: string; label: string; platform: 'discord'; source: string }> = []

		for (const guild of this.client.guilds.cache.values()) {
			try {
				const channels = await guild.channels.fetch()
				for (const channel of channels.values()) {
					if (!channel) continue
					if (typeof (channel as any).isTextBased !== 'function') continue
					if (!(channel as any).isTextBased()) continue
					if ((channel as any).isThread?.()) continue

					const channelId = String(channel.id)
					const channelName = 'name' in channel ? String((channel as any).name ?? channelId) : channelId
					discovered.push({
						target: `discord:${channelId}`,
						label: `Discord #${channelName} (${guild.name})`,
						platform: 'discord',
						source: `discord:${this.instanceKey}`,
					})
				}
			} catch (err) {
				console.warn(`[Discord Bridge] Failed to fetch channels for guild ${guild.id}:`, err)
			}
		}

		const seen = new Set<string>()
		return discovered.filter(item => {
			if (seen.has(item.target)) return false
			seen.add(item.target)
			return true
		})
	}

	async destroy(): Promise<void> {
		if (this.client) {
			// Clear all typing intervals
			for (const state of this.channelStates.values()) {
				if (state.typingInterval) clearInterval(state.typingInterval)
			}
			this.client.destroy()
			this.seenMessageIds.clear()
			this.subagentThreads.clear()
			this.progressThreads.clear()
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
