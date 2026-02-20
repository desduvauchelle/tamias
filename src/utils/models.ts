import pc from 'picocolors'
import type { ProviderType } from './config'

export interface ProviderModel {
	id: string
	name: string
}

/**
 * Fetch available models from the provider's API.
 * Returns an empty array if the provider doesn't support listing or the request fails.
 */
export const fetchModels = async (provider: ProviderType, apiKey: string): Promise<ProviderModel[]> => {
	try {
		switch (provider) {
			case 'openai':
				return await fetchOpenAIModels(apiKey)
			case 'anthropic':
				return getAnthropicModels()
			case 'google':
				return await fetchGoogleModels(apiKey)
			case 'openrouter':
				return await fetchOpenRouterModels(apiKey)
			case 'antigravity':
				return []
		}
	} catch {
		return []
	}
}

const fetchOpenAIModels = async (apiKey: string): Promise<ProviderModel[]> => {
	const res = await fetch('https://api.openai.com/v1/models', {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
	const data = await res.json() as { data: { id: string }[] }

	// Filter for chat-capable models (gpt-* and o*)
	const chatModels = data.data
		.map((m) => m.id)
		.filter((id) => /^(gpt-|o\d)/.test(id))
		.sort((a, b) => {
			// Heuristic: o1/o3 > gpt-4o > gpt-4 > gpt-3.5
			const getScore = (id: string) => {
				if (id.startsWith('o3')) return 100
				if (id.startsWith('o1')) return 90
				if (id.includes('gpt-4o')) return 80
				if (id.includes('gpt-4')) return 70
				if (id.includes('gpt-3.5')) return 60
				return 0
			}
			const scoreA = getScore(a)
			const scoreB = getScore(b)
			if (scoreA !== scoreB) return scoreB - scoreA
			return b.localeCompare(a) // Latest versions usually have higher numeric suffixes
		})

	return chatModels.map((id) => ({ id, name: id }))
}

// Anthropic doesn't have a public list endpoint, so we return a curated static list
const getAnthropicModels = (): ProviderModel[] => [
	{ id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Latest)' },
	{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
	{ id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
	{ id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
]

const fetchGoogleModels = async (apiKey: string): Promise<ProviderModel[]> => {
	const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
	if (!res.ok) throw new Error(`Google API error: ${res.status}`)
	const data = await res.json() as { models: { name: string; displayName: string; supportedGenerationMethods: string[] }[] }

	return data.models
		.filter((m) => m.supportedGenerationMethods.includes('generateContent'))
		.map((m) => ({
			id: m.name.replace('models/', ''),
			name: m.displayName,
		}))
		.sort((a, b) => {
			// Heuristic: gemini-2.0 > gemini-1.5 > gemini-1.0
			const getScore = (id: string) => {
				if (id.includes('2.0')) return 30
				if (id.includes('1.5')) return 20
				if (id.includes('1.0')) return 10
				return 0
			}
			const scoreA = getScore(a.id)
			const scoreB = getScore(b.id)
			if (scoreA !== scoreB) return scoreB - scoreA
			return b.id.localeCompare(a.id)
		})
}

const fetchOpenRouterModels = async (apiKey: string): Promise<ProviderModel[]> => {
	const res = await fetch('https://openrouter.ai/api/v1/models', {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`)
	const data = await res.json() as { data: { id: string; name: string }[] }

	return data.data
		.map((m) => ({ id: m.id, name: m.name ?? m.id }))
		.sort((a, b) => a.id.localeCompare(b.id))
}
