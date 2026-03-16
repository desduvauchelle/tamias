export default function OnboardingLayout({
	children,
}: {
	children: React.ReactNode
}) {
	// Onboarding uses its own minimal layout — no sidebar, no nav
	return <>{children}</>
}
