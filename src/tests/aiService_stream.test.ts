import { expect, test, describe, spyOn, beforeEach } from "bun:test"
import { AIService } from "../services/aiService"
import { BridgeManager } from "../bridge"
import { EventEmitter } from "events"
import type { DaemonEvent } from "../bridge/types"
import * as configUtils from "../utils/config"

describe("AIService Streaming", () => {
	let aiService: AIService
	let bridgeManager: BridgeManager

	beforeEach(() => {
		bridgeManager = new BridgeManager()
		aiService = new AIService(bridgeManager)

		// Mock config to have no connections so we trigger the error path
		spyOn(configUtils, 'loadConfig').mockReturnValue({ connections: {} } as any)
	})

	test("emits 'done' after 'error' when no models are configured", async () => {
		const session = aiService.createSession({ id: "test-stream" })
		const events: DaemonEvent[] = []

		session.emitter.on('event', (e: DaemonEvent) => {
			events.push(e)
		})

		// This will trigger the no-models-configured path
		await aiService.enqueueMessage(session.id, "Hello")

		// Wait a tick for the async processing to finish
		await new Promise(resolve => setTimeout(resolve, 50))

		// Should have emitted error -> done
		expect(events.length).toBeGreaterThanOrEqual(2)
		const eventTypes = events.map(e => e.type)

		expect(eventTypes).not.toContain('start')
		expect(eventTypes).toContain('error')
		expect(eventTypes).toContain('done')

		// Error must come BEFORE done
		const errorIdx = eventTypes.indexOf('error')
		const doneIdx = eventTypes.indexOf('done')
		expect(errorIdx).toBeLessThan(doneIdx)

		// Ensure it was the config error
		const errorEvent = events[errorIdx] as Extract<DaemonEvent, { type: 'error' }>
		expect(errorEvent.message).toContain("No AI connections configured")
	})
})
