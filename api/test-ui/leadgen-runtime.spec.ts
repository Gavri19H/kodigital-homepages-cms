// LeadGen Phase 7 Stage C — public `/lg/*` runtime e2e (§17.2 / §28 / §30.4),
// re-pointed at the fix-contract v2.4 03 §3.2 server-rendered shell (the old
// empty-shell `__LG_BOOTSTRAP__` assertions were the 11 §11.6 false-comfort
// set — deleted and replaced here).
//
// Seeds a real ACTIVE tenant + an activated funnel through the REAL admin APIs
// (reusing seedActiveSite from the listicles seed), then drives the PUBLIC
// runtime on a tenant host:
//   * the funnel shell mounts with DISTINCT funnel_id (lgf_) / funnel_variant_id
//     (lgn_) data attributes + the scoped chrome CSS, and carries the NEW 03
//     §3.2 contract: server-rendered [data-lg-section] blocks (first section's
//     question markup visible without JS), the inline #lg-config JSON, the
//     pre-hydration click-queue stub, and the deferred /lg/runtime/{v}.js
//     engine script (screenshot),
//   * hydration contract (03 §3.5): the SERVED bytes never pre-set
//     data-lg-ready; the ENGINE sets data-lg-ready="1" after init and exposes
//     window.__LG_ENGINE__; the mount is non-empty after ready (11 §11.6),
//   * §28 wire discipline: shell public,max-age=300,swr + ETag + nosniff + a 304
//     conditional GET; /lg/config public,max-age=300,s-maxage=1800,swr + ETag with
//     server-only fields ABSENT; /lg/attempt no-store + an att_ id; a foreign
//     variant → 404 (no config leak).
//
// The browser resolves the tenant host via --host-resolver-rules; Node-side wire
// assertions send an explicit Host header to 127.0.0.1:<PW_PORT> (default
// 8787; ./utils/base-url.ts). The local dev
// server auto-loads .dev.vars (LEADGEN_CONFIG_SIGNING_KEY present), so the
// minted token is a real signed one — asserted loosely (non-empty string).

import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { seedSharedFirstPage, createPassThroughSection } from "./leadgen-shared-page-seed";
import { PW_PORT } from "./utils/base-url";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
});

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-runtime";

interface SeededFunnel {
  host: string;
  siteId: string;
  slug: string;
  funnelId: string;
  variantId: string;
}

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function seedActivatedFunnel(request: APIRequestContext): Promise<SeededFunnel> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `lg-p7-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `LeadGen P7 ${uniq}`);

  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `P7 Quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const section = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `P7 section ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Are you covered?",
        status: "active",
        content_json: JSON.stringify({
          components: [
            { type: "TwoButtonYesNo", question_id: "q1", question_key: "covered", internal_field: "covered", answer_type: "boolean" },
          ],
        }),
      },
    }),
    "section create",
  );

  // Rework §4.3-1: the shared first page is mandatory for activation and resolver.ts
  // composes [...sharedPages, ...variantPages]. The P7 section IS page 1, so it moves
  // onto the shared page; the variant keeps a trailing pass-through page so the funnel
  // still satisfies "every active funnel needs at least one page with a section".
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: { sections: [{ section_id: await createPassThroughSection(request, "P7") }] },
    }),
    "variant sections",
  );
  await seedSharedFirstPage(request, quote.public_id, [section.id]);
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, {
      data: { enabled: true, slug: "p7" },
    }),
    "activation",
  );

  return { host, siteId, slug: "p7", funnelId, variantId };
}

let seeded: SeededFunnel;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedActivatedFunnel(ctx);
  await ctx.dispose();
});

function shellUrl(): string {
  return `http://${seeded.host}:${PW_PORT}/lg/${seeded.slug}`;
}

