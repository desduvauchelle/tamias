
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = process.cwd()
const CHANGELOG_PATH = join(PROJECT_ROOT, 'CHANGELOG.md')
const README_PATH = join(PROJECT_ROOT, 'README.md')

function getTags(): string[] {
	try {
		return execSync('git tag -l --sort=-v:refname', { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean)
	} catch (e) {
		return []
	}
}

function getCommitsBetween(start: string | null, end: string): string[] {
	const range = start ? `${start}..${end}` : end
	try {
		return execSync(`git log ${range} --oneline`, { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean)
	} catch (e) {
		return []
	}
}

function formatCommits(commits: string[]): string {
	const categories: Record<string, string[]> = {
		'feat': [],
		'fix': [],
		'refactor': [],
		'chore': [],
		'docs': [],
		'other': []
	}

	commits.forEach(commit => {
		const match = commit.match(/^[a-f0-9]+ (feat|fix|refactor|chore|docs)(?:\(.*\))?: (.*)$/)
		if (match) {
			const [, type, message] = match
			categories[type].push(message)
		} else {
			// Try to find if the message contains the type anyway
			const hash = commit.split(' ')[0]
			const message = commit.substring(hash.length + 1)
			let categorized = false
			for (const type of Object.keys(categories)) {
				if (message.startsWith(`${type}:`)) {
					categories[type].push(message.substring(type.length + 1).trim())
					categorized = true
					break
				}
			}
			if (!categorized) {
				categories['other'].push(message)
			}
		}
	})

	let output = ''
	if (categories['feat'].length) output += `### Features\n${categories['feat'].map(m => `- ${m}`).join('\n')}\n\n`
	if (categories['fix'].length) output += `### Bug Fixes\n${categories['fix'].map(m => `- ${m}`).join('\n')}\n\n`
	if (categories['refactor'].length) output += `### Refactors\n${categories['refactor'].map(m => `- ${m}`).join('\n')}\n\n`
	if (categories['chore'].length) output += `### Maintenance\n${categories['chore'].map(m => `- ${m}`).join('\n')}\n\n`
	if (categories['docs'].length) output += `### Documentation\n${categories['docs'].map(m => `- ${m}`).join('\n')}\n\n`
	if (categories['other'].length) output += `### Other Changes\n${categories['other'].map(m => `- ${m}`).join('\n')}\n\n`

	return output.trim()
}

function generateChangelog() {
	const tags = getTags()
	let changelogContent = '# Changelog\n\n'

	// Current head (unreleased)
	const latestTag = tags[0]
	const unreleasedCommits = getCommitsBetween(latestTag, 'HEAD')
	if (unreleasedCommits.length > 0) {
		changelogContent += `## [Unreleased]\n\n${formatCommits(unreleasedCommits)}\n\n`
	}

	for (let i = 0; i < tags.length; i++) {
		const tag = tags[i]
		const nextTag = tags[i + 1] || null
		const commits = getCommitsBetween(nextTag, tag)

		// Get tag date
		const date = execSync(`git log -1 --format=%ai ${tag}`, { encoding: 'utf8' }).split(' ')[0]

		changelogContent += `## [${tag}] - ${date}\n\n${formatCommits(commits)}\n\n`
	}

	writeFileSync(CHANGELOG_PATH, changelogContent.trim() + '\n')
	console.log(`Updated ${CHANGELOG_PATH}`)

	// Update README.md
	if (existsSync(README_PATH)) {
		let readme = readFileSync(README_PATH, 'utf8')
		const changelogMarker = '## Changelog'
		const changelogSection = `\n\n${changelogMarker}\n\nSee the full [CHANGELOG.md](./CHANGELOG.md) for more details.\n\n### Latest Version (${tags[0]})\n\n${formatCommits(getCommitsBetween(tags[1] || null, tags[0]))}\n`

		if (readme.includes(changelogMarker)) {
			// Replace existing section
			const before = readme.split(changelogMarker)[0]
			// We assume it's at the end or we just append
			readme = before.trim() + changelogSection
		} else {
			readme = readme.trim() + changelogSection
		}
		writeFileSync(README_PATH, readme.trim() + '\n')
		console.log(`Updated ${README_PATH}`)
	}
}

generateChangelog()
