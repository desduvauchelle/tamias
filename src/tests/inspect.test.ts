import { describe, it, expect } from 'bun:test'
import { generateInspectReport } from '../utils/inspectReport.ts'

describe('generateInspectReport', () => {
  it('returns a string with all 4 section headers (no session)', async () => {
    const report = await generateInspectReport()
    expect(report).toContain('## 1. Session Metadata')
    expect(report).toContain('## 2. Configuration Snapshot')
    expect(report).toContain('## 3. System Prompt')
    expect(report).toContain('## 4. Available Tools')
  })

  it('includes "terminal" in channel metadata when no session provided', async () => {
    const report = await generateInspectReport()
    expect(report).toContain('terminal (synthetic — CLI mode)')
  })

  it('includes at least one internal tool namespace', async () => {
    const report = await generateInspectReport()
    expect(report).toMatch(/### internal:/)
  })

  it('does not crash when a tool has no description', async () => {
    await expect(generateInspectReport()).resolves.toBeDefined()
  })

  it('config snapshot lists bridge status', async () => {
    const report = await generateInspectReport()
    expect(report).toContain('### Bridges')
  })
})

import { writeInspectReport } from '../utils/inspectReport.ts'
import { existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'

describe('writeInspectReport', () => {
  it('writes a file and returns the path', () => {
    const content = '# test report'
    const dir = tmpdir()
    const filePath = writeInspectReport(content, dir)
    expect(filePath).toMatch(/inspect-.*\.md$/)
    expect(existsSync(filePath)).toBe(true)
    unlinkSync(filePath)
  })
})
