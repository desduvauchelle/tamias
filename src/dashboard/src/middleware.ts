import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
	const authToken = process.env.TAMIAS_DASHBOARD_TOKEN

	// If no token is configured in the environment, we assume the dashboard is running
	// in an environment where auth isn't required (e.g. dev mode without daemon)
	// or we want to allow access for now. However, based on the plan, we SHOULD have it.
	if (!authToken) {
		return NextResponse.next()
	}

	const { searchParams } = new URL(request.url)
	const tokenParam = searchParams.get('token')

	// 1. Handle token in URL: set cookie and redirect to clean URL
	if (tokenParam) {
		const response = NextResponse.redirect(new URL(request.nextUrl.pathname, request.url))
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

	// 3. Special case: /api/status might need to be public for health checks,
	// but let's keep it secure for now as it reveals version info.
	// We'll exclude static assets and favicon
	const isStaticRes = request.nextUrl.pathname.startsWith('/_next') ||
		request.nextUrl.pathname.includes('.') ||
		request.nextUrl.pathname === '/favicon.ico'

	if (isStaticRes) {
		return NextResponse.next()
	}

	// 4. Deny access
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
