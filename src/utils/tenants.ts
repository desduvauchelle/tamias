/**
 * Multi-tenant support for Tamias.
 *
 * Default tenant uses ~/.tamias/ directly (backward compatible).
 * Named tenants use ~/.tamias/tenants/<tenant-id>/ with the same structure:
 *   config.json, memory/, agents/, projects/, data.sqlite, skills/
 */
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { TAMIAS_DIR } from './config.ts'

export interface TenantInfo {
	id: string
	name: string
	createdAt: string
	description?: string
}

const TENANTS_DIR = join(TAMIAS_DIR, 'tenants')
const TENANTS_INDEX = join(TAMIAS_DIR, 'tenants.json')

function ensureTenantsDir(): void {
	if (!existsSync(TENANTS_DIR)) mkdirSync(TENANTS_DIR, { recursive: true })
}

/** Get the data directory for a tenant. 'default' returns ~/.tamias */
export function getTenantDir(tenantId?: string): string {
	if (!tenantId || tenantId === 'default') return TAMIAS_DIR
	return join(TENANTS_DIR, tenantId)
}

/** Slugify a tenant name */
export function slugifyTenant(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Load the tenants index */
export function loadTenants(): TenantInfo[] {
	if (!existsSync(TENANTS_INDEX)) return []
	try {
		return JSON.parse(readFileSync(TENANTS_INDEX, 'utf-8'))
	} catch {
		return []
	}
}

/** Save the tenants index */
function saveTenants(tenants: TenantInfo[]): void {
	writeFileSync(TENANTS_INDEX, JSON.stringify(tenants, null, 2), 'utf-8')
}

/** List all tenants (includes the implicit 'default' tenant) */
export function listTenants(): TenantInfo[] {
	const tenants = loadTenants()
	return [
		{ id: 'default', name: 'Default', createdAt: '', description: 'Primary tenant (~/.tamias)' },
		...tenants,
	]
}

/** Create a new tenant with its own directory structure */
export function createTenant(name: string, description?: string): TenantInfo {
	ensureTenantsDir()
	const id = slugifyTenant(name)

	if (id === 'default') {
		throw new Error('Cannot create a tenant named "default" — it\'s reserved for the primary tenant')
	}

	const tenants = loadTenants()
	if (tenants.some(t => t.id === id)) {
		throw new Error(`Tenant "${id}" already exists`)
	}

	const tenantDir = getTenantDir(id)
	mkdirSync(tenantDir, { recursive: true })

	// Create subdirectories
	for (const sub of ['memory', 'memory/daily', 'agents', 'projects', 'skills', 'workspace', 'logs']) {
		mkdirSync(join(tenantDir, sub), { recursive: true })
	}

	// Create a minimal config.json
	const config = {
		version: '1.0',
		_configVersion: 2,
		connections: {},
		bridges: { terminal: { enabled: true } },
		workspacePath: join(tenantDir, 'workspace'),
		debug: false,
	}
	writeFileSync(join(tenantDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')

	// Create meta.json
	const meta = {
		_configVersion: 2,
		_layoutVersion: 3,
		tenantId: id,
		createdAt: new Date().toISOString(),
		lastMigratedAt: new Date().toISOString(),
		deferredMigrations: [],
	}
	writeFileSync(join(tenantDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

	const tenant: TenantInfo = {
		id,
		name,
		createdAt: new Date().toISOString(),
		description,
	}

	tenants.push(tenant)
	saveTenants(tenants)

	return tenant
}

/** Delete a tenant and all its data */
export function deleteTenant(id: string): void {
	if (id === 'default') {
		throw new Error('Cannot delete the default tenant')
	}

	const tenants = loadTenants()
	const index = tenants.findIndex(t => t.id === id)
	if (index === -1) {
		throw new Error(`Tenant "${id}" not found`)
	}

	const tenantDir = getTenantDir(id)
	if (existsSync(tenantDir)) {
		rmSync(tenantDir, { recursive: true, force: true })
	}

	tenants.splice(index, 1)
	saveTenants(tenants)
}

/** Get the currently active tenant ID from env or config */
export function getActiveTenantId(): string {
	return process.env.TAMIAS_TENANT || 'default'
}

/** Set the active tenant for the current process */
export function setActiveTenant(tenantId: string): void {
	process.env.TAMIAS_TENANT = tenantId
}
