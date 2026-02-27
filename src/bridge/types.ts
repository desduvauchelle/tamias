export interface BridgeMessage {
	channelId: string
	channelUserId: string
	channelName?: string
	authorId?: string
	authorName?: string
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
	| { type: 'tool_result'; name: string; result: unknown }
	| { type: 'done'; sessionId: string; suppressed?: boolean }
	| { type: 'error'; message: string }
	| { type: 'file'; name: string; buffer: Buffer; mimeType: string }
	| { type: 'subagent-status'; subagentId: string; task: string; status: 'started' | 'progress' | 'completed' | 'failed'; message: string }
	| { type: 'agent-handoff'; fromAgent: string; toAgent: string; reason: string }
	| { type: 'progress-update'; title: string; message: string; step?: number; totalSteps?: number }

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
		onMessage: (msg: BridgeMessage, sessionId: string) => Promise<boolean> | boolean
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
