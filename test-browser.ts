import { createBrowserTools } from './src/tools/browser'
import { AIService } from './src/services/aiService'

async function test() {
	console.log('Testing Browser Tool...')
	const aiService = {} as AIService // Mock
	const browser = createBrowserTools(aiService, 'test-session')

	console.log('1. Testing browse to google.com...')
	const browseResult = await browser.browse.execute!({ url: 'https://www.google.com', wait: 2000 }, { toolCallId: '1', messages: [] }) as any
	console.log('Browse Success:', browseResult.success)
	if (browseResult.success) {
		console.log('Title found:', browseResult.snapshot.includes('Google'))
	}

	console.log('\n2. Testing screenshot...')
	const screenshotResult = await browser.screenshot.execute!({ fullPage: false }, { toolCallId: '2', messages: [] }) as any
	console.log('Screenshot Success:', screenshotResult.success)

	process.exit(0)
}

test().catch(err => {
	console.error(err)
	process.exit(1)
})
