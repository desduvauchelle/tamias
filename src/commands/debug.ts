import * as p from '@clack/prompts'
import pc from 'picocolors'
import { getDebugMode, setDebugMode } from '../utils/config.ts'

export const runDebugCommand = async () => {
	const current = getDebugMode()
	const next = !current
	setDebugMode(next)

	if (next) {
		p.intro(pc.bgGreen(pc.black(' Debug Mode: ENABLED ')))
		p.note('More information will now be appended to AI messages and tool results will be shown in chat.', 'Info')
	} else {
		p.intro(pc.bgRed(pc.black(' Debug Mode: DISABLED ')))
	}
}
