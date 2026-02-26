/**
 * CLI command: tamias tenant
 */
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { listTenants, createTenant, deleteTenant, setActiveTenant, getActiveTenantId, slugifyTenant } from '../utils/tenants.ts'

export async function runTenantCommand() {
	await runTenantListCommand()
}

export async function runTenantListCommand() {
	p.intro(pc.bgBlue(pc.white(' Tamias — Tenants ')))

	const tenants = listTenants()
	const activeId = getActiveTenantId()

	const lines = tenants.map(t => {
		const active = t.id === activeId ? pc.green(' ← active') : ''
		const desc = t.description ? pc.dim(` — ${t.description}`) : ''
		return `  ${pc.bold(t.id)}${desc}${active}`
	})

	p.note(lines.join('\n'), `${tenants.length} tenant(s)`)
	p.outro('')
}

export async function runTenantCreateCommand(nameArg?: string) {
	p.intro(pc.bgGreen(pc.black(' Tamias — Create Tenant ')))

	const name = nameArg || await p.text({
		message: 'Tenant name:',
		placeholder: 'my-client',
		validate: (val?: string) => {
			if (!val?.trim()) return 'Name is required'
			if (slugifyTenant(val) === 'default') return '"default" is reserved'
		},
	}) as string

	if (p.isCancel(name)) { p.cancel('Cancelled.'); return }

	const description = await p.text({
		message: 'Description (optional):',
		placeholder: 'Client X project environment',
	}) as string

	try {
		const tenant = createTenant(name, description || undefined)
		p.outro(pc.green(`✅ Tenant "${tenant.id}" created at ~/.tamias/tenants/${tenant.id}/`))
	} catch (err: any) {
		p.cancel(pc.red(err.message))
	}
}

export async function runTenantDeleteCommand(idArg?: string) {
	p.intro(pc.bgRed(pc.white(' Tamias — Delete Tenant ')))

	const tenants = listTenants().filter(t => t.id !== 'default')

	let id = idArg
	if (!id) {
		if (tenants.length === 0) {
			p.note('No custom tenants to delete.', 'Tenants')
			p.outro('')
			return
		}

		const selected = await p.select({
			message: 'Select tenant to delete:',
			options: tenants.map(t => ({
				value: t.id,
				label: `${t.id}${t.description ? ` — ${t.description}` : ''}`,
			})),
		}) as string

		if (p.isCancel(selected)) { p.cancel('Cancelled.'); return }
		id = selected
	}

	const confirmed = await p.confirm({
		message: `This will permanently delete tenant "${id}" and ALL its data. Are you sure?`,
		initialValue: false,
	})

	if (!confirmed || p.isCancel(confirmed)) { p.cancel('Cancelled.'); return }

	try {
		deleteTenant(id)
		p.outro(pc.green(`✅ Tenant "${id}" deleted.`))
	} catch (err: any) {
		p.cancel(pc.red(err.message))
	}
}

export async function runTenantSwitchCommand(idArg?: string) {
	const tenants = listTenants()

	let id = idArg
	if (!id) {
		const selected = await p.select({
			message: 'Select tenant to activate:',
			options: tenants.map(t => ({
				value: t.id,
				label: `${t.id}${t.description ? ` — ${t.description}` : ''}`,
			})),
		}) as string

		if (p.isCancel(selected)) { p.cancel('Cancelled.'); return }
		id = selected
	}

	if (!tenants.some(t => t.id === id)) {
		p.cancel(pc.red(`Tenant "${id}" not found`))
		return
	}

	setActiveTenant(id)
	p.outro(pc.green(`✅ Active tenant set to "${id}" for this session.`))
}
