import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	// Standalone mode bundles everything needed to run the server without
	// node_modules on the target machine. The binary update process extracts
	// .next/standalone/ directly — no `bun install` or `bun run build` required.
	output: 'standalone',
}

export default nextConfig
