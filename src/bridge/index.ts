import type { TamiasConfig } from '../utils/config.ts'
import type { BridgeMessage, DaemonEvent, IBridge } from './types.ts'

/**
 * Manages the lifecycle of multiple translation bridges (e.g., terminal, discord).
 */
export class BridgeManager {
	private activeBridges = new Map<string, IBridge>()

	/**
	 * Starts all bridges that are enabled in the configuration.
	 */
	async initializeAll(
		config: TamiasConfig,
		onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean
	) {
		const bridgesDef = config.bridges

		// Initialize all Discord instances
		for (const [key, cfg] of Object.entries(bridgesDef?.discords ?? {})) {
			if (cfg.enabled) {
				const { DiscordBridge } = await import('./channels/discord')
				const discordBridge = new DiscordBridge(key)
				await this.startBridge(discordBridge, config, onMessage)
			}
		}

		// Initialize all Telegram instances
		for (const [key, cfg] of Object.entries(bridgesDef?.telegrams ?? {})) {
			if (cfg.enabled) {
				const { TelegramBridge } = await import('./channels/telegram')
				const telegramBridge = new TelegramBridge(key)
				await this.startBridge(telegramBridge, config, onMessage)
			}
		}

		// Initialize all WhatsApp instances
		for (const [key, cfg] of Object.entries((bridgesDef as any)?.whatsapps ?? {}) as [string, { enabled?: boolean }][]) {
			if (cfg.enabled) {
				const { WhatsAppBridge } = await import('./channels/whatsapp')
				const whatsappBridge = new WhatsAppBridge(key)
				await this.startBridge(whatsappBridge, config, onMessage)
			}
		}

		// Initialize all WhatsApp Unofficial (Baileys) instances
		for (const [key, cfg] of Object.entries((bridgesDef as any)?.whatsappUnofficials ?? {}) as [string, { enabled?: boolean }][]) {
			if (cfg.enabled) {
				const { WhatsAppUnofficialBridge } = await import('./channels/whatsapp-unofficial')
				const waUnoffBridge = new WhatsAppUnofficialBridge(key)
				await this.startBridge(waUnoffBridge, config, onMessage)
			}
		}

		// Terminal bridge logic is heavily coupled with HTTP SSE in `start.ts` currently,
		// but eventually we can load it here.
	}

	private async startBridge(
		bridge: IBridge,
		config: TamiasConfig,
		onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean
	) {
		try {
			await bridge.initialize(config, onMessage)
			this.activeBridges.set(bridge.name, bridge)
			console.log(`[Bridge Manager] Loaded bridge: ${bridge.name}`)
		} catch (err) {
			console.error(`[Bridge Manager] Failed to load bridge ${bridge.name}:`, err)
		}
	}

	/**
	 * Dispatches an event (text chunk, tool call, error) to a specific channel.
	 */
	async dispatchEvent(channelId: string, event: DaemonEvent, sessionContext: any) {
		const bridge = this.activeBridges.get(channelId)
		if (bridge) {
			await bridge.handleDaemonEvent(event, sessionContext)
		}
	}

	/**
	 * Shuts down all active bridges.
	 */
	async destroyAll() {
		for (const [name, bridge] of this.activeBridges) {
			try {
				await bridge.destroy()
				console.log(`[Bridge Manager] Stopped bridge: ${name}`)
			} catch (err) {
				console.error(`[Bridge Manager] Error stopping bridge ${name}:`, err)
			}
		}
		this.activeBridges.clear()
	}

	/**
	 * Directly registers a pre-initialized bridge instance.
	 * Used in tests and for runtime hot-registration without full config reload.
	 */
	registerBridge(bridge: IBridge) {
		this.activeBridges.set(bridge.name, bridge)
	}

	/**
	 * Returns the list of active bridge names (e.g., 'discord', 'telegram').
	 */
	getActiveChannelIds(): string[] {
		return Array.from(this.activeBridges.keys())
	}

	/**
	 * Returns the bridge registered under the given name key, or undefined.
	 */
	getBridgeByName(name: string): IBridge | undefined {
		return this.activeBridges.get(name)
	}

	/**
	 * Finds a bridge by its stable platform identifiers.
	 *
	 * Matching rules (migration-safe):
	 * - `platform` must match exactly.
	 * - If `platformAccountId` is provided AND the bridge also has a `platformAccountId`,
	 *   they must be equal. If either side is missing, any bridge for the platform matches.
	 *
	 * This means jobs created before `platformAccountId` was tracked will still
	 * resolve correctly as long as there is exactly one bridge for that platform.
	 */
	findBridgeByAccount(platform: string, platformAccountId?: string): IBridge | undefined {
		for (const bridge of this.activeBridges.values()) {
			if (bridge.platform !== platform) continue
			if (
				platformAccountId &&
				bridge.platformAccountId &&
				bridge.platformAccountId !== platformAccountId
			) continue
			return bridge
		}
		return undefined
	}

