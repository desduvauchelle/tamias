import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'fs'
import { createServer } from 'net'

const DAEMON_FILE = join(homedir(), '.tamias', 'daemon.json')

// Common ports to avoid when auto-picking
const COMMON_PORTS = new Set([
	3000, 3001, 3306, 3389, 4000, 4200, 4343, 4444, 5000, 5432, 5900,
	6379, 6443, 7000, 7777, 8000, 8080, 8443, 8888, 9000,
])

export interface DaemonInfo {
	pid: number
	port: number
	startedAt: string
	dashboardPort?: number
	dashboardPid?: number
}

/** Find a free TCP port above 9000, avoiding common ones */
export async function findFreePort(min = 9001): Promise<number> {
	for (let port = min; port < 65000; port++) {
		if (COMMON_PORTS.has(port)) continue
		const free = await isPortFree(port)
		if (free) return port
	}
	throw new Error('Could not find a free port')
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer()
		server.once('error', () => resolve(false))
		server.once('listening', () => {
			server.close(() => resolve(true))
		})
		server.listen(port, '127.0.0.1')
	})
}

export function readDaemonInfo(): DaemonInfo | null {
	if (!existsSync(DAEMON_FILE)) return null
	try {
		return JSON.parse(readFileSync(DAEMON_FILE, 'utf-8')) as DaemonInfo
	} catch {
		return null
	}
}

export function writeDaemonInfo(info: DaemonInfo): void {
	writeFileSync(DAEMON_FILE, JSON.stringify(info, null, 2), 'utf-8')
}

export function clearDaemonInfo(): void {
	if (existsSync(DAEMON_FILE)) unlinkSync(DAEMON_FILE)
}

/** Returns true if the daemon is running and reachable */
export async function isDaemonRunning(): Promise<boolean> {
	const info = readDaemonInfo()
	if (!info) return false
	try {
		const res = await fetch(`http://127.0.0.1:${info.port}/health`, {
			signal: AbortSignal.timeout(1000),
		})
		return res.ok
	} catch {
		return false
	}
}

export async function autoStartDaemon(): Promise<DaemonInfo> {
	// Detection of compiled state
	const isCompiled = import.meta.dir?.includes('$bunfs') || !existsSync(import.meta.dir || '')
	const projectRoot = isCompiled ? process.cwd() : join(import.meta.dir, '../..')
	const logPath = join(homedir(), '.tamias', 'daemon.log')

	const logFile = Bun.file(logPath)
	let spawnArgs: string[]
	if (isCompiled) {
		spawnArgs = [process.execPath, 'start', '--daemon']
	} else {
		spawnArgs = [process.argv[0], join(projectRoot, 'src', 'index.ts'), 'start', '--daemon']
	}

	const proc = Bun.spawn(
		spawnArgs,
		{
			cwd: projectRoot,
			detached: true,
			stdio: ['ignore', logFile, logFile],
		}
	)
	proc.unref()

	// Wait for it to write daemon.json and respond to /health (up to 15s)
	for (let i = 0; i < 150; i++) {
		await new Promise((r) => setTimeout(r, 100))
		const running = await isDaemonRunning()
		if (running) {
			return readDaemonInfo()!
		}
	}
	throw new Error(`Daemon did not start in time. Check logs at ${logPath}`)
}

export function getDaemonUrl(): string {
	const info = readDaemonInfo()
	if (!info) throw new Error('Daemon is not running. Start it with `tamias start`.')
	return `http://127.0.0.1:${info.port}`
}
