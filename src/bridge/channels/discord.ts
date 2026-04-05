import { Client, GatewayIntentBits, Events, type Message } from 'discord.js'
import { getBotTokenForInstance, type TamiasConfig } from '../../utils/config.ts'
import { VERSION } from '../../utils/version.ts'
import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'

interface DiscordChannelState {
	/** Queue of messages awaiting processing for this channel */
	queue: Message[]
	/** The user's original message — persists until the entire turn completes */
	currentMessage?: Message
	/** Unified turn thread anchored on the user's message; created when the first sub-agent starts */
	currentThread?: any
	/** Count of in-flight sub-agents for the current turn */
	pendingSubagents: number
	/** typing keepalive interval */
	typingInterval?: ReturnType<typeof setInterval>
	/** Text buffer for the CURRENT response */
	buffer: string
}

export class DiscordBridge implements IBridge {
	name: string
	platform = 'discord'
	platformAccountId?: string
	private instanceKey: string
	private client?: Client
	private onMessage?: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean

	constructor(key = 'discord') {
		this.instanceKey = key
		this.name = `discord:${key}`
	}
	/** Map of channelId → channel orchestration state */
	private channelStates = new Map<string, DiscordChannelState>()
	/** Map of channelId → sessionId */
	private channelSessions = new Map<string, string>()
	/** Text buffer for cron/stateless sessions that have no incoming Discord message */
	private cronBuffers = new Map<string, string>()
	/** Deduplication guard: set of Discord message IDs already dispatched for processing */
	private seenMessageIds = new Set<string>()

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

		this.client.on('error', (err) => {
			console.error(`[Discord Bridge] Client error:`, err)
		})

		this.client.on('warn', (warning) => {
			console.warn(`[Discord Bridge] Client warning:`, warning)
		})

		this.client.on(Events.MessageCreate, async (message) => {
			try {
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
					state = { queue: [], buffer: '', pendingSubagents: 0 }
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

							const mimeType = attachment.contentType || 'application/octet-stream'
							const attachmentName = attachment.name ?? ''
							const isAudioByExtension = /\.(ogg|mp3|m4a|wav|flac|aac|opus|weba|webm)$/i.test(attachmentName)
							const attachType = mimeType.startsWith('image/')
								? 'image'
								: (mimeType.startsWith('audio/') || mimeType === 'application/ogg' || isAudioByExtension)
									? 'audio'
									: 'file'
							console.log(`[Discord Bridge] Attachment classified: name=${attachmentName || 'unknown'} type=${attachType} mime=${mimeType} size=${buffer.byteLength}`)
							attachments.push({
								type: attachType,
								url: attachment.url,
								buffer,
								mimeType
							})
						} catch (err) {
							console.error(`[Discord Bridge] Failed to download attachment ${attachment.name}:`, err)
						}
					}
				}

