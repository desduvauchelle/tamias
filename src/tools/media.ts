import { tool, generateImage } from 'ai'
import { z } from 'zod'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { AIService } from '../services/aiService.ts'
import type { DaemonEvent } from '../bridge/types.ts'
import { loadConfig, getApiKeyForConnection, getDefaultImageModels, type ConnectionConfig, TAMIAS_DIR } from '../utils/config.ts'
import { logAiRequest } from '../utils/logger.ts'
import { getImageCost } from '../utils/pricing.ts'

export const MEDIA_TOOL_NAME = 'media'
export const MEDIA_TOOL_LABEL = '🎨 Media (image generation, PDF, carousel, file sending)'

// ── Image helpers ───────────────────────────────────────────────────────────────

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

// ── PDF / Playwright helpers ────────────────────────────────────────────────────

const PLAYWRIGHT_PATH = join(TAMIAS_DIR, 'node_modules', 'playwright')

async function loadPlaywright() {
	try {
		return await import(PLAYWRIGHT_PATH) as typeof import('playwright')
	} catch {
		throw new Error(
			'Playwright is not installed. Run: tamias browser --setup'
		)
	}
}

// ── Social media dimension presets (CSS pixels @ 96 dpi) ──────────────────────
const SLIDE_PRESETS = {
	'linkedin-square': { width: 1080, height: 1080, label: 'LinkedIn Square (1:1)' },
	'linkedin-portrait': { width: 1080, height: 1350, label: 'LinkedIn Portrait (4:5)' },
	'instagram-square': { width: 1080, height: 1080, label: 'Instagram Square (1:1)' },
	'instagram-portrait': { width: 1080, height: 1350, label: 'Instagram Portrait (4:5)' },
	'instagram-story': { width: 1080, height: 1920, label: 'Instagram Story (9:16)' },
	'twitter': { width: 1200, height: 675, label: 'Twitter/X Landscape (16:9)' },
} as const

