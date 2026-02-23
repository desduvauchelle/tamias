import { Bot, InputFile } from 'grammy'
import { getBotTokenForBridge, type TamiasConfig } from '../../utils/config.ts'
import { VERSION } from '../../utils/version.ts'
import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'

interface TelegramContext {
	chatId: number
	messageId: number
	/** accumulated text chunks */
	buffer: string
	/** typing keepalive interval */
	typingInterval?: ReturnType<typeof setInterval>
}

export class TelegramBridge implements IBridge {
	name = 'telegram'
	private bot?: Bot
	private onMessage?: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean
	/** Map of chatId → in-flight context */
	private contexts = new Map<string, TelegramContext>()
	/** Map of chatId → sessionId */
	private chatSessions = new Map<string, string>()

	async initialize(config: TamiasConfig, onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean): Promise<void> {
		this.onMessage = onMessage
		const token = getBotTokenForBridge('telegram')
		if (!token) {
			console.error('[Telegram Bridge] No bot token configured. Skipping.')
			return
		}

		this.bot = new Bot(token)

		this.bot.on(['message:voice', 'message:audio'], async (ctx) => {
			const chatId = ctx.chat.id
			const messageId = ctx.message.message_id
			const chatKey = String(chatId)

			const sessionKey = this.chatSessions.get(chatKey) ?? `tg_${chatKey}`
			this.chatSessions.set(chatKey, sessionKey)

			try {
				await ctx.react('👀')
			} catch { /* old Telegram clients don't support this */ }

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
					channelName: ctx.chat.type === 'private' ? 'Private Chat' : (ctx.chat as any).title,
					authorId: String(ctx.from?.id),
					authorName: ctx.from?.first_name,
					content: transcript,
				}

				this.contexts.set(chatKey, { chatId, messageId, buffer: '' })
				await this.onMessage?.(bridgeMsg, sessionKey)
			} catch (err: any) {
				console.error('[Telegram Bridge] Audio transcription error:', err)
				try {
					await ctx.reply(`❌ Failed to process audio message: ${err.message}`, { reply_to_message_id: messageId })
				} catch { }
			}
		})

		this.bot.on('message:text', async (ctx) => {
			const chatId = ctx.chat.id
			const messageId = ctx.message.message_id
			const chatKey = String(chatId)

			const sessionKey = this.chatSessions.get(chatKey) ?? `tg_${chatKey}`
			this.chatSessions.set(chatKey, sessionKey)

			// 👀 React immediately to signal receipt
			try {
				await ctx.react('👀')
			} catch { /* Reactions not supported in all chats */ }

			const bridgeMsg: BridgeMessage = {
				channelId: 'telegram',
				channelUserId: chatKey,
				channelName: ctx.chat.type === 'private' ? 'Private Chat' : (ctx.chat as any).title,
				authorId: String(ctx.from?.id),
				authorName: ctx.from?.first_name,
				content: ctx.message.text,
			}

			this.contexts.set(chatKey, { chatId, messageId, buffer: '' })
			await this.onMessage?.(bridgeMsg, sessionKey)
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

		const ctx = this.contexts.get(chatKey)

		switch (event.type) {
			case 'start': {
				// 🧠 Add thinking reaction and start typing indicator
				if (ctx) {
					try {
						await this.bot.api.setMessageReaction(ctx.chatId, ctx.messageId, [{ type: 'emoji', emoji: '👀' }])
					} catch { /* old Telegram clients don't support this */ }

					// Send typing status every 4s (Telegram clears it after 5s)
					ctx.typingInterval = setInterval(async () => {
						await this.bot?.api.sendChatAction(ctx.chatId, 'typing').catch(() => { })
					}, 4000)
					// Send once immediately
					await this.bot?.api.sendChatAction(ctx.chatId, 'typing').catch(() => { })
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
					this.contexts.delete(chatKey)

					// Remove all reactions (pass empty array)
					try {
						await this.bot.api.setMessageReaction(ctx.chatId, ctx.messageId, [])
					} catch { }

					if (fullText.trim()) {
						try {
							const chunks = splitText(fullText, 4000)
							for (const chunk of chunks) {
								await this.bot.api.sendMessage(ctx.chatId, chunk, { parse_mode: 'Markdown' })
									.catch(() => this.bot!.api.sendMessage(ctx.chatId, chunk)) // fallback without markdown
							}
						} catch (err) {
							console.error(`[Telegram Bridge] Failed to send to ${chatKey}:`, err)
						}
					}
				}
				break
			}
			case 'error': {
				if (ctx) {
					clearInterval(ctx.typingInterval)
					this.contexts.delete(chatKey)
					try {
						await this.bot.api.setMessageReaction(ctx.chatId, ctx.messageId, [])
					} catch { }
					try {
						await this.bot.api.sendMessage(ctx.chatId, `⚠️ Error [v${VERSION}]: ${event.message}`)
					} catch (err) {
						console.error(`[Telegram Bridge] Failed to send error notification to chat ${chatKey}:`, err)
					}
				}
				break
			}
			case 'file': {
				if (ctx) {
					try {
						await this.bot.api.sendDocument(ctx.chatId, new InputFile(event.buffer, event.name))
					} catch (err) {
						console.error(`[Telegram Bridge] Failed to send file to ${chatKey}:`, err)
					}
				}
				break
			}
		}
	}

	async destroy(): Promise<void> {
		if (this.bot) {
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
