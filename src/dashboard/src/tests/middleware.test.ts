import { describe, expect, test, beforeEach } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import { __resetAuthRateLimitForTests, __setAuthRateLimitNowForTests, middleware } from '../middleware'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Mocking NextRequest and NextResponse is a bit tricky in Bun without full Next.js environment,
// but we can pass mock objects that satisfy the interface.

describe('Dashboard Middleware', () => {
	const TOKEN = 'test-token-123'

	beforeEach(() => {
		process.env.TAMIAS_DASHBOARD_TOKEN = TOKEN
		const tamiasDir = mkdtempSync(join(tmpdir(), 'tamias-middleware-test-'))
		mkdirSync(join(tamiasDir, 'memory'), { recursive: true })
		writeFileSync(join(tamiasDir, 'memory', 'IDENTITY.md'), '# Test identity\n', 'utf-8')
		process.env.TAMIAS_DIR = tamiasDir
		__resetAuthRateLimitForTests()
		__setAuthRateLimitNowForTests(() => 1_000_000)
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

	test('should reject wrong token in URL', async () => {
		const req = new NextRequest(new URL('http://localhost:3000/configs?token=wrong-token'))
		const res = await middleware(req)
		expect(res.status).toBe(401)
		const body = await res.json()
		expect(body.error).toContain('Unauthorized')
	})

	test('should allow first five failed attempts without lockout', async () => {
		for (let i = 0; i < 5; i += 1) {
			const req = new NextRequest(new URL('http://localhost:3000/configs'))
			const res = await middleware(req)
			expect(res.status).toBe(401)
		}
	})

	test('should lock out on sixth failed attempt for one minute', async () => {
		for (let i = 0; i < 5; i += 1) {
			const req = new NextRequest(new URL('http://localhost:3000/configs'))
			await middleware(req)
		}

		const sixthReq = new NextRequest(new URL('http://localhost:3000/configs'))
		const sixthRes = await middleware(sixthReq)
		expect(sixthRes.status).toBe(429)
		expect(sixthRes.headers.get('retry-after')).toBe('60')
		const body = await sixthRes.json()
		expect(body.retryAfterSeconds).toBe(60)
	})

	test('should progressively increase lockout after ten lockouts', async () => {
		let now = 2_000_000
		__setAuthRateLimitNowForTests(() => now)

		for (let lockout = 1; lockout <= 11; lockout += 1) {
			for (let i = 0; i < 5; i += 1) {
				const req = new NextRequest(new URL('http://localhost:3000/configs'))
				await middleware(req)
			}

			const lockRes = await middleware(new NextRequest(new URL('http://localhost:3000/configs')))
			expect(lockRes.status).toBe(429)
			const retryAfter = Number(lockRes.headers.get('retry-after') ?? '0')
			if (lockout <= 10) {
				expect(retryAfter).toBe(60)
			} else {
				expect(retryAfter).toBe(120)
			}

			now += retryAfter * 1000 + 1
		}
	})

	test('should reset failed attempts when lockout period has expired', async () => {
		let now = 5_000_000
		__setAuthRateLimitNowForTests(() => now)

		for (let i = 0; i < 6; i += 1) {
			await middleware(new NextRequest(new URL('http://localhost:3000/configs')))
		}

		now += 60_001

		for (let i = 0; i < 5; i += 1) {
			const res = await middleware(new NextRequest(new URL('http://localhost:3000/configs')))
			expect(res.status).toBe(401)
		}
	})

	test('should reset failed attempts after successful authentication', async () => {
		for (let i = 0; i < 4; i += 1) {
			const req = new NextRequest(new URL('http://localhost:3000/configs'))
			const res = await middleware(req)
			expect(res.status).toBe(401)
		}

		const successReq = new NextRequest(new URL('http://localhost:3000/configs'), {
			headers: { Authorization: `Bearer ${TOKEN}` },
		})
		const successRes = await middleware(successReq)
		expect(successRes.status).toBe(200)

		for (let i = 0; i < 5; i += 1) {
			const req = new NextRequest(new URL('http://localhost:3000/configs'))
			const res = await middleware(req)
			expect(res.status).toBe(401)
		}

		const nextReq = new NextRequest(new URL('http://localhost:3000/configs'))
		const nextRes = await middleware(nextReq)
		expect(nextRes.status).toBe(429)
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
