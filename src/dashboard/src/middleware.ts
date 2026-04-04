import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'

// Run in Node.js runtime so that fs/path/os builtins work.
// Edge Runtime stubs these out, causing existsSync to silently return false.
export const runtime = 'nodejs'

type AuthAttemptState = {
	failedAttempts: number
	lockoutEvents: number
	lockedUntil: number
	lastSeenAt: number
}

const MAX_STATE_ENTRIES = 5_000
const STATE_TTL_MS = 24 * 60 * 60 * 1000
const LOCKOUT_CAP_SECONDS = 24 * 60 * 60
const authAttemptState = new Map<string, AuthAttemptState>()
let authRateLimitNow = () => Date.now()

function getClientIdentifier(request: NextRequest): string {
	const forwardedForRaw = request.headers.get('x-forwarded-for')
	const forwardedIp = forwardedForRaw?.split(',')[0]?.trim()
	const directIp = (request as NextRequest & { ip?: string }).ip
	const ip = forwardedIp || directIp || 'unknown-ip'
	const userAgent = request.headers.get('user-agent') || 'unknown-ua'
	return `${ip}|${userAgent.slice(0, 160)}`
}

function cleanupAuthAttemptState(nowMs: number): void {
	if (authAttemptState.size <= MAX_STATE_ENTRIES) {
		return
	}

	for (const [key, state] of authAttemptState.entries()) {
		if (nowMs - state.lastSeenAt > STATE_TTL_MS) {
			authAttemptState.delete(key)
		}
	}
}

function lockoutSecondsForEvent(lockoutEvents: number): number {
	if (lockoutEvents <= 10) {
		return 60
	}

	const exponent = lockoutEvents - 10
	const progressiveSeconds = 60 * (2 ** exponent)
	return Math.min(progressiveSeconds, LOCKOUT_CAP_SECONDS)
}

function getOrCreateState(clientId: string, nowMs: number): AuthAttemptState {
	const existing = authAttemptState.get(clientId)
	if (existing) {
		existing.lastSeenAt = nowMs
		return existing
	}

	const fresh: AuthAttemptState = {
		failedAttempts: 0,
		lockoutEvents: 0,
		lockedUntil: 0,
		lastSeenAt: nowMs,
	}
	authAttemptState.set(clientId, fresh)
	cleanupAuthAttemptState(nowMs)
	return fresh
}

function buildLockoutResponse(retryAfterSeconds: number): NextResponse {
	return new NextResponse(
		JSON.stringify({
			error: 'Too many authentication attempts. Try again later.',
			retryAfterSeconds,
		}),
		{
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': retryAfterSeconds.toString(),
			},
		}
	)
}

function recordFailedAttempt(clientId: string, nowMs: number): NextResponse {
	const state = getOrCreateState(clientId, nowMs)
	state.failedAttempts += 1

	if (state.failedAttempts <= 5) {
		return new NextResponse(
			JSON.stringify({ error: 'Unauthorized: Dashboard token required' }),
			{ status: 401, headers: { 'content-type': 'application/json' } }
		)
	}

	state.lockoutEvents += 1
	const lockSeconds = lockoutSecondsForEvent(state.lockoutEvents)
	state.lockedUntil = nowMs + lockSeconds * 1000

	return buildLockoutResponse(lockSeconds)
}

function isValidToken(request: NextRequest, expectedToken: string): boolean {
	const cookieToken = request.cookies.get('tamias_token')?.value
	const authHeader = request.headers.get('Authorization')?.replace('Bearer ', '')
	return cookieToken === expectedToken || authHeader === expectedToken
}

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
	const nowMs = authRateLimitNow()
	const clientId = getClientIdentifier(request)

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

	const state = getOrCreateState(clientId, nowMs)
	if (state.lockedUntil > nowMs) {
		const retryAfterSeconds = Math.ceil((state.lockedUntil - nowMs) / 1000)
		return buildLockoutResponse(retryAfterSeconds)
	}
	if (state.lockedUntil > 0 && state.lockedUntil <= nowMs) {
		state.lockedUntil = 0
		state.failedAttempts = 0
	}

	const { searchParams } = new URL(request.url)
	const tokenParam = searchParams.get('token')

	// 1. Handle token in URL: validate, set cookie, and redirect to clean URL
	if (tokenParam) {
		if (tokenParam !== authToken) {
			return recordFailedAttempt(clientId, nowMs)
		}

		authAttemptState.delete(clientId)
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
	if (isValidToken(request, authToken)) {
		authAttemptState.delete(clientId)
		return NextResponse.next()
	}

	// 3. Deny access
	return recordFailedAttempt(clientId, nowMs)
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

export function __resetAuthRateLimitForTests(): void {
	authAttemptState.clear()
}

export function __setAuthRateLimitNowForTests(nowProvider: (() => number) | null): void {
	authRateLimitNow = nowProvider ?? (() => Date.now())
}
