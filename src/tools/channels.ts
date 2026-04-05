import { tool } from 'ai'
import { z } from 'zod'
import type { AIService } from '../services/aiService.ts'
import type { DaemonEvent } from '../bridge/types.ts'
import { getDaemonUrl } from '../utils/daemon.ts'

export const CHANNELS_TOOL_NAME = 'channels'
export const CHANNELS_TOOL_LABEL = '📡 Channels (Discord, Telegram, WhatsApp management)'

export function createChannelsTools(aiService: AIService, sessionId: string) {
	return {

		list: tool({
			description: 'List all configured communication channels (Terminal, Discord, Telegram, WhatsApp) and their status.',
			inputSchema: z.object({}),
			execute: async () => {
				const { getBridgesConfig } = await import('../utils/config.ts')
				const bridges = getBridgesConfig()
				// Check unofficial WhatsApp instances
				const whatsappUnofficials: Record<string, any> = {}
				for (const [key, cfg] of Object.entries(bridges.whatsappUnofficials ?? {})) {
					whatsappUnofficials[key] = {
						enabled: cfg.enabled,
						mode: cfg.mode ?? 'read-only',
						allowedGroups: cfg.allowedGroups ?? [],
						allowedContacts: cfg.allowedContacts ?? [],
					}
				}
				return {
					terminal: { enabled: bridges.terminal?.enabled !== false },
					discord: bridges.discords?.default
						? { enabled: bridges.discords.default.enabled, hasToken: !!bridges.discords.default.envKeyName, allowedChannels: bridges.discords.default.allowedChannels }
						: {
							enabled: false,
							hasToken: false,
							setupInstructions: "1. Go to https://discord.com/developers/applications\n2. Create or select your application\n3. Go to the 'Bot' tab\n4. Click 'Reset Token' to copy your bot token. Then use configure_channel to save it."
						},
					telegram: bridges.telegrams?.default
						? { enabled: bridges.telegrams.default.enabled, hasToken: !!bridges.telegrams.default.envKeyName, allowedChats: bridges.telegrams.default.allowedChats }
						: {
							enabled: false,
							hasToken: false,
							setupInstructions: "1. Message @BotFather on Telegram\n2. Create a new bot with /newbot\n3. Copy the API token provided. Then use configure_channel to save it."
						},
					whatsappUnofficial: Object.keys(whatsappUnofficials).length > 0
						? whatsappUnofficials
						: {
							setupInstructions: "Use the setup_whatsapp_unofficial tool with action 'link' to connect your personal WhatsApp via QR code. No Meta Business account needed."
						},
				}
			},
		}),

		configure: tool({
			description: 'Enable/disable a communication channel or update its token and allowed IDs.',
			inputSchema: z.object({
				platform: z.enum(['terminal', 'discord', 'telegram']),
				enabled: z.boolean(),
				botToken: z.string().optional().describe('API token for Discord or Telegram'),
				allowedIds: z.array(z.string()).optional().describe('List of allowed channel/chat IDs'),
			}),
			execute: async ({ platform, enabled, botToken, allowedIds }) => {
				const { getBridgesConfig, setBridgesConfig } = await import('../utils/config.ts')
				const bridges = getBridgesConfig()

				if (platform === 'terminal') {
					bridges.terminal = { ...bridges.terminal, enabled }
				} else if (platform === 'discord') {
					if (!bridges.discords) bridges.discords = {}
					const prevDiscord = bridges.discords.default ?? {}
					bridges.discords.default = {
						...prevDiscord,  // preserve envKeyName and all existing settings
						enabled,
						...(allowedIds !== undefined ? { allowedChannels: allowedIds } : {}),
					}
				} else if (platform === 'telegram') {
					if (!bridges.telegrams) bridges.telegrams = {}
					const prevTelegram = bridges.telegrams.default ?? {}
					bridges.telegrams.default = {
						...prevTelegram,  // preserve envKeyName and all existing settings
						enabled,
						...(allowedIds !== undefined ? { allowedChats: allowedIds } : {}),
					}
				}

				setBridgesConfig(bridges)
				return { success: true, platform, enabled }
			},
		}),

		setup_whatsapp: tool({
			description: 'Set up, configure, or manage an unofficial WhatsApp (personal) connection via QR code. Works from any channel — Discord, Telegram, Terminal, or dashboard. Actions: link (generate QR code to scan), list-groups (show available groups after linking), select-groups (choose which groups to monitor), select-contacts (choose which DMs to allow), status (check connection), unlink (disconnect and remove).',
			inputSchema: z.object({
				action: z.enum(['link', 'list-groups', 'select-groups', 'select-contacts', 'status', 'unlink']),
				instanceKey: z.string().optional().describe('Instance name (e.g. "personal", "work"). Defaults to "default".'),
				groups: z.array(z.string()).optional().describe('For select-groups: array of group JIDs to monitor, or ["*"] for all'),
				contacts: z.array(z.string()).optional().describe('For select-contacts: array of phone numbers in E.164 format, or ["*"] for all'),
				mode: z.enum(['full', 'read-only', 'mention-only']).optional().describe('Channel mode: read-only (default) = receive only, mention-only = regex prefilter before AI, full = send and receive'),
				mentionPattern: z.string().optional().describe('Regex pattern used in mention-only mode. Case-insensitive. Default: \\btamias\\b'),
			}),
			execute: async ({ action, instanceKey, groups, contacts, mode, mentionPattern }) => {
				const key = instanceKey || 'default'
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const daemonUrl = getDaemonUrl()

					if (action === 'link') {
						// Trigger QR login via daemon endpoint
						const res = await fetch(`${daemonUrl}/whatsapp-unofficial/${key}/login`, { method: 'POST' })
						const data = await res.json() as any
						if (!res.ok) return { success: false, error: data.error || 'Login failed' }

						// Send QR code as image to the current channel
						if (data.qrDataUrl) {
							const base64Data = data.qrDataUrl.replace(/^data:image\/png;base64,/, '')
							const qrBuffer = Buffer.from(base64Data, 'base64')
							session.emitter.emit('event', {
								type: 'file',
								name: `whatsapp-qr-${key}.png`,
								buffer: qrBuffer,
								mimeType: 'image/png',
							} as DaemonEvent)
						}

						return {
							success: true,
							message: `QR code sent! Scan it with WhatsApp on your phone to link instance "${key}". After scanning, use this tool with action "list-groups" to see available groups.`,
							instanceKey: key,
						}
					}

					if (action === 'status') {
						const res = await fetch(`${daemonUrl}/whatsapp-unofficial/${key}/status`)
						if (!res.ok) return { success: false, error: 'Instance not found or not running' }
						const data = await res.json()
						return { success: true, ...data }
					}

					if (action === 'list-groups') {
						const res = await fetch(`${daemonUrl}/whatsapp-unofficial/${key}/groups`)
						if (!res.ok) return { success: false, error: 'Instance not found or not connected' }
						const data = await res.json() as any
						const groupList = (data.groups || []).map((g: any, i: number) => ({
							number: i + 1,
							name: g.name,
							jid: g.jid,
							participants: g.participantCount,
						}))
						return {
							success: true,
							groups: groupList,
							message: `Found ${groupList.length} groups. Use select-groups with the JIDs you want to monitor.`,
						}
					}

					if (action === 'select-groups') {
						if (!groups || groups.length === 0) return { success: false, error: 'No groups provided. Pass an array of group JIDs.' }
						const res = await fetch(`${daemonUrl}/whatsapp-unofficial/${key}/select`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ allowedGroups: groups, ...(mode ? { mode } : {}), ...(mentionPattern ? { mentionPattern } : {}) }),
						})
						if (!res.ok) return { success: false, error: 'Failed to update groups' }
						return { success: true, message: `Now monitoring ${groups.includes('*') ? 'ALL' : groups.length} group(s).`, groups }
					}

					if (action === 'select-contacts') {
						if (!contacts || contacts.length === 0) return { success: false, error: 'No contacts provided. Pass phone numbers in E.164 format or ["*"] for all.' }
						const res = await fetch(`${daemonUrl}/whatsapp-unofficial/${key}/select`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ allowedContacts: contacts, ...(mode ? { mode } : {}), ...(mentionPattern ? { mentionPattern } : {}) }),
						})
						if (!res.ok) return { success: false, error: 'Failed to update contacts' }
						return { success: true, message: `Now allowing DMs from ${contacts.includes('*') ? 'ALL contacts' : contacts.length + ' contact(s)'}.`, contacts }
					}

					if (action === 'unlink') {
						const res = await fetch(`${daemonUrl}/whatsapp-unofficial/${key}/unlink`, { method: 'POST' })
						if (!res.ok) return { success: false, error: 'Failed to unlink' }
						return { success: true, message: `WhatsApp instance "${key}" has been unlinked and auth data cleared.` }
					}

					return { success: false, error: `Unknown action: ${action}` }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),

	}
}
