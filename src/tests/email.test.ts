import { expect, test, describe, mock, beforeEach } from "bun:test"
import { join } from "path"

const SRC_ROOT = join(import.meta.dir, "..")
const DEPENDENCIES_PATH = join(SRC_ROOT, "utils", "dependencies.ts")
const CONFIG_PATH = join(SRC_ROOT, "utils", "config.ts")

// Mock dependencies MUST be defined before importing the code under test
const mockHasDependency = mock((name: string) => true)
const mockGetEmailConfig = mock((account?: string) => ({}))
const mockGetEmailPassword = mock((account?: string) => "secret")
const mockExecSync = mock((cmd: string, options?: any) => Buffer.from(""))

mock.module(DEPENDENCIES_PATH, () => ({
	hasDependency: mockHasDependency
}))

mock.module(CONFIG_PATH, () => ({
	getEmailConfig: mockGetEmailConfig,
	getEmailPassword: mockGetEmailPassword,
	getAllEmailConfigs: mock(() => ({}))
}))

mock.module("child_process", () => ({
	execSync: mockExecSync,
	exec: (cmd: string, cb: any) => cb(null, { stdout: "{}" }),
	promisify: (fn: any) => fn
}))

// Import the tool AFTER mocks are defined
import { emailTools } from "../tools/email"

describe("Email Tool", () => {
	beforeEach(() => {
		mockHasDependency.mockClear()
		mockGetEmailConfig.mockClear()
		mockGetEmailPassword.mockClear()
		mockExecSync.mockClear()

		// Reset to default passing state
		mockHasDependency.mockImplementation(() => true)
		mockGetEmailConfig.mockImplementation(() => ({
			nickname: "Personal",
			accountName: "personal",
			enabled: true,
			permissions: {
				whitelist: [],
				canSend: true
			}
		} as any))
	})

	test("send_email should fail if himalaya is missing", async () => {
		mockHasDependency.mockImplementation(() => false)
		const result = await (emailTools.send_email as any).execute({
			to: "test@example.com",
			subject: "hi",
			body: "hello"
		}, {} as any)
		expect(result.success).toBe(false)
		expect(result.error).toContain("not installed")
	})

	test("send_email should fail if account not found", async () => {
		mockGetEmailConfig.mockImplementation(() => undefined as any)

		// Case 1: No account provided
		const result1 = await (emailTools.send_email as any).execute({
			to: "test@example.com",
			subject: "hi",
			body: "hello"
		}, {} as any)
		expect(result1.success).toBe(false)
		expect(result1.error).toContain("No email accounts configured")

		// Case 2: Specific account provided but not found
		const result2 = await (emailTools.send_email as any).execute({
			account: "NonExistent",
			to: "test@example.com",
			subject: "hi",
			body: "hello"
		}, {} as any)
		expect(result2.success).toBe(false)
		expect(result2.error).toContain("'NonExistent' not found")
	})

	test("send_email should fail if account is disabled", async () => {
		mockGetEmailConfig.mockImplementation(() => ({
			nickname: "Personal",
			enabled: false
		}) as any)
		const result = await (emailTools.send_email as any).execute({
			to: "test@example.com",
			subject: "hi",
			body: "hello"
		}, {} as any)
		expect(result.success).toBe(false)
		expect(result.error).toContain("disabled")
	})

	test("send_email should fail if canSend is false and recipient not in whitelist", async () => {
		mockGetEmailConfig.mockImplementation(() => ({
			nickname: "Personal",
			enabled: true,
			permissions: {
				whitelist: ["friend@example.com"],
				canSend: false
			}
		}) as any)

		// Blocked
		const result1 = await (emailTools.send_email as any).execute({
			to: "stranger@example.com",
			subject: "hi",
			body: "hello"
		}, {} as any)
		expect(result1.success).toBe(false)
		expect(result1.error).toContain("authorized whitelist")

		// Allowed
		const result2 = await (emailTools.send_email as any).execute({
			to: "friend@example.com",
			subject: "hi",
			body: "hello"
		}, {} as any)
		expect(result2.success).toBe(true)
	})

	test("send_email should succeed even if not in whitelist if canSend is true", async () => {
		mockGetEmailConfig.mockImplementation(() => ({
			nickname: "Personal",
			enabled: true,
			permissions: {
				whitelist: ["friend@example.com"],
				canSend: true
			}
		}) as any)
		const result = await (emailTools.send_email as any).execute({
			to: "anybody@example.com",
			subject: "hi",
			body: "hello"
		}, {} as any)
		expect(result.success).toBe(true)
	})

	test("send_email should call himalaya CLI if all checks pass", async () => {
		mockGetEmailConfig.mockImplementation(() => ({
			nickname: "Personal",
			accountName: "denis-growth",
			enabled: true,
			permissions: {
				whitelist: [],
				canSend: true
			}
		}) as any)
		const result = await (emailTools.send_email as any).execute({
			to: "friend@example.com",
			subject: "hello",
			body: "how are you?"
		}, {} as any)

		expect(result.success).toBe(true)
		expect(mockExecSync).toHaveBeenCalled()
		const callArgs = mockExecSync.mock.calls[0]
		expect(expect.stringContaining("himalaya --account denis-growth template send")).toEqual(callArgs[0])
		expect(callArgs[1].input).toContain("To: friend@example.com")
		expect(callArgs[1].input).toContain("Subject: hello")
	})
})
