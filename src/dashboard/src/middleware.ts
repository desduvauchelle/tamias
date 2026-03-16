import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'

// Run in Node.js runtime so that fs/path/os builtins work.
// Edge Runtime stubs these out, causing existsSync to silently return false.
export const runtime = 'nodejs'

function isOnboarded(): boolean {
	try {
		// TAMIAS_DIR can be overridden in tests to avoid touching the real ~/.tamias
		const tamiasDir = process.env.TAMIAS_DIR || join(homedir(), '.tamias')
		const identityPath = join(tamiasDir, 'memory', 'IDENTITY.md')
		return existsSync(identityPath)
	} catch {
		return false
	}
}

export function middleware(request: NextRequest) {
	const pathname = request.nextUrl.pathname

	// Allow static assets, API routes, and the onboarding page through without auth
	const isStaticRes = pathname.startsWith('/_next') ||
		pathname.includes('.') ||
		pathname === '/favicon.ico'
	const isOnboardingPage = pathname.startsWith('/onboarding')
	const isApiRoute = pathname.startsWith('/api/')

	if (isStaticRes) {
		return NextResponse.next()
	}

	// During onboarding, skip auth for the onboarding page and API routes
	if (!isOnboarded()) {
		if (isOnboardingPage || isApiRoute) {
			return NextResponse.next()
		}
		// Redirect everything else to onboarding
		return NextResponse.redirect(new URL('/onboarding', request.url))
	}

	const authToken = process.env.TAMIAS_DASHBOARD_TOKEN

	// If no token is configured, allow access (dev mode)
	if (!authToken) {
		return NextResponse.next()
	}

	const { searchParams } = new URL(request.url)
	const tokenParam = searchParams.get('token')

	// 1. Handle token in URL: set cookie and redirect to clean URL
	if (tokenParam) {
		const response = NextResponse.redirect(new URL(pathname, request.url))
		response.cookies.set('tamias_token', tokenParam, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 7, // 1 week
		})
		return response
	}

	// 2. Check for token in cookie or Authorization header
	const cookieToken = request.cookies.get('tamias_token')?.value
	const authHeader = request.headers.get('Authorization')?.replace('Bearer ', '')

	if (cookieToken === authToken || authHeader === authToken) {
		return NextResponse.next()
	}

	// 3. Deny access
	return new NextResponse(
		JSON.stringify({ error: 'Unauthorized: Dashboard token required' }),
		{ status: 401, headers: { 'content-type': 'application/json' } }
	)
}

// See "Matching Paths" below to learn more
export const config = {
	matcher: [
		/*
		 * Match all request paths except for the ones starting with:
		 * - api (if we want to exclude some API routes)
		 * - _next/static (static files)
		 * - _next/image (image optimization files)
		 * - favicon.ico (favicon file)
		 */
		'/((?!_next/static|_next/image|favicon.ico).*)',
	],
}
