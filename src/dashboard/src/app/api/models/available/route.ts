import { NextResponse } from 'next/server'
import { getTamiasEnv } from '../../tamias'

export const dynamic = 'force-dynamic'

type ProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'ollama'

interface ProviderModel {
	id: string
	name: string
}

/**
 * POST /api/models/available
 * Fetches available models from a provider using the supplied or stored API key.
 * Body: { provider, apiKey?, nickname? }
 */
export async function POST(request: Request) {
	try {
		const { provider, apiKey, nickname } = await request.json() as {
			provider: ProviderType
			apiKey?: string
			nickname?: string
		}

		// Resolve API key: use provided key, or look up stored env key
		let resolvedKey = apiKey || ''
		if ((!resolvedKey || resolvedKey === '[REDACTED]') && nickname) {
			const env = await getTamiasEnv()
			const envKey = `TAMIAS_CONN_${nickname.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
			resolvedKey = env[envKey] || ''
		}

		const models = await fetchModelsForProvider(provider, resolvedKey)
		return NextResponse.json({ models })
	} catch (error) {
		console.error('[api/models/available]', error)
		return NextResponse.json({ models: [], error: 'Failed to fetch models' }, { status: 500 })
	}
}

async function fetchModelsForProvider(provider: ProviderType, apiKey: string): Promise<ProviderModel[]> {
	switch (provider) {
		case 'openai':
			return fetchOpenAIModels(apiKey)
		case 'anthropic':
			return getAnthropicModels()
		case 'google':
			return fetchGoogleModels(apiKey)
		case 'openrouter':
			return fetchOpenRouterModels(apiKey)
		case 'ollama':
			return fetchOllamaModels()
		default:
			return []
	}
}

async function fetchOpenAIModels(apiKey: string): Promise<ProviderModel[]> {
	if (!apiKey) return []
	const res = await fetch('https://api.openai.com/v1/models', {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	if (!res.ok) return []
	const data = await res.json() as { data: { id: string }[] }
	return data.data
		.map(m => m.id)
		.filter(id => /^(gpt-|o\d|chatgpt-)/.test(id))
		.sort((a, b) => {
			const score = (id: string) => {
				if (id.startsWith('o3')) return 100
				if (id.startsWith('o1')) return 90
				if (id.includes('gpt-4o')) return 80
				if (id.includes('gpt-4')) return 70
				if (id.includes('gpt-3.5')) return 60
				return 0
			}
			return score(b) - score(a) || b.localeCompare(a)
		})
		.map(id => ({ id, name: id }))
}

function getAnthropicModels(): ProviderModel[] {
	return [
		{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Latest)' },
		{ id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
		{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
		{ id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
		{ id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
	]
}

async function fetchGoogleModels(apiKey: string): Promise<ProviderModel[]> {
	if (!apiKey) return []
	const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
	if (!res.ok) return []
	const data = await res.json() as { models: { name: string; displayName: string; supportedGenerationMethods: string[] }[] }
	return data.models
		.filter(m => m.supportedGenerationMethods.includes('generateContent'))
		.map(m => ({ id: m.name.replace('models/', ''), name: m.displayName }))
		.sort((a, b) => {
			const score = (id: string) => {
				if (id.includes('2.5')) return 40
				if (id.includes('2.0')) return 30
				if (id.includes('1.5')) return 20
				return 0
			}
			return score(b.id) - score(a.id) || b.id.localeCompare(a.id)
		})
}

async function fetchOpenRouterModels(apiKey: string): Promise<ProviderModel[]> {
	if (!apiKey) return []
	const res = await fetch('https://openrouter.ai/api/v1/models', {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	if (!res.ok) return []
	const data = await res.json() as { data: { id: string; name: string }[] }
	return data.data
		.map(m => ({ id: m.id, name: m.name ?? m.id }))
		.sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchOllamaModels(baseUrl?: string): Promise<ProviderModel[]> {
	const base = (baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
	try {
		const res = await fetch(`${base}/api/tags`)
		if (!res.ok) return []
		const data = await res.json() as { models: { name: string }[] }
		return data.models.map(m => ({ id: m.name, name: m.name }))
	} catch {
		return []
	}
}
