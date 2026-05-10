#!/usr/bin/env tsx
/**
 * smoke:cms-domain
 *
 * Live-network smoke test for the Phase 1.5 hostname routing contract
 * (docs/cms-domain-setup.md Step 4). Hits a target environment
 * (default: production) over HTTPS and asserts the four behaviors the
 * Worker promises:
 *
 *   GET /health        -> 200 JSON { ok: true }
 *   GET /              -> 302 with Location ending in /admin
 *   GET /unknown-path  -> 404
 *   GET /admin         -> 302 to *.cloudflareaccess.com  (unauthenticated)
 *                         OR 200 (authenticated via service token)
 *
 * Usage:
 *   cd api
 *   npm run smoke:cms-domain                 # hits cms.kodigital.app
 *   SMOKE_HOST=staging-cms.kodigital.app \
 *     npm run smoke:cms-domain               # staging
 *
 * For the /admin authenticated path, set:
 *   CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET
 * (service-token credentials issued via docs/cloudflare-access-service-token-setup.md).
 *
 * Exits 0 only when every check passes. NOT in CI: this script reaches
 * the live edge and depends on operator-set secrets.
 */

const SMOKE_HOST = (process.env.SMOKE_HOST ?? "cms.kodigital.app").trim();
const CLIENT_ID = (process.env.CF_ACCESS_CLIENT_ID ?? "").trim();
const CLIENT_SECRET = (process.env.CF_ACCESS_CLIENT_SECRET ?? "").trim();

if (SMOKE_HOST === "") {
  console.error("smoke:cms-domain FAILED — SMOKE_HOST is empty");
  process.exit(1);
}

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

async function fetchNoRedirect(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { redirect: "manual", headers });
}

async function checkHealth(): Promise<Result> {
  const url = `https://${SMOKE_HOST}/health`;
  try {
    const res = await fetch(url);
    if (res.status !== 200) return { name: "health", ok: false, detail: `${url} -> ${res.status}` };
    const body = (await res.json()) as { ok?: boolean };
    if (body.ok !== true) return { name: "health", ok: false, detail: `${url} -> body.ok != true` };
    return { name: "health", ok: true, detail: `${url} -> 200 ok=true` };
  } catch (err) {
    return { name: "health", ok: false, detail: `${url} -> ${(err as Error).message}` };
  }
}

async function checkRootRedirect(): Promise<Result> {
  const url = `https://${SMOKE_HOST}/`;
  try {
    const res = await fetchNoRedirect(url);
    if (res.status !== 302) return { name: "root-redirect", ok: false, detail: `${url} -> ${res.status} (expected 302)` };
    const loc = res.headers.get("location") ?? "";
    if (!loc.endsWith("/admin")) {
      return { name: "root-redirect", ok: false, detail: `${url} -> Location="${loc}" (expected ".../admin")` };
    }
    return { name: "root-redirect", ok: true, detail: `${url} -> 302 ${loc}` };
  } catch (err) {
    return { name: "root-redirect", ok: false, detail: `${url} -> ${(err as Error).message}` };
  }
}

async function checkUnknownPath(): Promise<Result> {
  const url = `https://${SMOKE_HOST}/unknown-path-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const res = await fetchNoRedirect(url);
    if (res.status !== 404) return { name: "unknown-path", ok: false, detail: `${url} -> ${res.status} (expected 404)` };
    return { name: "unknown-path", ok: true, detail: `${url} -> 404` };
  } catch (err) {
    return { name: "unknown-path", ok: false, detail: `${url} -> ${(err as Error).message}` };
  }
}

async function checkAdminGate(): Promise<Result> {
  const url = `https://${SMOKE_HOST}/admin`;
  const headers: Record<string, string> = {};
  if (CLIENT_ID && CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = CLIENT_ID;
    headers["CF-Access-Client-Secret"] = CLIENT_SECRET;
  }
  try {
    const res = await fetchNoRedirect(url, headers);
    if (CLIENT_ID && CLIENT_SECRET) {
      if (res.status !== 200) return { name: "admin-authed", ok: false, detail: `${url} (with service token) -> ${res.status} (expected 200)` };
      return { name: "admin-authed", ok: true, detail: `${url} -> 200` };
    }
    if (res.status !== 302) return { name: "admin-unauthed", ok: false, detail: `${url} -> ${res.status} (expected 302 to cloudflareaccess.com)` };
    const loc = res.headers.get("location") ?? "";
    if (!loc.includes("cloudflareaccess.com")) {
      return { name: "admin-unauthed", ok: false, detail: `${url} -> Location="${loc}" (expected cloudflareaccess.com)` };
    }
    return { name: "admin-unauthed", ok: true, detail: `${url} -> 302 ${loc}` };
  } catch (err) {
    return { name: "admin-gate", ok: false, detail: `${url} -> ${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  const results = await Promise.all([
    checkHealth(),
    checkRootRedirect(),
    checkUnknownPath(),
    checkAdminGate(),
  ]);

  const failed = results.filter((r) => !r.ok);

  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.name} :: ${r.detail}`);
  }

  if (failed.length > 0) {
    console.error(`smoke:cms-domain FAILED — ${failed.length}/${results.length} checks failed against host "${SMOKE_HOST}"`);
    process.exit(1);
  }

  console.log(`smoke:cms-domain OK -- all ${results.length} checks passed against host "${SMOKE_HOST}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`smoke:cms-domain FAILED — ${(err as Error).message}`);
  process.exit(1);
});

export {};
