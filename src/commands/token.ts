import pc from 'picocolors'
import { readDaemonInfo } from '../utils/daemon.ts'
import { getOrCreateDashboardToken, readDashboardToken } from '../utils/token.ts'

export const runTokenCommand = async (opts: { reset?: boolean } = {}) => {
	if (opts.reset) {
		const newToken = await getOrCreateDashboardToken(true)
		const info = readDaemonInfo()
		const url = info?.dashboardPort
			? `http://localhost:${info.dashboardPort}/configs?token=${newToken}`
			: undefined
		console.log(pc.green('✅ Token reset! New dashboard token:'))
		console.log(pc.bold(newToken))
		if (url) {
			console.log(pc.green('\nDashboard URL:'))
			console.log(pc.bold(url))
		}
		console.log(pc.dim('\nToken saved to ~/.tamias/dashboard.token'))
		console.log(pc.dim('Run `tamias restart` for the new token to take effect.'))
		return
	}

	const token = readDashboardToken()
	const info = readDaemonInfo()
	const activeToken = token ?? info?.token

	if (activeToken) {
		const url = info?.dashboardPort
			? `http://localhost:${info.dashboardPort}/configs?token=${activeToken}`
			: undefined
		console.log(pc.green('Dashboard Authentication Token:'))
		console.log(pc.bold(activeToken))
		if (url) {
			console.log(pc.green('\nDashboard URL (with token):'))
			console.log(pc.bold(url))
		}
		console.log(pc.dim('\nRun `tamias token --reset` to generate a new token.'))
	} else {
		console.log(pc.red('No dashboard token found. Run `tamias start` first.'))
	}
}