test.describe("public funnel shell on a tenant host (§17.2 / §28 / v2.4 03 §3.2)", () => {
  test("mounts with DISTINCT lgf_/lgn_ data attrs + chrome CSS + server-rendered sections + #lg-config + runtime script", async ({ page }) => {
    // The PRISTINE served bytes (Node-side — the live DOM mutates once the
    // engine hydrates): the 03 §3.2 shell contract.
    const ctx = await playwrightRequest.newContext();
    const served = await ctx.get(`${ORIGIN}/lg/${seeded.slug}`, {
      headers: { Host: `${seeded.host}:${PW_PORT}` },
    });
    expect(served.status()).toBe(200);
    const servedHtml = await served.text();
    // (b) the inline #lg-config carries the SAME LeadgenPublicConfig JSON.
    expect(servedHtml).toContain('<script type="application/json" id="lg-config">');
    // (c) the deferred hydration-engine bundle script (versioned route).
    expect(servedHtml).toMatch(/<script src="\/lg\/runtime\/[^"]+\.js" defer><\/script>/);
    // The minimal pre-hydration click-queue stub replaced LEADGEN_BOOTSTRAP_JS.
    expect(servedHtml).toContain("__LG_PREHYDRATE_QUEUE__");
    // (a) sections are SERVER-rendered: the first section's question markup is
    // in the served bytes (renders without JS) and only later sections are hidden.
    expect(servedHtml).toContain("data-lg-section");
    expect(servedHtml).toContain("data-lg-question");
    // The shell MUST NOT pre-set readiness — data-lg-ready="1" is the ENGINE's
    // post-hydration mark (03 §3.5.1 / 11 §11.6 anti-false-PASS). The inline
    // pre-hydration stub legitimately READS the attribute name in its JS, so
    // the assertion targets the attribute-SET form and the root element tag.
    expect(servedHtml).not.toContain('data-lg-ready="1"');
    const rootTag = servedHtml.match(/<div id="lg-funnel-root"[^>]*>/)?.[0] ?? "";
    expect(rootTag).not.toBe("");
    expect(rootTag).not.toContain("data-lg-ready");
    // The old bootstrap's config/attempt fetch strings are gone from the shell
    // (the config is baked inline; /lg/attempt is fetched by the engine bundle).
    expect(servedHtml).not.toContain("__LG_BOOTSTRAP__");
    await ctx.dispose();

    await page.goto(shellUrl(), { waitUntil: "domcontentloaded" });
    const root = page.locator("#lg-funnel-root");
    await expect(root).toHaveCount(1);
    const fid = await root.getAttribute("data-funnel-id");
    const vid = await root.getAttribute("data-funnel-variant-id");
    expect(fid).toBe(seeded.funnelId);
    expect(vid).toBe(seeded.variantId);
    expect(fid).not.toBe(vid);

    const html = await page.content();
    expect(html).toContain('data-funnel-design="default-funnel"');
    expect(html).toContain(".lg-content"); // funnelChromeCss inlined

    // #lg-config parses to the public config of THIS variant (03 §3.2b).
    const inlineConfig = await page.evaluate(() => {
      const el = document.getElementById("lg-config");
      if (el === null) return null;
      try {
        return JSON.parse(el.textContent ?? "") as { funnel_id?: string; funnel_variant_id?: string };
      } catch {
        return null;
      }
    });
    expect(inlineConfig?.funnel_id).toBe(seeded.funnelId);
    expect(inlineConfig?.funnel_variant_id).toBe(seeded.variantId);

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOT_DIR}/shell.png`, fullPage: true });
  });

  test("hydration contract: the ENGINE sets data-lg-ready=1 + exposes __LG_ENGINE__; mount is non-empty", async ({ page }) => {
    await page.goto(shellUrl(), { waitUntil: "load" });
    // 03 §3.5.1: data-lg-ready="1" appears ONLY after the engine hydrates.
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
    const engine = await page.evaluate(
      () =>
        (window as unknown as { __LG_ENGINE__?: { version?: string; getState?: unknown } })
          .__LG_ENGINE__,
    );
    expect(typeof engine?.version).toBe("string");
    expect(String(engine?.version ?? "")).not.toBe("");
    // 11 §11.6 anti-false-PASS: an empty mount after ready is a FAIL.
    const mountChildren = await page
      .locator("[data-lg-mount]")
      .evaluate((el) => el.children.length);
    expect(mountChildren).toBeGreaterThan(0);
  });
});

test.describe("§28 / §30.4 wire discipline (Host header)", () => {
  test("shell headers + 304; /lg/config strip + headers; /lg/attempt no-store; foreign variant 404", async () => {
    const ctx = await playwrightRequest.newContext();
    const H = { Host: `${seeded.host}:${PW_PORT}` };

    // shell
    const shell = await ctx.get(`${ORIGIN}/lg/${seeded.slug}`, { headers: H });
    expect(shell.status()).toBe(200);
    expect(shell.headers()["cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(shell.headers()["x-content-type-options"]).toBe("nosniff");
    const etag = shell.headers()["etag"] ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const cond = await ctx.get(`${ORIGIN}/lg/${seeded.slug}`, { headers: { ...H, "If-None-Match": etag } });
    expect(cond.status()).toBe(304);
    expect(await cond.text()).toBe("");

    // /lg/config
    const config = await ctx.get(`${ORIGIN}/lg/config/${seeded.variantId}`, { headers: H });
    expect(config.status()).toBe(200);
    expect(config.headers()["cache-control"]).toBe(
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    );
    expect(config.headers()["etag"] ?? "").toMatch(/^"[0-9a-f]{16}"$/);
    const cfgRaw = await config.text();
    const cfg = JSON.parse(cfgRaw) as { funnel_id: string; funnel_variant_id: string };
    expect(cfg.funnel_id).toBe(seeded.funnelId);
    expect(cfg.funnel_variant_id).toBe(seeded.variantId);
    expect(cfg.funnel_id).not.toBe(cfg.funnel_variant_id);
    for (const forbidden of [
      "signed_config_token",
      "funnel_attempt_id",
      "endpoint_production",
      "api_token_secret_ref",
      "bid_source",
      "carrier_parse_json",
      "schema_json",
    ]) {
      expect(cfgRaw, `server-only field leaked: ${forbidden}`).not.toContain(forbidden);
    }

    // /lg/attempt
    const attempt = await ctx.get(`${ORIGIN}/lg/attempt?funnel_variant_id=${seeded.variantId}`, { headers: H });
    expect(attempt.status()).toBe(200);
    expect(attempt.headers()["cache-control"]).toBe("no-store");
    const at = (await attempt.json()) as { funnel_attempt_id: string; signed_config_token: string };
    expect(at.funnel_attempt_id.startsWith("att_")).toBe(true);
    expect(typeof at.signed_config_token).toBe("string");
    expect(at.signed_config_token.length).toBeGreaterThan(0);

    // anti-leak: a real-shaped but never-activated variant → 404.
    const foreign = await ctx.get(`${ORIGIN}/lg/config/lgn_00000000000000000000000000`, { headers: H });
    expect(foreign.status()).toBe(404);
    await ctx.dispose();
  });
});
