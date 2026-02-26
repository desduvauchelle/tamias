/**
 * `tamias docs` — Generate and view documentation.
 */

import * as p from '@clack/prompts'
import pc from 'picocolors'
import { generateDocs } from '../utils/docs.ts'
import { join } from 'path'
import { TAMIAS_DIR } from '../utils/config.ts'

export const runDocsGenerateCommand = async (opts: { output?: string } = {}) => {
	p.intro(pc.bgBlue(pc.black(' Tamias — Documentation Generator ')))

	const outputDir = opts.output ?? join(TAMIAS_DIR, 'docs')
	const generated = generateDocs(outputDir)

	console.log(pc.green(`\n  Generated ${generated.length} documentation files:`))
	for (const file of generated) {
		console.log(pc.dim(`    → ${join(outputDir, file)}`))
	}

	p.outro(pc.green(`Documentation written to ${outputDir}`))
}
