import { tool, generateImage } from 'ai'
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { AIService } from '../services/aiService'
import { loadConfig, getApiKeyForConnection, getDefaultImageModels, type ConnectionConfig } from '../utils/config'
import type { DaemonEvent } from '../bridge/types'

export const IMAGE_TOOL_NAME = 'image'
export const IMAGE_TOOL_LABEL = '🖼️ Image (AI image generation)'

export function createImageTools(aiService: AIService, sessionId: string) {
	return {
		generate: tool({
			description: 'Generate an AI image from a text prompt.',
			inputSchema: z.object({
				prompt: z.string().describe('Detailed description of the image to generate.'),
				size: z.enum(['256x256', '512x512', '1024x1024']).optional().default('1024x1024').describe('Image dimensions.'),
			}),
			execute: async ({ prompt, size }) => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				const modelsToTry = getDefaultImageModels()
				if (modelsToTry.length === 0) {
					return {
						success: false,
						error: 'No image models configured. Please run `tamias model set-image` in your terminal to select one or more image models.'
					}
				}

				const config = loadConfig()
				let lastError: any = null

				for (let i = 0; i < modelsToTry.length; i++) {
					const modelStr = modelsToTry[i]
					const [nickname, ...rest] = modelStr.split('/')
					const modelId = rest.join('/') || modelStr
					const connection = config.connections[nickname]

					if (!connection) {
						console.warn(`[ImageTool] No connection config for "${nickname}" — skipping`)
						continue
					}

					try {
						const imageModel = buildImageModel(connection, modelId)

						// If this is not the first attempt, notify the user
						if (i > 0) {
							const msg = `\n🔄 Model ${modelsToTry[i - 1]} not functioning, trying model ${modelStr}...\n`
							session.emitter.emit('event', { type: 'chunk', text: msg } as DaemonEvent)
						}

						const result = await generateImage({
							model: imageModel,
							prompt,
							size: size as any,
						})

						const image = result.image
						const fileName = `generated_${Date.now()}.png`

						// Emit file event to send the image back to the channel
						session.emitter.emit('event', {
							type: 'file',
							name: fileName,
							buffer: Buffer.from(image.uint8Array),
							mimeType: 'image/png'
						} as DaemonEvent)

						return {
							success: true,
							message: `Successfully generated image using ${modelStr}.`,
							fileName,
							modelUsed: modelStr
						}
					} catch (err: any) {
						lastError = err
						const errMsg = err?.message || String(err)
						console.error(`[ImageTool] Failed with model ${modelStr}: ${errMsg}`)

						// Notify user about the failure if there are more models to try
						if (i < modelsToTry.length - 1) {
							const nextModel = modelsToTry[i + 1]
							const statusMsg = `\n⚠️ Model ${modelStr} failed: ${errMsg.slice(0, 100)}${errMsg.length > 100 ? '...' : ''}\nTrying fallback model ${nextModel}...\n(You can manage image models using \`tamias model set-image\`)\n`
							session.emitter.emit('event', { type: 'chunk', text: statusMsg } as DaemonEvent)
						}
					}
				}

				return {
					success: false,
					error: `All image models failed. Last error: ${lastError?.message || String(lastError)}. Use \`tamias model set-image\` to reconfigure.`
				}
			},
		}),
	}
}

function buildImageModel(connection: ConnectionConfig, modelId: string): any {
	const apiKey = getApiKeyForConnection(connection.nickname)
	switch (connection.provider) {
		case 'openai': return createOpenAI({ apiKey }).image(modelId)
		case 'google': return createGoogleGenerativeAI({ apiKey }).image(modelId)
		// Add more image providers here as they become supported by AI SDK or manually
		default:
			// For providers like Anthropic which don't support image generation, or others
			throw new Error(`Provider "${connection.provider}" does not support image generation via Vercel AI SDK (yet).`)
	}
}