	/**
	 * Finds a WhatsApp bridge instance by its webhook path.
	 * Returns undefined if no match or if bridge is not a WhatsApp bridge.
	 */
	findWhatsAppByWebhookPath(pathname: string): any | undefined {
		for (const bridge of this.activeBridges.values()) {
			if (bridge.name.startsWith('whatsapp:') && typeof (bridge as any).getWebhookPath === 'function') {
				if ((bridge as any).getWebhookPath() === pathname) return bridge
			}
		}
		return undefined
	}

	/**
	 * Finds an unofficial WhatsApp bridge instance by its key.
	 */
	findWhatsAppUnofficialByKey(key: string): any | undefined {
		return this.activeBridges.get(`whatsapp-unofficial:${key}`)
	}

	/**
	 * Returns all unofficial WhatsApp bridge instances.
	 */
	getAllWhatsAppUnofficialBridges(): Array<{ key: string; bridge: any }> {
		const results: Array<{ key: string; bridge: any }> = []
		for (const [name, bridge] of this.activeBridges) {
			if (name.startsWith('whatsapp-unofficial:')) {
				results.push({ key: name.replace('whatsapp-unofficial:', ''), bridge })
			}
		}
		return results
	}

	/**
	 * Broadcasts a generic text message to a specific channel on a bridge.
	 * @param bridgeChannelId The bridge name (e.g. "discord:default-discord") used to look up the bridge.
	 * @param message The text to send.
	 * @param channelUserId The platform-level channel ID (e.g. the Discord snowflake) to send to.
	 *   When provided, bridges that implement sendDirect() will use this to fetch the exact channel.
	 */
	async broadcastToChannel(bridgeChannelId: string, message: string, channelUserId?: string) {
		const bridge = this.activeBridges.get(bridgeChannelId)
		if (!bridge) return
		// Prefer sendDirect when available — it bypasses the session/event plumbing
		// entirely and doesn't require a valid channelUserId in sessionContext.
		if (channelUserId && typeof (bridge as any).sendDirect === 'function') {
			await (bridge as any).sendDirect(channelUserId, message).catch(console.error)
			return
		}
		if (typeof bridge.handleDaemonEvent === 'function') {
			// Fallback: fake a daemon event (only works for bridges that don't need a snowflake)
			await bridge.handleDaemonEvent({ type: 'chunk', text: message } as DaemonEvent, {})
		}
	}

	/**
	 * Returns human-readable cron targets discovered from active bridges.
	 */
	async getCronTargets(): Promise<Array<{ target: string; label: string; platform: string; source: string }>> {
		const targets: Array<{ target: string; label: string; platform: string; source: string }> = []

		for (const bridge of this.activeBridges.values()) {
			const listCronTargets = (bridge as any).listCronTargets
			if (typeof listCronTargets !== 'function') continue

			try {
				const discovered = await listCronTargets.call(bridge)
				if (!Array.isArray(discovered)) continue
				for (const item of discovered) {
					if (!item?.target || !item?.label) continue
					targets.push({
						target: String(item.target),
						label: String(item.label),
						platform: String(item.platform ?? 'unknown'),
						source: String(item.source ?? 'bridge'),
					})
				}
			} catch (err) {
				console.warn(`[Bridge Manager] Failed to discover cron targets from ${bridge.name}:`, err)
			}
		}

		const seen = new Set<string>()
		return targets.filter(t => {
			if (seen.has(t.target)) return false
			seen.add(t.target)
			return true
		})
	}

	/**
	 * Returns all discord channels accessible by the active Discord bots.
	 */
	async getAllDiscordChannels(): Promise<Array<{ id: string; name: string; guildId: string; guildName: string; instanceKey: string }>> {
		const channels: Array<{ id: string; name: string; guildId: string; guildName: string; instanceKey: string }> = []

		for (const bridge of this.activeBridges.values()) {
			const listAllChannels = (bridge as any).listAllChannels
			if (typeof listAllChannels !== 'function') continue

			try {
				const discovered = await listAllChannels.call(bridge)
				if (!Array.isArray(discovered)) continue
				channels.push(...discovered)
			} catch (err) {
				console.warn(`[Bridge Manager] Failed to discover discord channels from ${bridge.name}:`, err)
			}
		}

		return channels
	}
}
