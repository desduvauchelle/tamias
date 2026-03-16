import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	// Standalone mode bundles everything needed to run the server without
	// node_modules on the target machine. The binary update process extracts
	// .next/standalone/ directly — no `bun install` or `bun run build` required.
	output: 'standalone',
	experimental: {
		// Allow middleware to use Node.js runtime so fs/path/os work correctly.
		// Without this, existsSync in middleware always fails silently (Edge Runtime
		// stubs out Node built-ins), causing the onboarding redirect to trigger on
		// every request even for already-onboarded users.
		// @ts-expect-error — nodeMiddleware is a valid experimental flag in Next.js 15.1+
		// but the @types/next package for this version doesn't declare it yet.
		nodeMiddleware: true,
	},
}

export default nextConfig
