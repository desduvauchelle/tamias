import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { join } from 'path'
import { existsSync, promises as fsPromises } from 'fs'
import { USER_SKILLS_DIR, getLoadedSkills, loadSkills } from '../utils/skills'
import matter from 'gray-matter'

export const skillsCommand = new Command('skills')
	.description('Manage custom AI skills and capabilities')

skillsCommand
	.command('list')
	.description('List all available skills (built-in and user-defined)')
	.action(async () => {
		await loadSkills()
		const skills = getLoadedSkills()

		if (skills.length === 0) {
			p.note('No skills found. Create one with `tamias skills add`.')
			return
		}

		console.log(pc.bold('\nAvailable Skills:\n'))

		skills.forEach(skill => {
			const type = skill.isBuiltIn ? pc.dim('(built-in)') : pc.green('(user)')
			console.log(`  ${pc.cyan(skill.name)} ${type}`)
			console.log(`  ${pc.dim(skill.description)}`)
			console.log(`  ${pc.dim('Folder:')} ${pc.yellow(skill.sourceDir)}`)
			console.log('')
		})
	})

skillsCommand
	.command('add')
	.description('Add or update a custom skill')
	.option('-n, --name <name>', 'Name of the skill')
	.option('-d, --description <desc>', 'Short description of what the skill does')
	.option('-c, --content <content>', 'The detailed markdown instructions for the skill')
	.action(async (opts) => {
		try {
			let name = opts.name
			let description = opts.description
			let content = opts.content

			if (!name) {
				name = await p.text({
					message: 'Enter a name for the skill:',
					placeholder: 'e.g. Python Optimizer',
					validate: (v) => !v ? 'Name is required' : undefined
				}) as string
				if (p.isCancel(name)) return
			}

			if (!description) {
				description = await p.text({
					message: 'Enter a short description:',
					placeholder: 'Expert in refactoring Python code for performance...',
					validate: (v) => !v ? 'Description is required' : undefined
				}) as string
				if (p.isCancel(description)) return
			}

			if (!content) {
				content = await p.text({
					message: 'Enter the skill instructions (Markdown):',
					placeholder: '# Instructions\n\nWhen optimizing Python...',
					validate: (v) => !v ? 'Content is required' : undefined
				}) as string
				if (p.isCancel(content)) return
			}

			// Sanitize directory name
			const safeDirName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")
			const skillDir = join(USER_SKILLS_DIR, safeDirName)

			if (!existsSync(skillDir)) {
				await fsPromises.mkdir(skillDir, { recursive: true })
			}

			const skillFile = join(skillDir, 'SKILL.md')

			// Use gray-matter to format correctly
			const finalContent = matter.stringify(content, {
				name,
				description
			})

			await fsPromises.writeFile(skillFile, finalContent, 'utf-8')
			await loadSkills()

			p.outro(pc.green(`✅ Skill '${name}' saved to ${skillDir}`))
		} catch (err) {
			p.log.error(`Failed to add skill: ${err}`)
		}
	})

skillsCommand
	.command('rm <folder>')
	.alias('delete')
	.description('Remove a custom skill by its folder name')
	.action(async (folder) => {
		try {
			const skillDir = join(USER_SKILLS_DIR, folder)

			if (!existsSync(skillDir)) {
				p.log.error(`Skill folder '${folder}' not found in ${USER_SKILLS_DIR}`)
				return
			}

			const confirmed = await p.confirm({
				message: `Are you sure you want to delete the skill in '${folder}'?`
			})
			if (p.isCancel(confirmed) || !confirmed) return

			await fsPromises.rm(skillDir, { recursive: true, force: true })
			await loadSkills()

			p.outro(pc.green(`✅ Skill folder '${folder}' removed.`))
		} catch (err) {
			p.log.error(`Failed to remove skill: ${err}`)
		}
	})
