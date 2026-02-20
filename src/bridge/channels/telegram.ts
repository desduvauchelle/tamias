import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'

export class TelegramBridge implements IBridge {
	name = 'telegram'
	private onMessage?: (msg: BridgeMessage, sessionId: string) => void

	async initialize(config: any, onMessage: (msg: BridgeMessage, sessionId: string) => void): Promise<void> {
		this.onMessage = onMessage
		console.log('[Telegram Bridge] Initializing... (Stub)')
		// TODO: Instantiate Telegram bot using config.bridges.telegram.botToken
	}

	async handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void> {
		console.log(`[Telegram Bridge] Received daemon event: ${event.type} for session ${sessionContext?.id}`)
		// TODO: Route daemon events back to telegram chat id
	}

	async destroy(): Promise<void> {
		console.log('[Telegram Bridge] Destroying... (Stub)')
	}
}
