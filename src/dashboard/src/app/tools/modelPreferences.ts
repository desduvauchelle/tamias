export function reorderModelPreferences(models: string[], fromIndex: number, toIndex: number): string[] {
	if (
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= models.length ||
		toIndex >= models.length ||
		fromIndex === toIndex
	) {
		return [...models]
	}

	const next = [...models]
	const [moved] = next.splice(fromIndex, 1)
	next.splice(toIndex, 0, moved)
	return next
}

export function moveModelPreference(models: string[], index: number, direction: -1 | 1): string[] {
	return reorderModelPreferences(models, index, index + direction)
}
