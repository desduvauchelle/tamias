import { tool } from 'ai'
import { z } from 'zod'
import { join } from 'path'
import { marked } from 'marked'
import type { AIService } from '../services/aiService.ts'
import { TAMIAS_DIR } from '../utils/config.ts'
import type { DaemonEvent } from '../bridge/types.ts'

export const PDF_TOOL_NAME = 'pdf'
export const PDF_TOOL_LABEL = '📄 PDF (markdown → PDF, social media carousels)'

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
export function createPdfTools(aiService: AIService, sessionId: string) {
	return {
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
				'Supported formats: linkedin-square (1080×1080), linkedin-portrait (1080×1350), ' +
				'instagram-square, instagram-portrait, instagram-story (1080×1920), twitter (1200×675). ' +
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
					.describe('Social media format preset. Defaults to LinkedIn square (1080×1080).'),
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
						dimensions: `${width}×${height}px`,
					}
				} catch (err: any) {
					return { success: false, error: err.message || String(err) }
				}
			},
		}),
	}
}
