import { test, expect } from '@playwright/test';

// Story T13 — admin-routing-security: assert the off-admin-host gate
// declared in api/src/index.ts (Phase 1.5 D3 + Phase 3 T28 hardening).
// Any /admin* or /api/admin* request that arrives on a hostname other
// than ADMIN_HOST MUST be rejected with a flat 404 carrying:
//   Cache-Control: no-store
//   X-Robots-Tag:  noindex, nofollow
// and the 404 body MUST NOT echo the admin hostname (cms.kodigital.app)
// back to the public content domain.
//
// Local dev sets ADMIN_HOST=localhost (api/wrangler.toml [vars]). The
// Playwright baseURL is http://127.0.0.1:<PW_PORT> (default 8787;
// playwright.config.ts) so the TCP connection still lands on the local
// wrangler dev process; we override the Host
// header via extraHTTPHeaders so the Worker's hostname gate sees a
// foreign public content domain and triggers the off-admin-host
// branch in api/src/index.ts (lines 67-82).
//
// T13.AC2 names `demo-acme.example` as the off-admin-host literal — we
// use it verbatim in the primary assertion so the AC and the spec line
// up word-for-word. Secondary cases cover /api/admin/* and a crafted
// path embedding the admin hostname (body MUST NOT echo it back).

const OFF_ADMIN_HOST = 'demo-acme.example';
const ADMIN_HOST_LITERAL = 'cms.kodigital.app';

test.use({
  extraHTTPHeaders: {
    Host: OFF_ADMIN_HOST,
  },
});

test('off-admin-host GET /admin returns 404 with no-store + noindex, nofollow headers (T13.AC2)', async ({ request }) => {
  const response = await request.get('/admin');

  // Off-admin-host /admin is gated to 404 (api/src/index.ts D3 contract).
  expect(response.status(), 'off-admin-host /admin must 404').toBe(404);

  // Cache-Control: no-store (exact) -- intermediaries MUST NOT cache the
  // 404 response on the public content domain.
  const cacheControl = response.headers()['cache-control'] ?? '';
  expect(cacheControl, 'Cache-Control must equal "no-store"').toBe('no-store');

  // X-Robots-Tag: noindex, nofollow (exact) -- search engines MUST NOT
  // index a stray admin URL leaked to a public content domain.
  const xRobots = response.headers()['x-robots-tag'] ?? '';
  expect(xRobots, 'X-Robots-Tag must equal "noindex, nofollow"').toBe('noindex, nofollow');

  // The 404 body MUST NOT echo the admin hostname (cms.kodigital.app)
  // back to the public content domain. The gate in api/src/index.ts
  // returns {error:'Not Found'} without the request path or admin host.
  const body = await response.text();
  expect(
    body,
    `off-admin-host 404 body must NOT leak admin hostname ${ADMIN_HOST_LITERAL}`,
  ).not.toContain(ADMIN_HOST_LITERAL);
});

test('off-admin-host GET /api/admin/sites returns 404 (no admin API leak)', async ({ request }) => {
  const response = await request.get('/api/admin/sites');

  expect(response.status(), 'off-admin-host /api/admin/* must 404').toBe(404);

  const cacheControl = response.headers()['cache-control'] ?? '';
  expect(cacheControl, 'Cache-Control must equal "no-store"').toBe('no-store');

  const xRobots = response.headers()['x-robots-tag'] ?? '';
  expect(xRobots, 'X-Robots-Tag must equal "noindex, nofollow"').toBe('noindex, nofollow');

  const body = await response.text();
  expect(
    body,
    `off-admin-host /api/admin 404 body must NOT leak admin hostname ${ADMIN_HOST_LITERAL}`,
  ).not.toContain(ADMIN_HOST_LITERAL);
});

test('off-admin-host GET /admin/<crafted-admin-host-in-path> does not echo cms.kodigital.app in 404 body', async ({ request }) => {
  // Crafted path includes the admin hostname literal in the URL. The 404
  // body MUST still NOT contain it (the gate omits c.req.path on purpose).
  const response = await request.get(`/admin/${ADMIN_HOST_LITERAL}`);

  expect(response.status(), 'crafted /admin/<admin-host> off-admin-host must 404').toBe(404);

  const cacheControl = response.headers()['cache-control'] ?? '';
  expect(cacheControl, 'Cache-Control must equal "no-store"').toBe('no-store');

  const xRobots = response.headers()['x-robots-tag'] ?? '';
  expect(xRobots, 'X-Robots-Tag must equal "noindex, nofollow"').toBe('noindex, nofollow');

  const body = await response.text();
  expect(
    body,
    `crafted /admin/${ADMIN_HOST_LITERAL} 404 body must NOT echo the admin hostname`,
  ).not.toContain(ADMIN_HOST_LITERAL);
});
