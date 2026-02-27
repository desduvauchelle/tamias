import { expect, test, describe } from "bun:test"
import { loadArchivedUsageRows } from "./usageHistory"

describe("UsageHistory (deprecated)", () => {
	test("loadArchivedUsageRows returns empty array (deprecated)", () => {
		expect(loadArchivedUsageRows()).toEqual([])
	})
})
