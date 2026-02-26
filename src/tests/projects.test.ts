import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

describe('Projects System', () => {
	// These tests verify the project utilities at the module level.
	// The actual project CRUD uses the TAMIAS_DIR path, so we test
	// the pure functions and data structures.

	test('Project interface has required fields', async () => {
		const { listProjects, createProject, getProject } = await import('../utils/projects')
		// These functions exist and are callable
		expect(typeof listProjects).toBe('function')
		expect(typeof createProject).toBe('function')
		expect(typeof getProject).toBe('function')
	})

	test('buildProjectContext returns string when no projects', async () => {
		const { buildProjectContext } = await import('../utils/projects')
		// This just reads from the filesystem — if no projects exist, returns empty
		const context = buildProjectContext()
		// Will return empty since there are no projects
		expect(typeof context).toBe('string')
	})
})

describe('Tenants System', () => {
	test('getTenantDir returns base dir for default tenant', async () => {
		const { getTenantDir } = await import('../utils/tenants')
		const baseDir = getTenantDir()
		expect(baseDir).toContain('.tamias')
		expect(baseDir).not.toContain('tenants')
	})

	test('getTenantDir returns tenant-specific dir', async () => {
		const { getTenantDir } = await import('../utils/tenants')
		const dir = getTenantDir('my-tenant')
		expect(dir).toContain('tenants')
		expect(dir).toContain('my-tenant')
	})

	test('listTenants returns an array', async () => {
		const { listTenants } = await import('../utils/tenants')
		const tenants = listTenants()
		expect(Array.isArray(tenants)).toBe(true)
	})
})
