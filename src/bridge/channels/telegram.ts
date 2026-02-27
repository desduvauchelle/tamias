import { Bot, InputFile } from 'grammy'
import { getBotTokenForInstance, type TamiasConfig } from '../../utils/config.ts'
import { VERSION } from '../../utils/version.ts'
import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'

interface TelegramMessageContext {
	chatId: number
	messageId: number
}

interface TelegramChatState {
	/** Queue of messages awaiting processing for this chat */
	queue: TelegramMessageContext[]
	/** The message currently being responded to */
	currentContext?: TelegramMessageContext
	/** typing keepalive interval */
	typingInterval?: ReturnType<typeof setInterval>
	/** accumulated text chunks */
	buffer: string
}

interface MessageIdentity {
	authorId: string
	authorName?: string
	channelName: string
}

export class TelegramBridge implements IBridge {
	name = 'telegram'
	private instanceKey: string
	private bot?: Bot
	private onMessage?: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean

	constructor(key = 'telegram') {
		this.instanceKey = key
	}
	/** Map of chatId → per-chat orchestration state */
	private chatStates = new Map<string, TelegramChatState>()
	/** Map of chatId → sessionId */
	private chatSessions = new Map<string, string>()

	private getOrCreateChatState(chatKey: string): TelegramChatState {
		let state = this.chatStates.get(chatKey)
		if (!state) {
			state = { queue: [], buffer: '' }
			this.chatStates.set(chatKey, state)
		}
		return state
	}

	private getMessageIdentity(ctx: any): MessageIdentity {
		return {
			authorId: String(ctx.from?.id),
			authorName: ctx.from?.first_name,
			channelName: ctx.chat.type === 'private' ? 'Private Chat' : (ctx.chat as any).title,
		}
	}

