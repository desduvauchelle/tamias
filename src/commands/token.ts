import pc from 'picocolors'
import { readDaemonInfo } from '../utils/daemon.ts'

export const runTokenCommand = async () => {
	const info = readDaemonInfo()
	if (info && info.token) {
		const url = info.dashboardPort
			? `http://localhost:${info.dashboardPort}/configs?token=${info.token}`
			: undefined
		console.log(pc.green('Dashboard Authentication Token:'))
		console.log(pc.bold(info.token))
		if (url) {
			console.log(pc.green('\nDashboard URL:'))
			console.log(pc.bold(url))
		}
		console.log('\nPaste this token in the dashboard if prompted.')
	} else {
		console.log(pc.red('No dashboard token found. Is the daemon running?'))
	}
}
