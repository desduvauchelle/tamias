export interface ParsedStreamEvent {
	type: 'text' | 'tool_use' | 'result' | 'unknown'
	content: string
	costUsd?: number
	sessionId?: string
	isError?: boolean
}

export function parseStreamLine(line: string): ParsedStreamEvent | null {
	const trimmed = line.trim()
	if (!trimmed) return null

	try {
		const parsed = JSON.parse(trimmed)

		if (parsed.type === 'assistant' && parsed.message?.content) {
			const textParts = parsed.message.content
				.filter((c: { type: string }) => c.type === 'text')
				.map((c: { text?: string }) => c.text ?? '')
				.join('')
			if (textParts) return { type: 'text', content: textParts }

			const toolParts = parsed.message.content
				.filter((c: { type: string }) => c.type === 'tool_use')
				.map((c: { name?: string; input?: Record<string, unknown> }) => {
					const name = c.name ?? 'unknown'
					if (name === 'Write' && c.input?.content) return `[Tool: Write to ${c.input.file_path ?? 'unknown file'}]\n${c.input.content}`
					if (name === 'Edit' && c.input?.new_string) return `[Tool: Edit ${c.input.file_path ?? 'unknown file'}]\nNew content:\n${c.input.new_string}`
					return `[Tool: ${name}]`
				})
				.join('\n')
			if (toolParts) return { type: 'tool_use', content: toolParts }
		}

		if (parsed.type === 'result') {
			return { type: 'result', content: parsed.result ?? '', costUsd: parsed.cost_usd, sessionId: parsed.session_id, isError: parsed.is_error }
		}

		return { type: 'unknown', content: trimmed }
	} catch {
		return { type: 'text', content: trimmed }
	}
}
