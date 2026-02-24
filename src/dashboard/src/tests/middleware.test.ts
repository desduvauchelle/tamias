import { describe, expect, test, beforeEach } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import { middleware } from '../middleware'

// Mocking NextRequest and NextResponse is a bit tricky in Bun without full Next.js environment,
// but we can pass mock objects that satisfy the interface.

describe('Dashboard Middleware', () => {
	const TOKEN = 'test-token-123'

	beforeEach(() => {
		process.env.TAMIAS_DASHBOARD_TOKEN = TOKEN
	})

	test('should block requests without token', async () => {
		const req = new NextRequest(new URL('http://localhost:3000/'))
		const res = await middleware(req)

		expect(res.status).toBe(401)
		const body = await res.json()
		expect(body.error).toContain('Unauthorized')
	})

	test('should allow requests with valid cookie', async () => {
		const req = new NextRequest(new URL('http://localhost:3000/'))
		req.cookies.set('tamias_token', TOKEN)

		const res = await middleware(req)
		// NextResponse.next() returns a response with null or internal 200 state usually
		expect(res.status).toBe(200)
	})

	test('should allow requests with valid Authorization header', async () => {
		const req = new NextRequest(new URL('http://localhost:3000/'), {
			headers: { 'Authorization': `Bearer ${TOKEN}` }
		})

		const res = await middleware(req)
		expect(res.status).toBe(200)
	})

	test('should handle token in URL and redirect to set cookie', async () => {
		const req = new NextRequest(new URL(`http://localhost:3000/configs?token=${TOKEN}`))

		const res = await middleware(req)

		expect(res.status).toBe(307) // Redirect
		expect(res.headers.get('location')).toBe('http://localhost:3000/configs')
		expect(res.cookies.get('tamias_token')?.value).toBe(TOKEN)
	})

	test('should allow static assets without auth', async () => {
		const req = new NextRequest(new URL('http://localhost:3000/_next/static/chunks/main.js'))
		const res = await middleware(req)
		expect(res.status).toBe(200)
	})

	test('should allow favicon without auth', async () => {
		const req = new NextRequest(new URL('http://localhost:3000/favicon.ico'))
		const res = await middleware(req)
		expect(res.status).toBe(200)
	})
})