// ── HTML helpers ───────────────────────────────────────────────────────────────
function htmlEscape(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function buildMarkdownHtml(bodyHtml: string, theme: 'light' | 'dark' | 'github'): string {
	const themes: Record<string, string> = {
		light: `
			body { background: #ffffff; color: #1a1a1a; }
			code, pre { background: #f5f5f5; }
			blockquote { border-left: 4px solid #ddd; color: #555; }
			a { color: #0969da; }
			table th { background: #f0f0f0; }
			table td, table th { border: 1px solid #d0d0d0; }
		`,
		dark: `
			body { background: #0d1117; color: #e6edf3; }
			code, pre { background: #161b22; color: #e6edf3; }
			blockquote { border-left: 4px solid #30363d; color: #8b949e; }
			a { color: #58a6ff; }
			table th { background: #161b22; }
			table td, table th { border: 1px solid #30363d; }
			h1, h2, h3, h4 { border-color: #30363d; }
		`,
		github: `
			body { background: #ffffff; color: #1f2328; }
			code, pre { background: #f6f8fa; color: #1f2328; }
			blockquote { border-left: 4px solid #d0d7de; color: #656d76; }
			a { color: #0969da; }
			table th { background: #f6f8fa; }
			table td, table th { border: 1px solid #d0d7de; }
			h1, h2 { border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
		`,
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.65;
    padding: 48px 56px;
    max-width: 860px;
    margin: 0 auto;
  }
  h1 { font-size: 2em;   margin: 1em 0 .5em; }
  h2 { font-size: 1.5em; margin: 1em 0 .5em; }
  h3 { font-size: 1.25em; margin: 1em 0 .4em; }
  h4, h5, h6 { margin: .8em 0 .3em; }
  p  { margin: .6em 0; }
  ul, ol { padding-left: 2em; margin: .6em 0; }
  li { margin: .2em 0; }
  pre  { padding: 16px; border-radius: 6px; overflow-x: auto; margin: 1em 0; white-space: pre-wrap; word-break: break-word; }
  code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: .9em; padding: .2em .4em; border-radius: 3px; }
  pre code { padding: 0; background: transparent; }
  blockquote { margin: 1em 0; padding: .5em 1em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  table td, table th { padding: 8px 12px; }
  table th { font-weight: 600; text-align: left; }
  img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
  hr { border: none; border-top: 2px solid #eee; margin: 1.5em 0; }
  ${themes[theme]}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

interface SlideInput {
	imageUrl?: string
	imageBase64?: string
	imageMimeType?: string
	title?: string
	body?: string
	backgroundColor?: string
	textColor?: string
}

function buildCarouselHtml(
	slides: SlideInput[],
	width: number,
	height: number,
	branding?: string,
): string {
	const fontScale = width / 1080  // scale fonts relative to 1080px reference

	const slideHtmls = slides.map((slide, index) => {
		const bg = slide.backgroundColor ?? '#ffffff'
		const textColor = slide.textColor ?? '#1a1a1a'

		let imageTag = ''
		if (slide.imageBase64) {
			const mime = slide.imageMimeType ?? 'image/png'
			imageTag = `<img class="bg-image" src="data:${mime};base64,${slide.imageBase64}" alt="Slide ${index + 1}">`
		} else if (slide.imageUrl) {
			imageTag = `<img class="bg-image" src="${htmlEscape(slide.imageUrl)}" alt="Slide ${index + 1}">`
		}

		const hasText = slide.title || slide.body
		const overlayStyle = imageTag && hasText
			? 'background: linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.72) 100%);'
			: ''

		const titleHtml = slide.title
			? `<h2 class="slide-title">${htmlEscape(slide.title)}</h2>`
			: ''
		const bodyHtml = slide.body
			? `<p class="slide-body">${htmlEscape(slide.body).replace(/\n/g, '<br>')}</p>`
			: ''
		const brandingHtml = branding
			? `<span class="branding">${htmlEscape(branding)}</span>`
			: ''
		const pageNumHtml = `<span class="page-num">${index + 1} / ${slides.length}</span>`

		const textBlockColor = imageTag ? '#ffffff' : textColor

		return `
<div class="slide" style="background-color: ${htmlEscape(bg)}; color: ${htmlEscape(textBlockColor)};">
  ${imageTag}
  ${imageTag && hasText ? `<div class="overlay" style="${overlayStyle}"></div>` : ''}
  <div class="content">
    ${titleHtml}
    ${bodyHtml}
  </div>
  <footer class="slide-footer">
    ${brandingHtml}
    ${pageNumHtml}
  </footer>
</div>`
	}).join('\n')

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page { size: ${width}px ${height}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; }
  .slide {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    page-break-after: always;
  }
  .slide:last-child { page-break-after: avoid; }
  .bg-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
  .content {
    position: relative;
    z-index: 2;
    padding: ${Math.round(48 * fontScale)}px ${Math.round(56 * fontScale)}px ${Math.round(16 * fontScale)}px;
  }
  .slide-title {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: ${Math.round(52 * fontScale)}px;
    font-weight: 800;
    line-height: 1.15;
    margin-bottom: ${Math.round(16 * fontScale)}px;
    text-shadow: 0 2px 8px rgba(0,0,0,0.3);
    word-break: break-word;
  }
  .slide-body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: ${Math.round(30 * fontScale)}px;
    line-height: 1.5;
    text-shadow: 0 1px 4px rgba(0,0,0,0.3);
    word-break: break-word;
  }
  .slide-footer {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: ${Math.round(14 * fontScale)}px ${Math.round(56 * fontScale)}px ${Math.round(28 * fontScale)}px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: ${Math.round(22 * fontScale)}px;
    opacity: 0.8;
  }
  .branding { font-weight: 600; }
  .page-num { margin-left: auto; }
</style>
</head>
<body>
${slideHtmls}
</body>
</html>`
}

// ── Tool factory ───────────────────────────────────────────────────────────────
export function createMediaTools(aiService: AIService, sessionId: string, workspacePath?: string) {
	return {
		generate_image: tool({
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

		markdown_to_pdf: tool({
			description:
				'Convert Markdown text into a styled PDF document. ' +
				'Supports headings, code blocks, tables, blockquotes, images, and links. ' +
				'Returns the PDF as a downloadable file.',
			inputSchema: z.object({
				markdown: z.string().describe('Markdown text to convert to PDF.'),
				filename: z
					.string()
					.optional()
					.default('document')
					.describe('Base filename for the PDF (no extension).'),
				format: z
					.enum(['a4', 'letter'])
					.optional()
					.default('a4')
					.describe('Page size: "a4" or "letter".'),
				theme: z
					.enum(['light', 'dark', 'github'])
					.optional()
					.default('github')
					.describe('Visual theme: "light", "dark", or "github" (default).'),
			}),
			execute: async ({ markdown, filename, format, theme }) => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const { chromium } = await loadPlaywright()
					const browser = await chromium.launch({ headless: true })
					const page = await browser.newPage()

					const bodyHtml = await marked(markdown)
					const fullHtml = buildMarkdownHtml(bodyHtml, theme)

					await page.setContent(fullHtml, { waitUntil: 'networkidle' })

					const pdfBuffer = await page.pdf({
						format: format === 'a4' ? 'A4' : 'Letter',
						printBackground: true,
						margin: { top: '0', right: '0', bottom: '0', left: '0' },
					})

					await browser.close()

					const fileName = `${filename}_${Date.now()}.pdf`
					session.emitter.emit('event', {
						type: 'file',
						name: fileName,
						buffer: Buffer.from(pdfBuffer),
						mimeType: 'application/pdf',
					} as DaemonEvent)

					return {
						success: true,
						message: `PDF generated successfully: ${fileName}`,
						fileName,
						format,
						theme,
					}
				} catch (err: any) {
					return { success: false, error: err.message || String(err) }
				}
			},
		}),

		carousel: tool({
			description:
				'Create a multi-page PDF carousel optimised for LinkedIn and social media. ' +
				'Each slide can have a background image (URL or base64 from AI image generation), ' +
				'a title, body text, and optional branding. ' +
				'Supported formats: linkedin-square (1080x1080), linkedin-portrait (1080x1350), ' +
				'instagram-square, instagram-portrait, instagram-story (1080x1920), twitter (1200x675). ' +
				'Returns the carousel as a downloadable PDF (upload natively to LinkedIn, Instagram, etc.).',
			inputSchema: z.object({
				slides: z
					.array(
						z.object({
							imageUrl: z
								.string()
								.optional()
								.describe('Publicly accessible URL of the slide background image.'),
							imageBase64: z
								.string()
								.optional()
								.describe(
									'Base64-encoded image data (from AI image generation). ' +
									'Do not include the "data:..." prefix — just the raw base64 string.',
								),
							imageMimeType: z
								.string()
								.optional()
								.default('image/png')
								.describe('MIME type of the base64 image, e.g. "image/png" or "image/jpeg".'),
							title: z
								.string()
								.optional()
								.describe('Bold headline text shown on the slide.'),
							body: z
								.string()
								.optional()
								.describe('Supporting body text. Use \\n for line breaks.'),
							backgroundColor: z
								.string()
								.optional()
								.default('#ffffff')
								.describe('Slide background color (hex) when no image is provided.'),
							textColor: z
								.string()
								.optional()
								.default('#1a1a1a')
								.describe('Text color (hex) when no image is provided.'),
						}),
					)
					.min(1)
					.max(20)
					.describe('Slides in order. Minimum 1, maximum 20.'),
				format: z
					.enum([
						'linkedin-square',
						'linkedin-portrait',
						'instagram-square',
						'instagram-portrait',
						'instagram-story',
						'twitter',
					])
					.optional()
					.default('linkedin-square')
					.describe('Social media format preset. Defaults to LinkedIn square (1080x1080).'),
				filename: z
					.string()
					.optional()
					.default('carousel')
					.describe('Base filename for the PDF (no extension).'),
				branding: z
					.string()
					.optional()
					.describe(
						'Branding handle or text shown subtly at the bottom-left of every slide, ' +
						'e.g. "@yourhandle" or "YourBrand.com".',
					),
			}),
			execute: async ({ slides, format, filename, branding }) => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const { chromium } = await loadPlaywright()
					const browser = await chromium.launch({ headless: true })
					const preset = SLIDE_PRESETS[format]
					const { width, height } = preset

					const page = await browser.newPage()
					await page.setViewportSize({ width, height })

					const fullHtml = buildCarouselHtml(slides, width, height, branding)
					await page.setContent(fullHtml, { waitUntil: 'networkidle' })

					const pdfBuffer = await page.pdf({
						width: `${width}px`,
						height: `${height}px`,
						printBackground: true,
						margin: { top: '0', right: '0', bottom: '0', left: '0' },
					})

					await browser.close()

					const fileName = `${filename}_${Date.now()}.pdf`
					session.emitter.emit('event', {
						type: 'file',
						name: fileName,
						buffer: Buffer.from(pdfBuffer),
						mimeType: 'application/pdf',
					} as DaemonEvent)

					return {
						success: true,
						message:
							`Carousel PDF created with ${slides.length} slides in ${preset.label} format: ${fileName}. ` +
							`Upload this PDF directly to LinkedIn (Document post), Instagram, or your chosen platform.`,
						fileName,
						slideCount: slides.length,
						format,
						dimensions: `${width}x${height}px`,
					}
				} catch (err: any) {
					return { success: false, error: err.message || String(err) }
				}
			},
		}),

		send_file: tool({
			description: 'Send a file back to the current communication channel (Discord, Telegram, etc.).',
			inputSchema: z.object({
				path: z.string().describe('Absolute path or project-relative path to the file'),
				name: z.string().optional().describe('Optional name for the file in the channel'),
			}),
			execute: async ({ path, name }) => {
				const session = aiService.getSession(sessionId)
				if (!session) return { success: false, error: 'Session not found' }

				try {
					const fullPath = path.startsWith('/') ? path : join(process.cwd(), path)
					if (!existsSync(fullPath)) {
						return { success: false, error: `File not found: ${fullPath}` }
					}

					const buffer = readFileSync(fullPath)
					const fileName = name || fullPath.split('/').pop() || 'file'

					// Detect mime type (basic)
					let mimeType = 'application/octet-stream'
					if (fileName.endsWith('.txt')) mimeType = 'text/plain'
					else if (fileName.endsWith('.md')) mimeType = 'text/markdown'
					else if (fileName.endsWith('.json')) mimeType = 'application/json'
					else if (fileName.endsWith('.png')) mimeType = 'image/png'
					else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg'
					else if (fileName.endsWith('.pdf')) mimeType = 'application/pdf'

					session.emitter.emit('event', {
						type: 'file',
						name: fileName,
						buffer,
						mimeType
					} as DaemonEvent)

					return { success: true, fileName }
				} catch (err) {
					return { success: false, error: String(err) }
				}
			},
		}),
	}
}
