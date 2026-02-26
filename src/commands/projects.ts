/**
 * CLI command: tamias project
 */
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { listProjects, createProject, getProject, updateProjectStatus, slugifyProject } from '../utils/projects.ts'
import { getActiveTenantId } from '../utils/tenants.ts'

export async function runProjectCommand() {
	await runProjectListCommand()
}

export async function runProjectListCommand() {
	p.intro(pc.bgBlue(pc.white(' Tamias — Projects ')))

	const tenantId = getActiveTenantId()
	const projects = listProjects(tenantId)

	if (projects.length === 0) {
		p.note('No projects found. Create one with `tamias project create`.', 'Projects')
		p.outro('')
		return
	}

	const lines = projects.map(proj => {
		const statusIcon = proj.status === 'active' ? pc.green('●') : proj.status === 'paused' ? pc.yellow('●') : pc.dim('○')
		const workspace = proj.workspacePath ? pc.dim(` → ${proj.workspacePath}`) : ''
		return `  ${statusIcon} ${pc.bold(proj.slug)} — ${proj.description}${workspace}`
	})

	p.note(lines.join('\n'), `${projects.length} project(s)`)
	p.outro('')
}

export async function runProjectCreateCommand(nameArg?: string) {
	p.intro(pc.bgGreen(pc.black(' Tamias — Create Project ')))

	const name = nameArg || await p.text({
		message: 'Project name:',
		placeholder: 'my-awesome-project',
		validate: (val?: string) => {
			if (!val?.trim()) return 'Name is required'
			if (val.length > 100) return 'Name too long'
		},
	}) as string

	if (p.isCancel(name)) { p.cancel('Cancelled.'); return }

	const description = await p.text({
		message: 'Short description:',
		placeholder: 'A brief description of what this project is about',
	}) as string

	if (p.isCancel(description)) { p.cancel('Cancelled.'); return }

	const techStack = await p.text({
		message: 'Tech stack (optional):',
		placeholder: 'TypeScript, React, Node.js',
	}) as string

	const workspacePath = await p.text({
		message: 'Linked workspace path (optional):',
		placeholder: '~/.tamias/workspace/my-project',
	}) as string

	try {
		const tenantId = getActiveTenantId()
		const project = createProject(name, description || 'No description', {
			techStack: techStack || undefined,
			workspacePath: workspacePath || undefined,
			tenantId,
		})
		p.outro(pc.green(`✅ Project "${project.slug}" created at ~/.tamias/projects/${project.slug}/`))
	} catch (err: any) {
		p.cancel(pc.red(err.message))
	}
}

export async function runProjectShowCommand(slugArg?: string) {
	const tenantId = getActiveTenantId()
	const projects = listProjects(tenantId)

	let slug = slugArg
	if (!slug) {
		if (projects.length === 0) {
			p.intro(pc.bgBlue(pc.white(' Tamias — Project ')))
			p.note('No projects found.', 'Projects')
			p.outro('')
			return
		}

		const selected = await p.select({
			message: 'Select a project:',
			options: projects.map(proj => ({
				value: proj.slug,
				label: `${proj.slug} — ${proj.description}`,
			})),
		}) as string

		if (p.isCancel(selected)) { p.cancel('Cancelled.'); return }
		slug = selected
	}

	const project = getProject(slug, tenantId)
	if (!project) {
		p.intro(pc.bgRed(pc.white(' Project Not Found ')))
		p.outro(pc.red(`No project with slug "${slug}"`))
		return
	}

	p.intro(pc.bgBlue(pc.white(` Project: ${project.name} `)))

	const lines = [
		`${pc.bold('Status:')} ${project.status}`,
		`${pc.bold('Description:')} ${project.description}`,
		project.techStack ? `${pc.bold('Tech Stack:')} ${project.techStack}` : '',
		project.workspacePath ? `${pc.bold('Workspace:')} ${project.workspacePath}` : '',
		`${pc.bold('Created:')} ${project.createdAt}`,
		`${pc.bold('Updated:')} ${project.updatedAt}`,
	].filter(Boolean)

	p.note(lines.join('\n'), 'Details')
	p.outro('')
}

export async function runProjectArchiveCommand(slugArg?: string) {
	const tenantId = getActiveTenantId()
	const projects = listProjects(tenantId).filter(p => p.status !== 'archived')

	let slug = slugArg
	if (!slug) {
		if (projects.length === 0) {
			p.intro(pc.bgBlue(pc.white(' Tamias — Archive Project ')))
			p.note('No active projects to archive.', 'Projects')
			p.outro('')
			return
		}

		const selected = await p.select({
			message: 'Select a project to archive:',
			options: projects.map(proj => ({
				value: proj.slug,
				label: `${proj.slug} — ${proj.description}`,
			})),
		}) as string

		if (p.isCancel(selected)) { p.cancel('Cancelled.'); return }
		slug = selected
	}

	const result = updateProjectStatus(slug, 'archived', tenantId)
	if (result) {
		p.outro(pc.green(`✅ Project "${slug}" archived.`))
	} else {
		p.outro(pc.red(`Project "${slug}" not found.`))
	}
}
