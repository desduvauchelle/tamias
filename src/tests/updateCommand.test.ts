import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const introMock = mock(() => undefined)
const outroMock = mock(() => undefined)
const cancelMock = mock(() => undefined)
const stepMock = mock(() => undefined)
const noteMock = mock(() => undefined)
const confirmMock = mock(async () => true)
const isCancelMock = mock(() => false)

const checkSpinnerStartMock = mock(() => undefined)
const checkSpinnerStopMock = mock(() => undefined)
const checkSpinnerMessageMock = mock(() => undefined)

const updateSpinnerStartMock = mock(() => undefined)
const updateSpinnerStopMock = mock(() => undefined)
const updateSpinnerMessageMock = mock(() => undefined)

const restartSpinnerStartMock = mock(() => undefined)
const restartSpinnerStopMock = mock(() => undefined)
const restartSpinnerMessageMock = mock(() => undefined)

let spinnerCallCount = 0
const spinnerFactoryMock = mock(() => {
	spinnerCallCount += 1
	if (spinnerCallCount === 1) {
		return {
			start: checkSpinnerStartMock,
			stop: checkSpinnerStopMock,
			message: checkSpinnerMessageMock,
		}
	}
	if (spinnerCallCount === 2) {
		return {
			start: updateSpinnerStartMock,
			stop: updateSpinnerStopMock,
			message: updateSpinnerMessageMock,
		}
	}
	return {
		start: restartSpinnerStartMock,
		stop: restartSpinnerStopMock,
		message: restartSpinnerMessageMock,
	}
})

mock.module('@clack/prompts', () => ({
	intro: introMock,
	outro: outroMock,
	cancel: cancelMock,
	note: noteMock,
	confirm: confirmMock,
	isCancel: isCancelMock,
	log: { step: stepMock },
	spinner: spinnerFactoryMock,
}))

let checkForUpdateResult: { currentVersion: string; latestVersion: string; release: unknown } | null = {
	currentVersion: '1.0.0',
	latestVersion: '1.1.0',
	release: { tag_name: 'v1.1.0', assets: [] },
}

const checkForUpdateMock = mock(async () => checkForUpdateResult)
const performUpdateMock = mock(async () => ({ success: true, currentVersion: '1.0.0', latestVersion: '1.1.0' }))

mock.module('../utils/update.ts', () => ({
	checkForUpdate: checkForUpdateMock,
	performUpdate: performUpdateMock,
}))

const isDaemonRunningMock = mock(async () => false)
const readDaemonInfoMock = mock(() => null)
const autoStartDaemonMock = mock(async () => ({ pid: 12345, port: 9001 }))

mock.module('../utils/daemon.ts', () => ({
	isDaemonRunning: isDaemonRunningMock,
	readDaemonInfo: readDaemonInfoMock,
	autoStartDaemon: autoStartDaemonMock,
	writeDaemonInfo: mock(() => undefined),
	clearDaemonInfo: mock(() => undefined),
	findFreePort: mock(async () => 9001),
	getDaemonUrl: mock(() => 'http://127.0.0.1:9001'),
}))

import { runUpdateCommand } from '../commands/update.ts'

const originalExit = process.exit

beforeEach(() => {
	spinnerCallCount = 0
	checkForUpdateResult = {
		currentVersion: '1.0.0',
		latestVersion: '1.1.0',
		release: { tag_name: 'v1.1.0', assets: [] },
	}

	introMock.mockClear()
	outroMock.mockClear()
	cancelMock.mockClear()
	stepMock.mockClear()
	noteMock.mockClear()
	confirmMock.mockClear()
	isCancelMock.mockClear()
	checkSpinnerStartMock.mockClear()
	checkSpinnerStopMock.mockClear()
	checkSpinnerMessageMock.mockClear()
	updateSpinnerStartMock.mockClear()
	updateSpinnerStopMock.mockClear()
	updateSpinnerMessageMock.mockClear()
	restartSpinnerStartMock.mockClear()
	restartSpinnerStopMock.mockClear()
	restartSpinnerMessageMock.mockClear()
	spinnerFactoryMock.mockClear()
	checkForUpdateMock.mockClear()
	performUpdateMock.mockClear()
	isDaemonRunningMock.mockClear()
	readDaemonInfoMock.mockClear()
	autoStartDaemonMock.mockClear()

	process.exit = ((_code?: number) => undefined) as never
})

afterEach(() => {
	process.exit = originalExit
})

afterAll(() => mock.restore())

describe('runUpdateCommand', () => {
	test('restarts daemon automatically after successful update', async () => {
		await runUpdateCommand()

		expect(checkForUpdateMock).toHaveBeenCalledTimes(1)
		expect(performUpdateMock).toHaveBeenCalledTimes(1)
		expect(autoStartDaemonMock).toHaveBeenCalledTimes(1)
		expect(restartSpinnerStartMock).toHaveBeenCalledWith('Starting daemon…')
		expect(restartSpinnerStopMock).toHaveBeenCalledTimes(1)
		expect(outroMock).toHaveBeenCalledWith(expect.stringContaining('Tamias is now running on v1.1.0'))
	})

	test('exits with error when restart fails after a successful update', async () => {
		autoStartDaemonMock.mockImplementationOnce(async () => {
			throw new Error('boom')
		})
		const exitMock = mock((_code?: number) => undefined)
		process.exit = exitMock as never

		await runUpdateCommand()

		expect(performUpdateMock).toHaveBeenCalledTimes(1)
		expect(autoStartDaemonMock).toHaveBeenCalledTimes(1)
		expect(noteMock).toHaveBeenCalledWith(expect.stringContaining('tamias start'), expect.stringContaining('Manual restart required'))
		expect(exitMock).toHaveBeenCalledWith(1)
	})
})