				const bridgeMsg: BridgeMessage = {
					channelId: this.name,
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
			} catch (err) {
				console.error(`[Discord Bridge] Unhandled error in MessageCreate handler:`, err)
			}
		})

		this.client.once(Events.ClientReady, (c) => {
			this.platformAccountId = c.user.id
			console.log(`[Discord Bridge] Started as ${c.user.tag} (platformAccountId=${c.user.id})`)
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

		if (!/^\d{17,21}$/.test(channelId)) {
			this.cronBuffers.delete(channelId)
			this.channelStates.delete(channelId)
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
					// If currentMessage is already set this is a continuation of the same turn
					// (e.g. parent processing a sub-agent report). Do NOT pop from queue — the
					// anchor message must persist until the full turn completes.
					if (!state.currentMessage) {
						const message = state.queue.shift()
						if (!message) {
							// Queue is empty but state exists — this can happen in edge cases.
							// Log a warning but do NOT return early: chunks will accumulate in state.buffer
							// and the 'done' handler will fall back to channels.fetch to deliver the response.
							console.warn(`[Discord Bridge] 'start' event received but no message in queue for channel ${channelId} — will deliver response via fallback on done event`)
							state.buffer = ''
							break
						}
						state.currentMessage = message
						await this.clearStatusReactions(message)
					}
					const message = state.currentMessage!
					state.buffer = ''

					// Start typing indicator
					if (state.typingInterval) clearInterval(state.typingInterval)
					const channel = message.channel
					if ('sendTyping' in channel) {
						channel.sendTyping().catch(() => { })
						const intervalId = setInterval(() => {
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
					if (!state.currentMessage) {
						const bufferedText = state.buffer
						state.buffer = ''
						console.warn(`[Discord Bridge] 'done' for channel ${channelId} — no currentMessage (start missed or queue was empty). Falling back to channels.fetch.`)
						if (bufferedText.trim()) {
							try {
								const channel = await this.client.channels.fetch(channelId)
								if (channel && 'send' in channel) {
									const chunks = splitText(bufferedText, 1900)
									for (const chunk of chunks) await (channel as any).send(chunk)
								}
							} catch (err) {
								console.error(`[Discord Bridge] Fallback send to ${channelId} failed:`, err)
							}
						}
						break
					}

					const fullText = state.buffer
					const ctxMessage = state.currentMessage
					state.buffer = ''

					if (state.pendingSubagents > 0) {
						// Mid-turn: sub-agents are still running. This is Chip's intermediate
						// commentary ("I'm delegating to Cody...") — route to thread only.
						// Do NOT clear currentMessage; the turn isn't over yet.
						if (state.typingInterval) {
							clearInterval(state.typingInterval)
							state.typingInterval = undefined
						}
						const thread = state.currentThread
						if (thread && fullText.trim()) {
							try {
								const chunks = splitText(fullText, 1900)
								for (const chunk of chunks) await thread.send(chunk)
							} catch (err) {
								console.error(`[Discord Bridge] Failed to send intermediate response to thread:`, err)
							}
						} else if (!thread && fullText.trim()) {
							// Thread creation failed — fall back to main channel
							try {
								const chunks = splitText(fullText, 1900)
								for (const chunk of chunks) await (ctxMessage.channel as any).send?.(chunk)
							} catch (err) {
								console.error(`[Discord Bridge] Failed to send intermediate response (fallback) to ${channelId}:`, err)
							}
						}
						break
					}

					// Final response for this turn (pendingSubagents === 0)
					console.log(`[Discord Bridge] Sending final response to ${channelId} (${fullText.length} chars)`)
					if (state.typingInterval) {
						clearInterval(state.typingInterval)
						state.typingInterval = undefined
					}
					await this.clearStatusReactions(ctxMessage)

					if (fullText.trim()) {
						const thread = state.currentThread
						if (thread) {
							// Post final answer to thread for full audit trail
							try {
								const chunks = splitText(fullText, 1900)
								for (const chunk of chunks) await thread.send(chunk)
							} catch (err) {
								console.error(`[Discord Bridge] Failed to post final answer to thread:`, err)
							}
							// Reply to user's original message in main channel with thread reference
							try {
								const summaryChunks = splitText(fullText, 1850)
								for (let i = 0; i < summaryChunks.length; i++) {
									const isLast = i === summaryChunks.length - 1
									const text = isLast ? summaryChunks[i] + '\n\n_[Full work log in thread ↑]_' : summaryChunks[i]
									await (ctxMessage as any).reply(text)
								}
							} catch (err) {
								console.error(`[Discord Bridge] Failed to reply with final answer to ${channelId}:`, err)
							}
						} else {
							// No thread (simple conversation with no sub-agents) — send to main channel as before
							try {
								const anyChannel = ctxMessage.channel as any
								if (typeof anyChannel.send === 'function') {
									const chunks = splitText(fullText, 1900)
									for (const chunk of chunks) await anyChannel.send(chunk)
								}
							} catch (err) {
								console.error(`[Discord Bridge] Failed to send to ${channelId}:`, err)
							}
						}
					}

					// Clean up turn state
					state.currentMessage = undefined
					state.currentThread = undefined
					state.pendingSubagents = 0
					await this.promoteNextQueuedMessage(state)
					// Evict stale state so cron sessions targeting this channel
					// don't accidentally fall into the Discord-message path.
					if (!state.currentMessage && state.queue.length === 0) {
						this.channelStates.delete(channelId)
					}
				}
				break
			}
			case 'error': {
				if (state) {
					if (state.typingInterval) {
						clearInterval(state.typingInterval)
						state.typingInterval = undefined
					}
					const errorMsg = `⚠️ Error [v${VERSION}]: ${event.message}`
					if (!state.currentMessage) {
						try {
							const channel = await this.client.channels.fetch(channelId)
							if (channel && 'send' in channel) {
								await (channel as any).send(errorMsg)
							}
						} catch (err) {
							console.error(`[Discord Bridge] Failed to send fallback error notification to channel ${channelId}:`, err)
						}
						break
					}
					const ctxMessage = state.currentMessage
					await this.clearStatusReactions(ctxMessage)
					try {
						// Always send error to main channel so user sees it;
						// also post to thread if one is open for context
						if (state.currentThread) {
							await state.currentThread.send(errorMsg).catch(() => { })
						}
						await (ctxMessage.channel as any).send?.(errorMsg)
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send error notification to channel ${channelId}:`, err)
					}
					state.currentMessage = undefined
					state.currentThread = undefined
					state.pendingSubagents = 0
					state.buffer = ''
					await this.promoteNextQueuedMessage(state)
					// Evict stale state when all queue items are consumed
					if (!state.currentMessage && state.queue.length === 0) {
						this.channelStates.delete(channelId)
					}
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
				// All sub-agent lifecycle events are routed to the unified turn thread.
				// The thread is lazily created on the user's own message when the first
				// sub-agent is spawned — Discord's sidebar shows the user's question as the thread name.
				if (event.status === 'started') {
					if (state) state.pendingSubagents++

					// Create the turn thread on the user's message if it doesn't exist yet
					if (state && !state.currentThread && state.currentMessage &&
						typeof (state.currentMessage as any).startThread === 'function') {
						try {
							const threadName = (state.currentMessage.content || 'Task').slice(0, 100)
							state.currentThread = await (state.currentMessage as any).startThread({
								name: threadName,
								autoArchiveDuration: 60,
							})
							console.log(`[Discord Bridge] Created turn thread "${threadName}" for channel ${channelId}`)
						} catch (err) {
							console.warn(`[Discord Bridge] Could not create turn thread for channel ${channelId}:`, err)
						}
					}

					const statusMsg = `🧠 **Sub-agent started**\n📋 ${event.task}\n🔑 Session: \`${event.subagentId}\``
					const thread = state?.currentThread
					if (thread) {
						await thread.send(statusMsg).catch(console.error)
					} else {
						// DM or thread creation failed — fall back to main channel
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
					const thread = state?.currentThread
					if (thread) {
						await thread.send(`⏳ ${event.message}`).catch(console.error)
					} else {
						const channel = await this.client!.channels.fetch(channelId).catch(() => null)
						if (channel && 'send' in channel) await (channel as any).send(`⏳ ${event.message}`).catch(console.error)
					}
				} else if (event.status === 'completed') {
					if (state && state.pendingSubagents > 0) state.pendingSubagents--
					const thread = state?.currentThread
					if (thread) {
						await thread.send('✅ Done — main agent is processing the results.').catch(console.error)
					} else {
						const channel = await this.client!.channels.fetch(channelId).catch(() => null)
						if (channel && 'send' in channel) {
							await (channel as any).send('✅ _Sub-agent done — generating response…_').catch(console.error)
						}
					}
				} else if (event.status === 'failed') {
					if (state && state.pendingSubagents > 0) state.pendingSubagents--
					const msg = `❌ *Sub-agent failed:* ${event.message}`
					const thread = state?.currentThread
					if (thread) {
						await thread.send(msg).catch(console.error)
					} else {
						const channel = await this.client!.channels.fetch(channelId).catch(() => null)
						if (channel && 'send' in channel) await (channel as any).send(msg).catch(console.error)
					}
				}
				break
			}
			case 'progress-update': {
				const stepLabel = event.step && event.totalSteps
					? ` (${event.step}/${event.totalSteps})`
					: event.step ? ` (step ${event.step})` : ''
				const updateMsg = `📋${stepLabel} ${event.message}`
				// Route to the unified turn thread if it exists, otherwise fall back to main channel
				const progressThread = state?.currentThread
				if (progressThread) {
					try {
						await progressThread.send(updateMsg)
					} catch (err) {
						console.warn(`[Discord Bridge] Failed to send progress update to thread:`, err)
					}
				} else {
					try {
						const ch = await this.client!.channels.fetch(channelId)
						if (ch && 'send' in ch) await (ch as any).send(updateMsg)
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send progress update to ${channelId}:`, err)
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
				// Handoffs are part of the work log — route to thread if available
				const handoffThread = state?.currentThread
				if (handoffThread) {
					try {
						await handoffThread.send(handoffMsg)
					} catch (err) {
						console.error(`[Discord Bridge] Failed to send handoff to thread in ${channelId}:`, err)
					}
				} else {
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
				}
				break
			}
		}
	}

	/**
	 * Sends a message directly to a Discord channel by snowflake ID.
	 * Used by broadcastToChannel for system messages like !ping, !diag, errors.
	 */
	async sendDirect(channelId: string, text: string): Promise<void> {
		if (!this.client) {
			console.error(`[Discord Bridge] sendDirect called but client is NOT ready`)
			return
		}
		try {
			const channel = await this.client.channels.fetch(channelId)
			if (channel && 'send' in channel) {
				const chunks = splitText(text, 1900)
				for (const chunk of chunks) {
					await (channel as any).send(chunk)
				}
			} else {
				console.error(`[Discord Bridge] sendDirect: channel ${channelId} not found or not sendable`)
			}
		} catch (err) {
			console.error(`[Discord Bridge] sendDirect failed for channel ${channelId}:`, err)
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

	async listAllChannels(): Promise<Array<{ id: string; name: string; guildId: string; guildName: string; instanceKey: string }>> {
		if (!this.client || !this.client.isReady()) return []

		const discovered: Array<{ id: string; name: string; guildId: string; guildName: string; instanceKey: string }> = []

		for (const guild of this.client.guilds.cache.values()) {
			try {
				const channels = await guild.channels.fetch()
				for (const channel of channels.values()) {
					if (!channel) continue
					if (typeof (channel as any).isTextBased !== 'function') continue
					if (!(channel as any).isTextBased()) continue

					const channelId = String(channel.id)
					const channelName = 'name' in channel ? String((channel as any).name ?? channelId) : channelId
					discovered.push({
						id: channelId,
						name: channelName,
						guildId: guild.id,
						guildName: guild.name,
						instanceKey: this.instanceKey
					})
				}
			} catch (err) {
				console.warn(`[Discord Bridge] Failed to fetch channels for guild ${guild.id}:`, err)
			}
		}

		return discovered
	}

	async destroy(): Promise<void> {
		if (this.client) {
			// Clear all typing intervals
			for (const state of this.channelStates.values()) {
				if (state.typingInterval) clearInterval(state.typingInterval)
			}
			this.client.destroy()
			this.seenMessageIds.clear()
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
