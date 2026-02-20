import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getAllConnections, getDefaultModel } from '../utils/config.ts'
import { isDaemonRunning, autoStartDaemon, getDaemonUrl } from '../utils/daemon.ts'
import { isOnboarded } from '../utils/memory.ts'
import { runOnboarding } from './onboarding.ts'

// ─── SSE parser ────────────────────────────────────────────────────────────────
// Bun v1.1.29 has no EventSource — parse SSE from a plain fetch ReadableStream.

interface SseEvent { event: string; data: string }

async function* parseSseStream(res: Response): AsyncGenerator<SseEvent> {
	if (!res.body) return
	const decoder = new TextDecoder()
	const reader = res.body.getReader()
	let buffer = ''
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const blocks = buffer.split('\n\n')
			buffer = blocks.pop() ?? ''
			for (const block of blocks) {
				if (!block.trim()) continue
				let event = 'message'
				let data = ''
				for (const line of block.split('\n')) {
					if (line.startsWith('event:')) event = line.slice(6).trim()
					else if (line.startsWith('data:')) data = line.slice(5).trim()
				}
				yield { event, data }
			}
		}
	} finally {
		reader.releaseLock()
	}
}

// ─── Main chat command ─────────────────────────────────────────────────────────

export const runChatCommand = async () => {
	// ── Onboarding gate ────────────────────────────────────────────────────────
	if (!isOnboarded()) {
		await runOnboarding()
	}

	p.intro(pc.bgMagenta(pc.black(' Tamias Chat ')))

	const connections = getAllConnections()
	if (connections.length === 0) {
		p.cancel(pc.yellow('No models configured. Run `tamias config` first.'))
		process.exit(1)
	}

	type ModelOption = { connectionNickname: string; modelId: string }
	const modelOptions: ModelOption[] = []
	for (const c of connections) {
		for (const modelId of c.selectedModels ?? []) {
			modelOptions.push({ connectionNickname: c.nickname, modelId })
		}
	}
	if (modelOptions.length === 0) {
		p.cancel(pc.yellow('No models selected. Run `tamias models edit` to pick some.'))
		process.exit(1)
	}

	const defaultModel = getDefaultModel()
	const defaultIndex = defaultModel
		? modelOptions.findIndex((o) => `${o.connectionNickname}/${o.modelId}` === defaultModel)
		: -1

	const selectedValue = await p.select({
		message: 'Select a model:',
		options: modelOptions.map((o, i) => ({
			value: String(i),
			label: i === defaultIndex
				? `${pc.bold(o.connectionNickname)}${pc.dim('/')}${o.modelId} ${pc.dim('(default)')}`
				: `${pc.bold(o.connectionNickname)}${pc.dim('/')}${o.modelId}`,
		})),
		initialValue: defaultIndex >= 0 ? String(defaultIndex) : '0',
	})
	if (p.isCancel(selectedValue)) { p.cancel('Chat cancelled.'); process.exit(0) }

	const chosen = modelOptions[Number(selectedValue)]!
	const modelStr = `${chosen.connectionNickname}/${chosen.modelId}`

	// ── Ensure daemon running ─────────────────────────────────────────────────
	const connectSpinner = p.spinner()
	connectSpinner.start('Connecting to daemon...')
	let daemonUrl: string
	try {
		if (!(await isDaemonRunning())) {
			connectSpinner.message('Starting daemon...')
			await autoStartDaemon()
		}
		daemonUrl = getDaemonUrl()
		connectSpinner.stop(pc.green('✓ Connected to daemon'))
	} catch (err) {
		connectSpinner.stop(pc.red(`Failed: ${err}`))
		process.exit(1)
	}

	// ── Create session ─────────────────────────────────────────────────────────
	let sessionId: string
	try {
		const res = await fetch(`${daemonUrl}/session`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: modelStr }),
		})
		const data = await res.json() as { sessionId?: string; error?: string }
		if (!data.sessionId) throw new Error(data.error ?? 'Unknown error')
		sessionId = data.sessionId
	} catch (err) {
		p.cancel(pc.red(`Failed to create session: ${err}`))
		process.exit(1)
	}

	// ── Open ONE persistent SSE stream for this session ────────────────────────
	// We keep this connection alive for all messages — no re-connect per message.
	const sseAbort = new AbortController()
	let sseResponse: Response
	try {
		sseResponse = await fetch(`${daemonUrl}/session/${sessionId}/stream`, {
			headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
			signal: sseAbort.signal,
		})
		if (!sseResponse.ok) throw new Error(`SSE open failed: ${sseResponse.status}`)
	} catch (err) {
		p.cancel(pc.red(`Failed to open SSE stream: ${err}`))
		process.exit(1)
	}

	const sseGen = parseSseStream(sseResponse)

	p.outro(pc.green(`Session ${pc.bold(sessionId)} — ${modelStr}\nType 'exit' to quit.`))

	// Cleanup: close SSE + delete session
	const cleanup = async () => {
		sseAbort.abort()
		await fetch(`${daemonUrl}/session/${sessionId}`, { method: 'DELETE' }).catch(() => { })
		p.outro(pc.dim('Goodbye!'))
		process.exit(0)
	}
	process.on('SIGINT', cleanup)

	// ── Chat loop ──────────────────────────────────────────────────────────────
	while (true) {
		const input = await p.text({
			message: pc.cyan('You:'),
			placeholder: 'Type your message...',
			validate: (v) => { if (!v?.trim()) return 'Please enter a message' },
		})
		if (p.isCancel(input) || (input as string).toLowerCase() === 'exit' || (input as string).toLowerCase() === 'quit') {
			await cleanup(); break
		}

		// Post message
		await fetch(`${daemonUrl}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId, content: input }),
		}).catch((err) => console.error(pc.red(`Send failed: ${err}`)))

		// Read events from the persistent stream until 'done' or 'error'
		const spinner = p.spinner()
		spinner.start('Thinking...')
		let aiStarted = false

		try {
			while (true) {
				const { value: evt, done: streamDone } = await sseGen.next()
				if (streamDone) { spinner.stop(''); break }

				if (evt.event === 'start') {
					// spinner is already running
				} else if (evt.event === 'chunk') {
					const { text } = JSON.parse(evt.data) as { text: string }
					if (!aiStarted) { spinner.stop('AI:'); process.stdout.write(pc.magenta('\nAI: ')); aiStarted = true }
					process.stdout.write(text)
				} else if (evt.event === 'tool_call') {
					const { name, input: toolInput } = JSON.parse(evt.data) as { name: string; input: unknown }
					if (!aiStarted) { spinner.stop(''); aiStarted = true }
					process.stdout.write(pc.dim(`\n🔧 ${name}: ${JSON.stringify(toolInput).slice(0, 150)}\n`))
				} else if (evt.event === 'done') {
					break  // response complete — do NOT abort; keep SSE stream alive
				} else if (evt.event === 'error') {
					const { message } = JSON.parse(evt.data) as { message?: string }
					if (!aiStarted) spinner.stop('')
					console.error(pc.red(`\nError: ${message}`))
					break
				}
			}
		} catch (err: unknown) {
			spinner.stop('')
			if (!(err instanceof Error && err.name === 'AbortError')) {
				console.error(pc.red(`\nStream error: ${err}`))
			}
		}

		if (!aiStarted) spinner.stop('')
		console.log('\n')
	}
}
