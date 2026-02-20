export interface BridgeMessage {
	channelId: string
	channelUserId: string
	content: string
	attachments?: Array<{
		type: 'image' | 'file'
		url?: string
		buffer?: Buffer
		mimeType: string
	}>
}

export type DaemonEvent =
	| { type: 'start'; sessionId: string }
	| { type: 'chunk'; text: string }
	| { type: 'tool_call'; name: string; input: unknown }
	| { type: 'done'; sessionId: string }
	| { type: 'error'; message: string }

export interface IBridge {
	name: string

	/**
	 * Called when the daemon starts up or the bridge is enabled.
	 *
	 * @param config The entire `TamiasConfig` or bridge-specific config slice.
	 * @param onMessage The bridge should call this when a message arrives from the channel.
	 */
	initialize(
		config: any,
		onMessage: (msg: BridgeMessage, sessionId: string) => void
	): Promise<void>

	/**
	 * Called by the Daemon to send an event back to the specific channel session.
	 * The bridge should translate the `DaemonEvent` and deliver it to the external interface.
	 */
	handleDaemonEvent(event: DaemonEvent, sessionContext: any): Promise<void>

	/**
	 * Shut down background listeners, close sockets, etc.
	 */
	destroy(): Promise<void>
}
