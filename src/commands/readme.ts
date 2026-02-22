import { Command } from 'commander'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import pc from 'picocolors'

export const runReadmeCommand = () => {
	const readmePath = join(process.cwd(), 'README.md')

	if (!existsSync(readmePath)) {
		console.error(pc.red('Error: README.md not found in the current directory.'))
		return
	}

	try {
		const content = readFileSync(readmePath, 'utf-8')

		marked.setOptions({
			// @ts-ignore
			renderer: new TerminalRenderer({
				codespan: pc.cyan,
				firstHeading: (s: string) => pc.bold(pc.magenta(s)),
				heading: (s: string) => pc.bold(pc.magenta(s)),
				hr: pc.dim,
				listitem: pc.white,
				table: pc.white,
				paragraph: pc.white,
				strong: pc.bold,
				em: pc.italic,
				del: pc.strikethrough,
				link: pc.blue,
				href: (s: string) => pc.dim(pc.blue(s))
			})
		})

		const output = marked.parse(content)
		console.log(output)
	} catch (err) {
		console.error(pc.red(`Error reading or rendering README: ${err}`))
	}
}
