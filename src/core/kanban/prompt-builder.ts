import type { Task } from './tasks-db.ts'
import type { Comment } from './comments-db.ts'
import type { KanbanConfig } from './cli-adapter.ts'

interface PromptContext {
	task: Task
	projectName: string
	projectDirectory: string
	projectDescription?: string
	comments: Comment[]
	config: KanbanConfig
	phase: 'plan' | 'execute'
	planOutput?: string
}

export function buildKanbanPrompt(ctx: PromptContext): string {
	const { task, projectName, projectDirectory, projectDescription, comments, config, phase, planOutput } = ctx
	const parts: string[] = []

	parts.push(`You are working on the project at: ${projectDirectory}`)
	parts.push(`Project: ${projectName}`)
	if (projectDescription) parts.push(`Project description: ${projectDescription}`)
	parts.push('')
	parts.push('## Task')
	parts.push(task.title)
	parts.push('')

	if (task.description) {
		parts.push('## Description')
		parts.push(task.description)
		parts.push('')
	}

	if (task.details) {
		parts.push('## Details')
		parts.push(task.details)
		parts.push('')
	}

	const MAX_PROMPT_COMMENTS = 50
	const recentComments = comments.length > MAX_PROMPT_COMMENTS ? comments.slice(-MAX_PROMPT_COMMENTS) : comments
	if (recentComments.length > 0) {
		parts.push('## History & Feedback')
		if (comments.length > MAX_PROMPT_COMMENTS) parts.push(`(Showing last ${MAX_PROMPT_COMMENTS} of ${comments.length} comments)`)
		parts.push('The following is the conversation history for this task. User comments are feedback you should incorporate. System comments are outputs from previous attempts.')
		parts.push('')
		for (const comment of recentComments) {
			const label = comment.author === 'user' ? 'User feedback' : comment.author === 'ai' ? 'AI' : 'System'
			parts.push(`**${label}:** ${comment.content}`)
		}
		parts.push('')
	}

	if (config.customInstructions) {
		parts.push('## Additional Instructions')
		parts.push(config.customInstructions)
		parts.push('')
	}

	if (phase === 'plan') {
		parts.push('## Instructions')
		parts.push('- Analyze the task and create a detailed implementation plan')
		parts.push('- Identify the files that need to be created or modified')
		parts.push('- Consider edge cases and testing requirements')
		parts.push('- Follow existing code patterns and conventions in the project')
		parts.push('- Do NOT make any changes yet - only create the plan')
	} else {
		if (planOutput) {
			parts.push('## Plan from previous step')
			parts.push(planOutput)
			parts.push('')
		}
		parts.push('## Instructions')
		parts.push('- Execute the plan above')
		parts.push('- Implement the changes completely')
		parts.push('- Follow existing code patterns and conventions')
		parts.push('- Write tests if the project has a test framework')
		if (config.autoCommit) {
			parts.push('- Commit your changes with a clear message when done')
			parts.push('- Do NOT add Co-authored-by trailers or any AI attribution to commits.')
			if (config.autoPush) {
				parts.push('- Push your changes to the remote after committing')
				parts.push('- If the push fails, stop and report the exact error')
			}
		}
	}

	return parts.join('\n')
}
