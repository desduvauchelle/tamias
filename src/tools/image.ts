import { tool, generateImage } from 'ai'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { AIService } from '../services/aiService'
import { loadConfig, getApiKeyForConnection, getDefaultImageModels, type ConnectionConfig, TAMIAS_DIR } from '../utils/config'
import type { DaemonEvent } from '../bridge/types'
import { logAiRequest } from '../utils/logger'
import { getImageCost } from '../utils/pricing'

export const IMAGE_TOOL_NAME = 'image'
export const IMAGE_TOOL_LABEL = '🖼️ Image (AI image generation)'

const dataUrlToBase64 = (value: string): string => {
	const dataUrlMatch = value.match(/^data:[^;]+;base64,(.+)$/)
	if (!dataUrlMatch) return value
	return dataUrlMatch[1]
}

const getErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message
	if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
		return error.message
	}
	return String(error)
}

export function createImageTools(aiService: AIService, sessionId: string, workspacePath?: string) {
	return {
		generate: tool({
			description: 'Generate a new AI image or edit an existing image from a text prompt.',
			inputSchema: z.object({
				prompt: z.string().describe('Detailed description of the image to generate.'),
				size: z.enum(['256x256', '512x512', '1024x1024']).optional().default('1024x1024').describe('Image dimensions.'),
				mode: z.enum(['generate', 'edit']).optional().default('generate').describe('Whether to create a new image or edit an existing one.'),
				sourceImageUrl: z.string().optional().describe('Required when mode is "edit". Can be a data URL or base64 image string.'),
			}),
			execute: async ({ prompt, size, mode, sourceImageUrl }) => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				if (mode === 'edit' && !sourceImageUrl) {
					return {
						success: false,
						error: 'Missing sourceImageUrl for edit mode.'
					}
				}

				const modelsToTry = getDefaultImageModels()
				if (modelsToTry.length === 0) {
					return {
						success: false,
						error: 'No image models configured. Please run `tamias model set-image` in your terminal to select one or more image models.'
					}
				}

				const config = loadConfig()
				let lastError: any = null
				const imagePrompt: string | { images: string[]; text: string } = mode === 'edit' && sourceImageUrl
					? {
						images: [dataUrlToBase64(sourceImageUrl)],
						text: prompt,
					}
					: prompt

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

						const startTime = Date.now()
						const result = await generateImage({
							model: imageModel,
							prompt: imagePrompt,
							// Always request exactly one image unless we explicitly expose multi-image generation.
							n: 1,
							size,
						})

						const image = result.image
						const fileName = `generated_${Date.now()}.png`
						const targetDir = workspacePath || join(TAMIAS_DIR, 'generated-images')
						mkdirSync(targetDir, { recursive: true })
						const filePath = join(targetDir, fileName)

						// Write image to disk so the AI can reference it
						const buffer = Buffer.from(image.uint8Array)
						writeFileSync(filePath, buffer)

						// Log image generation cost
						const imageCost = getImageCost(modelId, size)
						logAiRequest({
							timestamp: new Date().toISOString(),
							sessionId,
							model: modelStr,
							provider: nickname,
							action: 'image',
							durationMs: Date.now() - startTime,
							messages: [{ role: 'user', content: typeof imagePrompt === 'string' ? imagePrompt : imagePrompt.text }],
							response: `Generated image: ${filePath}`,
							providerCostUsd: imageCost,
						})

						// Emit file event to send the image back to the channel
						session.emitter.emit('event', {
							type: 'file',
							name: fileName,
							buffer,
							mimeType: 'image/png'
						} as DaemonEvent)

						return {
							success: true,
							message: `Successfully generated image using ${modelStr}.`,
							fileName,
							filePath,
							modelUsed: modelStr
						}
					} catch (err: any) {
						lastError = err
						const errMsg = getErrorMessage(err)
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
					error: mode === 'edit' && /(edit|images|mask)/i.test(getErrorMessage(lastError))
						? 'Image editing is not supported by the configured image models. Please choose another model with `tamias model set-image`.'
						: `All image models failed. Last error: ${lastError?.message || String(lastError)}. Use \`tamias model set-image\` to reconfigure.`
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
		case 'openrouter':
			return createOpenRouter({ apiKey }).imageModel(modelId, {
				// Some upstream providers can default to multi-image outputs if omitted.
				extraBody: { n: 1 },
			})
		default:
			throw new Error(`Provider "${connection.provider}" does not support image generation via Vercel AI SDK (yet).`)
	}
}
