import * as p from '@clack/prompts'
import pc from 'picocolors'
import { generateInspectReport, writeInspectReport } from '../utils/inspectReport.ts'
import { TAMIAS_DIR } from '../utils/config.ts'

export async function runInspectCommand(opts: { print?: boolean }) {
	p.intro(pc.bgBlue(pc.white(' Tamias — Inspect Context ')))

	const spinner = p.spinner()
	spinner.start('Building inspection report…')

	let report: string
	try {
		report = await generateInspectReport()
		spinner.stop('Report generated.')
	} catch (err: unknown) {
		spinner.stop('Failed to generate report.')
		p.log.error(err instanceof Error ? err.message : String(err))
		process.exit(1)
	}

	if (opts.print) {
		console.log(report)
	} else {
		const filePath = writeInspectReport(report, TAMIAS_DIR)
		p.log.success(`Report written to: ${pc.cyan(filePath)}`)
	}

	p.outro('Done.')
}
