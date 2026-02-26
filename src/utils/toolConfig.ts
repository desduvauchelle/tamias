/**
 * Tool provider preference system for Tamias.
 *
 * Allows tools to declare which AI providers/models work best for them,
 * and provides a way to suggest model overrides when certain tools are invoked.
 *
 * For example: image generation works best with "openai/dall-e-3", while
 * code generation might prefer "anthropic/claude-sonnet-4-20250514".
 */

export interface ToolProviderPreference {
	/** Tool group name (e.g., "image", "browser") */
	toolName: string
	/** Preferred model for this tool (e.g., "openai/dall-e-3") */
	preferredModel?: string
	/** Provider that works best with this tool */
	preferredProvider?: string
	/** Human description of why this preference exists */
	reason?: string
}

/**
 * Built-in tool provider preferences.
 * These can be overridden via config.json's `toolPreferences` field.
 */
export const DEFAULT_TOOL_PREFERENCES: ToolProviderPreference[] = [
	{
		toolName: 'image',
		preferredProvider: 'openai',
		reason: 'DALL-E 3 via OpenAI is the primary supported image generation backend',
	},
	{
		toolName: 'gemini',
		preferredProvider: 'google',
		reason: 'Gemini tools use the Google API directly',
	},
]

/**
 * Resolve the preferred model for a tool based on preferences.
 * Returns undefined if no preference is set.
 */
export function getToolPreferredModel(toolName: string, preferences?: ToolProviderPreference[]): string | undefined {
	const prefs = preferences ?? DEFAULT_TOOL_PREFERENCES
	const pref = prefs.find(p => p.toolName === toolName)
	return pref?.preferredModel
}

/**
 * Resolve the preferred provider for a tool.
 */
export function getToolPreferredProvider(toolName: string, preferences?: ToolProviderPreference[]): string | undefined {
	const prefs = preferences ?? DEFAULT_TOOL_PREFERENCES
	const pref = prefs.find(p => p.toolName === toolName)
	return pref?.preferredProvider
}

/**
 * Generate a markdown guide for all registered tools.
 * Used by the documentation system and appended to TOOLS.md guidance.
 */
export function generateToolGuide(tools: Array<{ name: string; description: string; functions: string[] }>): string {
	const lines = ['# Tool Reference Guide\n']

	for (const tool of tools) {
		lines.push(`## ${tool.name}`)
		lines.push(`${tool.description}\n`)
		if (tool.functions.length > 0) {
			lines.push('Functions:')
			for (const fn of tool.functions) {
				lines.push(`- \`${tool.name}__${fn}\``)
			}
			lines.push('')
		}
	}

	return lines.join('\n')
}
