declare module 'marked-terminal' {
	import { Renderer } from 'marked'
	export class TerminalRenderer extends Renderer {
		constructor(options?: any)
	}
}
