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
	 * Returns the list of active bridge names (e.g., 'discord', 'telegram').
	 */
	getActiveChannelIds(): string[] {
		return Array.from(this.activeBridges.keys())
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
	 * Broadcasts a generic text message to a specific bridge channel.
	 */
	async broadcastToChannel(channelId: string, message: string) {
		const bridge = this.activeBridges.get(channelId)
		if (bridge && typeof bridge.handleDaemonEvent === 'function') {
			// Fake a daemon event to send system text
			await bridge.handleDaemonEvent({ type: 'chunk', text: message } as DaemonEvent, {})
		}
	}
}
