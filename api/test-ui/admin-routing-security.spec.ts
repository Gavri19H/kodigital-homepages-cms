import { test, expect } from '@playwright/test';

// Story T20 — admin-routing-security: assert the off-admin-host gate
// declared in api/src/index.ts. Any /admin* or /api/admin* request that
// arrives on a hostname other than ADMIN_HOST MUST be rejected with a
// flat 404 carrying Cache-Control: no-store and X-Robots-Tag:
// noindex, nofollow, and the 404 body MUST NOT echo the admin hostname
// (cms.kodigital.app) back to the public content domain.
//
// Local dev sets ADMIN_HOST=localhost (api/wrangler.toml [vars]). The
// Playwright baseURL is http://127.0.0.1:8787, so the TCP connection
// still lands on the local wrangler dev process; we override the Host
// header via extraHTTPHeaders so the Worker's hostname gate sees a
// foreign public content domain and triggers the off-admin-host
// branch in api/src/index.ts (lines 67-82).

const PUBLIC_CONTENT_HOST = 'public.example.test';

test.use({
  extraHTTPHeaders: {
    Host: PUBLIC_CONTENT_HOST,
  },
});

test('off-admin-host GET /admin returns 404 with no-store + noindex headers', async ({ request }) => {
  const response = await request.get('/admin');

  // Off-admin-host /admin is gated to 404 (api/src/index.ts D3 contract).
  expect(response.status(), 'off-admin-host /admin must 404').toBe(404);

  // Cache-Control: no-store -- intermediaries MUST NOT cache the 404
  // response on the public content domain.
  const cacheControl = (response.headers()['cache-control'] ?? '').toLowerCase();
  expect(cacheControl, 'Cache-Control must include no-store').toContain('no-store');

  // X-Robots-Tag: noindex, nofollow -- search engines MUST NOT index a
  // stray admin URL leaked to a public content domain.
  const xRobots = (response.headers()['x-robots-tag'] ?? '').toLowerCase();
  expect(xRobots, 'X-Robots-Tag must include noindex').toContain('noindex');
  expect(xRobots, 'X-Robots-Tag must include nofollow').toContain('nofollow');

  // The 404 body MUST NOT echo the admin hostname (cms.kodigital.app)
  // back to the public content domain. The gate in api/src/index.ts
  // returns {error:'Not Found'} without the request path or admin host.
  const body = await response.text();
  expect(
    body,
    'off-admin-host 404 body must NOT leak admin hostname cms.kodigital.app',
  ).not.toContain('cms.kodigital.app');
});

test('off-admin-host GET /api/admin/sites returns 404 (no admin API leak)', async ({ request }) => {
  const response = await request.get('/api/admin/sites');

  expect(response.status(), 'off-admin-host /api/admin/* must 404').toBe(404);

  const cacheControl = (response.headers()['cache-control'] ?? '').toLowerCase();
  expect(cacheControl, 'Cache-Control must include no-store').toContain('no-store');

  const xRobots = (response.headers()['x-robots-tag'] ?? '').toLowerCase();
  expect(xRobots, 'X-Robots-Tag must include noindex').toContain('noindex');
  expect(xRobots, 'X-Robots-Tag must include nofollow').toContain('nofollow');

  const body = await response.text();
  expect(
    body,
    'off-admin-host /api/admin 404 body must NOT leak admin hostname cms.kodigital.app',
  ).not.toContain('cms.kodigital.app');
});
