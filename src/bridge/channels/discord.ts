import type { BridgeMessage, DaemonEvent, IBridge } from '../types.ts'

export class DiscordBridge implements IBridge {
	name = 'discord'
	private onMessage?: (msg: BridgeMessage, sessionId: string) => void

	async initialize(config: any, onMessage: (msg: BridgeMessage, sessionId: string) => void): Promise<void> {
		this.onMessage = onMessage
		console.log('[Discord Bridge] Initializing... (Stub)')
		// TODO:
		// 1. Instantiate Discord.js Client using config.bridges.discord.botToken
		// 2. Listen for 'messageCreate' and map to BridgeMessage format
		// 3. Trigger this.onMessage(msg, 'mapped_session_id')
		// 4. Connect to discord gateway
	}

	async handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void> {
		console.log(`[Discord Bridge] Received daemon event: ${event.type} for session ${sessionContext?.id}`)
		// TODO:
		// If event.type === 'start' or 'chunk', edit or create a discord message.
		// Use sessionContext.channelUserId to know where to send it.
	}

	async destroy(): Promise<void> {
		console.log('[Discord Bridge] Destroying... (Stub)')
		// TODO: Disconnect Discord.js client
	}
}