	private async setReceiptReaction(chatId: number, messageId: number, emoji: '👀' | '⏳'): Promise<void> {
		try {
			await this.bot?.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji }] as any)
		} catch { /* Reactions are not supported in all chats/clients */ }
	}

	private async clearStatusReactions(chatId: number, messageId: number): Promise<void> {
		try {
			await this.bot?.api.setMessageReaction(chatId, messageId, [])
		} catch { }
	}

	private stopTyping(state: TelegramChatState): void {
		if (state.typingInterval) {
			clearInterval(state.typingInterval)
			state.typingInterval = undefined
		}
	}

	private async promoteNextQueued(state: TelegramChatState): Promise<void> {
		if (state.currentContext || state.queue.length === 0) return
		const nextUp = state.queue[0]
		await this.clearStatusReactions(nextUp.chatId, nextUp.messageId)
		await this.setReceiptReaction(nextUp.chatId, nextUp.messageId, '👀')
	}

	private async queueIncomingMessage(params: {
		chatKey: string
		chatId: number
		messageId: number
		sessionKey: string
		bridgeMsg: BridgeMessage
	}): Promise<void> {
		const state = this.getOrCreateChatState(params.chatKey)
		const context: TelegramMessageContext = { chatId: params.chatId, messageId: params.messageId }
		state.queue.push(context)

		const isQueued = !!state.currentContext || state.queue.length > 1
		await this.setReceiptReaction(params.chatId, params.messageId, isQueued ? '⏳' : '👀')

		const handled = await this.onMessage?.(params.bridgeMsg, params.sessionKey)
		if (handled === false && state.queue.includes(context)) {
			state.queue = state.queue.filter((queuedContext) => queuedContext !== context)
			await this.clearStatusReactions(params.chatId, params.messageId)
			await this.promoteNextQueued(state)
		}
	}

	async initialize(config: TamiasConfig, onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean): Promise<void> {
		this.onMessage = onMessage
		const token = getBotTokenForInstance('telegrams', this.instanceKey)
		if (!token) {
			console.error(`[Telegram Bridge] No bot token configured for instance '${this.instanceKey}'. Skipping.`)
			return
		}

		this.bot = new Bot(token)

		const instanceCfg = config.bridges?.telegrams?.[this.instanceKey]
		const mode: string = (instanceCfg as any)?.mode ?? 'full'

		// Helper: check if message should be processed based on mode
		const shouldProcess = (ctx: any): boolean => {
			if (mode === 'listen-only') return false
			if (mode === 'mention-only') {
				// In Telegram, "mention" means the bot username is in the text
				const botUsername = this.bot?.botInfo?.username
				const text = ctx.message?.text ?? ctx.message?.caption ?? ''
				if (botUsername && !text.includes(`@${botUsername}`)) return false
			}
			return true
		}

		this.bot.on(['message:voice', 'message:audio'], async (ctx) => {
			if (!shouldProcess(ctx)) return
			const chatId = ctx.chat.id
			const messageId = ctx.message.message_id
			const chatKey = String(chatId)
			const identity = this.getMessageIdentity(ctx)

			const sessionKey = this.chatSessions.get(chatKey) ?? `tg_${chatKey}`
			this.chatSessions.set(chatKey, sessionKey)

			try {
				const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id
				if (!fileId) return

				await this.bot?.api.sendChatAction(chatId, 'typing').catch(() => { })

				const msg = await ctx.reply('⏳ Transcribing audio...', { reply_to_message_id: messageId })

				const file = await ctx.api.getFile(fileId)
				const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`

				const response = await fetch(fileUrl)
				const arrayBuffer = await response.arrayBuffer()
				const buffer = Buffer.from(arrayBuffer)

				const { transcribeAudioBuffer } = await import('../../utils/transcription.ts')
				const transcript = await transcribeAudioBuffer(buffer)

				if (!transcript) {
					await ctx.api.editMessageText(chatId, msg.message_id, '❌ Failed to transcribe audio: no text detected.')
					return
				}

				await ctx.api.editMessageText(chatId, msg.message_id, `*Transcribed:*\n_${transcript}_`, { parse_mode: 'Markdown' })

				const bridgeMsg: BridgeMessage = {
					channelId: 'telegram',
					channelUserId: chatKey,
					channelName: identity.channelName,
					authorId: identity.authorId,
					authorName: identity.authorName,
					content: transcript,
				}

				await this.queueIncomingMessage({
					chatKey,
					chatId,
					messageId,
					sessionKey,
					bridgeMsg,
				})
			} catch (err: any) {
				console.error('[Telegram Bridge] Audio transcription error:', err)
				try {
					await ctx.reply(`❌ Failed to process audio message: ${err.message}`, { reply_to_message_id: messageId })
				} catch { }
			}
		})

		this.bot.on('message:text', async (ctx) => {
			if (!shouldProcess(ctx)) return
			const chatId = ctx.chat.id
			const messageId = ctx.message.message_id
			const chatKey = String(chatId)
			const identity = this.getMessageIdentity(ctx)

			const sessionKey = this.chatSessions.get(chatKey) ?? `tg_${chatKey}`
			this.chatSessions.set(chatKey, sessionKey)

			const bridgeMsg: BridgeMessage = {
				channelId: 'telegram',
				channelUserId: chatKey,
				channelName: identity.channelName,
				authorId: identity.authorId,
				authorName: identity.authorName,
				content: ctx.message.text,
			}

			await this.queueIncomingMessage({
				chatKey,
				chatId,
				messageId,
				sessionKey,
				bridgeMsg,
			})
		})

		// Handle photos
		this.bot.on('message:photo', async (ctx) => {
			if (!shouldProcess(ctx)) return
			const chatId = ctx.chat.id
			const messageId = ctx.message.message_id
			const chatKey = String(chatId)
			const identity = this.getMessageIdentity(ctx)

			const sessionKey = this.chatSessions.get(chatKey) ?? `tg_${chatKey}`
			this.chatSessions.set(chatKey, sessionKey)

			try {
				// Use the highest-resolution variant
				const photos = ctx.message.photo
				const photo = photos[photos.length - 1]
				const file = await ctx.api.getFile(photo.file_id)
				const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`
				const res = await fetch(fileUrl)
				const buffer = Buffer.from(await res.arrayBuffer())

				const bridgeMsg: BridgeMessage = {
					channelId: 'telegram',
					channelUserId: chatKey,
					channelName: identity.channelName,
					authorId: identity.authorId,
					authorName: identity.authorName,
					content: ctx.message.caption || 'What is in this image?',
					attachments: [{ type: 'image', buffer, mimeType: 'image/jpeg' }],
				}

				await this.queueIncomingMessage({
					chatKey,
					chatId,
					messageId,
					sessionKey,
					bridgeMsg,
				})
			} catch (err: any) {
				console.error('[Telegram Bridge] Failed to process photo:', err)
				try { await ctx.reply(`❌ Failed to process image: ${err.message}`) } catch { }
			}
		})

		// Handle documents / other files
		this.bot.on('message:document', async (ctx) => {
			if (!shouldProcess(ctx)) return
			const chatId = ctx.chat.id
			const messageId = ctx.message.message_id
			const chatKey = String(chatId)
			const identity = this.getMessageIdentity(ctx)

			const sessionKey = this.chatSessions.get(chatKey) ?? `tg_${chatKey}`
			this.chatSessions.set(chatKey, sessionKey)

			try {
				const doc = ctx.message.document
				const file = await ctx.api.getFile(doc.file_id)
				const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`
				const res = await fetch(fileUrl)
				const buffer = Buffer.from(await res.arrayBuffer())
				const mimeType = doc.mime_type ?? 'application/octet-stream'
				const isImage = mimeType.startsWith('image/')

				const bridgeMsg: BridgeMessage = {
					channelId: 'telegram',
					channelUserId: chatKey,
					channelName: identity.channelName,
					authorId: identity.authorId,
					authorName: identity.authorName,
					content: ctx.message.caption ?? '',
					attachments: [{ type: isImage ? 'image' : 'file', buffer, mimeType, url: doc.file_name }],
				}

				await this.queueIncomingMessage({
					chatKey,
					chatId,
					messageId,
					sessionKey,
					bridgeMsg,
				})
			} catch (err: any) {
				console.error('[Telegram Bridge] Failed to process document:', err)
				try { await ctx.reply(`❌ Failed to process file: ${err.message}`) } catch { }
			}
		})

		this.bot.catch((err) => {
			console.error('[Telegram Bridge] Bot error:', err.message)
		})

		this.bot.start({
			onStart: (botInfo) => console.log(`[Telegram Bridge] Started as @${botInfo.username}`),
		})
	}

	async handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void> {
		if (!this.bot) return
		const chatKey = String(sessionContext?.channelUserId ?? '')
		if (!chatKey) return

		switch (event.type) {
			case 'start': {
				const state = this.chatStates.get(chatKey)
				if (!state) break

				const messageContext = state.queue.shift()
				if (!messageContext) break

				state.currentContext = messageContext
				state.buffer = ''

				await this.clearStatusReactions(messageContext.chatId, messageContext.messageId)

				this.stopTyping(state)
				state.typingInterval = setInterval(async () => {
					await this.bot?.api.sendChatAction(messageContext.chatId, 'typing').catch(() => { })
				}, 4000)
				await this.bot?.api.sendChatAction(messageContext.chatId, 'typing').catch(() => { })
				break
			}
			case 'chunk': {
				const state = this.chatStates.get(chatKey)
				if (state?.currentContext) state.buffer += event.text
				break
			}
			case 'done': {
				const state = this.chatStates.get(chatKey)
				const currentContext = state?.currentContext
				if (!state || !currentContext) break

				this.stopTyping(state)
				const fullText = state.buffer
				state.currentContext = undefined
				state.buffer = ''

				await this.clearStatusReactions(currentContext.chatId, currentContext.messageId)

				if (fullText.trim()) {
					try {
						const chunks = splitText(fullText, 4000)
						for (const chunk of chunks) {
							await this.bot.api.sendMessage(currentContext.chatId, chunk, { parse_mode: 'Markdown' })
								.catch(() => this.bot!.api.sendMessage(currentContext.chatId, chunk)) // fallback without markdown
						}
					} catch (err) {
						console.error(`[Telegram Bridge] Failed to send to ${chatKey}:`, err)
					}
				}

				await this.promoteNextQueued(state)
				break
			}
			case 'error': {
				const state = this.chatStates.get(chatKey)
				const currentContext = state?.currentContext
				if (!state || !currentContext) break

				this.stopTyping(state)
				state.currentContext = undefined
				state.buffer = ''

				await this.clearStatusReactions(currentContext.chatId, currentContext.messageId)
				try {
					await this.bot.api.sendMessage(currentContext.chatId, `⚠️ Error [v${VERSION}]: ${event.message}`)
				} catch (err) {
					console.error(`[Telegram Bridge] Failed to send error notification to chat ${chatKey}:`, err)
				}

				await this.promoteNextQueued(state)
				break
			}
			case 'file': {
				const state = this.chatStates.get(chatKey)
				const currentContext = state?.currentContext
				if (currentContext) {
					try {
						await this.bot.api.sendDocument(currentContext.chatId, new InputFile(event.buffer, event.name))
					} catch (err) {
						console.error(`[Telegram Bridge] Failed to send file to ${chatKey}:`, err)
					}
				}
				break
			}
			case 'subagent-status': {
				// Escape session ID for MarkdownV2 (underscores in sess_xxx must be escaped)
				const escapedId = escapeMd(event.subagentId)
				const escapedTask = escapeMd(event.task)
				const escapedMsg = escapeMd(event.message)
				const statusMessages: Record<string, string> = {
					started: `🧠 *Working on:* _${escapedTask}_…\n🔑 Session: \`${escapedId}\``,
					progress: `⏳ ${escapedMsg}`,
					completed: `✅ _Sub\-agent done — generating response…_`,
					failed: `❌ _Sub\-agent failed: ${escapedMsg}_`,
				}
				const text = statusMessages[event.status] ?? `🔄 ${escapedMsg}`
				try {
					await this.bot.api.sendMessage(Number(chatKey), text, { parse_mode: 'MarkdownV2' })
				} catch (err) {
					console.error(`[Telegram Bridge] Failed to send subagent-status to chat ${chatKey}:`, err)
				}
				break
			}
			case 'agent-handoff': {
				const from = escapeMd(event.fromAgent)
				const to = escapeMd(event.toAgent)
				const reason = escapeMd(event.reason)
				const handoffText = `🐝 *Agent Handoff*\n\n` +
					`*From:* ${from}\n` +
					`*To:* ${to}\n` +
					`*Reason:* ${reason}\n\n` +
					`_The conversation is now being handled by *${to}*\\._`
				try {
					await this.bot.api.sendMessage(Number(chatKey), handoffText, { parse_mode: 'MarkdownV2' })
				} catch (err) {
					// Fallback without markdown
					const plain = `🐝 Agent Handoff\n\nFrom: ${event.fromAgent}\nTo: ${event.toAgent}\nReason: ${event.reason}\n\nThe conversation is now being handled by ${event.toAgent}.`
					await this.bot.api.sendMessage(Number(chatKey), plain).catch(() => { })
				}
				break
			}
		}
	}

	async destroy(): Promise<void> {
		if (this.bot) {
			for (const state of this.chatStates.values()) {
				this.stopTyping(state)
			}
			this.bot.stop()
			console.log('[Telegram Bridge] Stopped.')
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

/** Escape all MarkdownV2 reserved characters. */
function escapeMd(text: string): string {
	return text.replace(/[_*[\]()~`>#+=|{}.!\-]/g, '\\$&')
}
