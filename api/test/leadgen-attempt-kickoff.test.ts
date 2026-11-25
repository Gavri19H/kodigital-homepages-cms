import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterAll, assert, beforeAll, expect, it, vi } from "vitest";
import { LEADGEN_TEMPLATE_VERSION } from "../src/cache/cache-keys";
import { mintPublicId } from "../src/leadgen/ids";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import { parseHtml } from "./helpers/mini-dom";
import { addSite, call, createDb, env, type SqliteDb } from "./helpers/x06-a2-sqlite";

const origin = "https://kickoff.example";
const variantId = mintPublicId("funnel_variant");
const visitors = [
  { href: origin + "/lg/home?utm_source=first-visitor&ad=a%26b+c&ad=2#first-step", sid: "first-session" },
  { href: origin + "/lg/home?utm_source=second-visitor&ad=%C3%A9#next-step", sid: "second-session" },
] as const;
let db: SqliteDb;
let html: string;
let kickoff: string;

async function liveShell(href: string, sid: string): Promise<string> {
  const res = await leadgenRouter.request(href, {
    headers: { "x-cms-variant": "lg:" + variantId, Cookie: "ko_sid=" + sid },
  }, { ...env(db), EDGE_INNER: "1" });
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toContain("public");
  return res.text();
}

beforeAll(async () => {
  db = createDb();
  addSite(db, "kickoff", "Home Quotes", "health");
  db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES ('kickoff', ?, 'active')").run(new URL(origin).hostname);
  db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (1, ?, 'Home', 'quote_funnel', '[]', 'active')`).run(mintPublicId("quote"));
  db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('kickoff', 1, 1, 'home')").run();
  db.prepare("INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status) VALUES (1, ?, 1, 'Home', 'active')")
    .run(mintPublicId("funnel"));
  db.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp)
    VALUES (1, ?, 1, 'A', 10000)`).run(variantId);
  db.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (1, ?, 'Home', 'quote_funnel', 'health', 'Do you own your home?', '{"components":[]}')`).run(mintPublicId("section"));
  db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 1, 0)").run();
  html = await liveShell(visitors[0].href, visitors[0].sid);
  kickoff = parseHtml(html).querySelector("head script")!.textContent;
});

afterAll(() => db.close());

function startAttempt(href: string, fetch: typeof globalThis.fetch) {
  const window: { __LG_ATTEMPT_P__?: { vid: string; p: Promise<unknown> } } = {};
  runInNewContext(kickoff, { window, location: { href }, fetch });
  assert.isDefined(window.__LG_ATTEMPT_P__);
  return window.__LG_ATTEMPT_P__;
}

it("starts the attempt immediately after charset and preloads the exact deferred runtime", () => {
  const doc = parseHtml(html);
  const runtime = doc.querySelector("script[src][defer]")!;
  const src = runtime.getAttribute("src");
  expect(src).toBe(`/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js`);
  expect(runtime.hasAttribute("type")).toBe(false);
  const script = `<script>${kickoff}</script>`;
  expect(Buffer.byteLength(script)).toBeLessThanOrEqual(400);
  expect(kickoff).toContain("window.__LG_ATTEMPT_P__");
  expect(html).toContain(`<head><meta charset="utf-8">${script}<link rel="preload" as="script" href="${src}">`);
  expect(html.indexOf(`<script src="${src}"`)).toBeGreaterThan(html.indexOf("</head>"));
});

it("serves identical shell bytes for visitors with different landing URLs and cookies", async () => {
  expect(await liveShell(visitors[1].href, visitors[1].sid)).toBe(html);
  expect(html).not.toMatch(/first-visitor|second-visitor|first-session|second-session/);
});

it("sends fetchAttemptOnce's exact GET with the current location and exposes the parsed JSON", async () => {
  const engine = readFileSync(new URL("../src/public/leadgen/runtime/engine.ts", import.meta.url), "utf8");
  const fallback = /async function fetchAttemptOnce\b[\s\S]*?\n}/.exec(engine)?.[0] ?? "";
  expect(engine).toContain('const LG_ATTEMPT_URL = "/lg/attempt"');
  expect(fallback).toContain('const url = `${LG_ATTEMPT_URL}?vid=${encodeURIComponent(funnelVariantId)}&u=${encodeURIComponent(location.href)}`;');
  const options = /fetch\(url,\s*(\{[\s\S]*?\})\s*\)/.exec(fallback)?.[1];
  assert.isDefined(options);
  const engineOptions = runInNewContext(`(${options})`);
  expect(engineOptions).toEqual({
    method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store",
  });

  for (const { href } of visitors) {
    const payload = { funnel_attempt_id: "att_example", page_plan: [{ section_public_id: "lgs_example" }] };
    const fetch = vi.fn(async () => Response.json(payload));
    const handle = startAttempt(href, fetch);
    expect(handle.vid).toBe(variantId);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/lg/attempt?vid=" + encodeURIComponent(variantId) + "&u=" + encodeURIComponent(href), engineOptions,
    );
    await expect(handle.p).resolves.toEqual(payload);
  }
});

it.each([
  ["a non-OK response", async () => Response.json({ error: "unavailable" }, { status: 503 })],
  ["invalid JSON", async () => new Response("{")],
  ["a rejected fetch", async () => { throw new TypeError("offline"); }],
  ["a synchronous fetch error", () => { throw new TypeError("fetch failed"); }],
] as const)("resolves to null on %s", async (_reason, fetch) => {
  await expect(startAttempt(visitors[0].href, fetch).p).resolves.toBeNull();
});

it("omits both head additions when the quote slug has no active variant", async () => {
  const res = await leadgenRouter.request(origin + "/lg/missing", {}, { ...env(db), EDGE_INNER: "1" });
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).not.toContain("__LG_ATTEMPT_P__");
  expect(body).not.toContain('rel="preload" as="script"');
});

it("omits the kickoff from the Studio preview that runs the engine", async () => {
  const { status, json } = await call(db, "POST", "/api/admin/leadgen/sections/preview", {
    content: { components: [] }, runtime: true,
  });
  expect(status).toBe(200);
  const preview = parseHtml((json.preview as { events_html: string }).events_html);
  expect(preview.querySelector('[data-lg-preview="1"]')).not.toBeNull();
  expect(preview.querySelector("script[data-lg-runtime-version]")).not.toBeNull();
  for (const script of preview.querySelectorAll("script")) {
    if (!script.hasAttribute("data-lg-runtime-version")) expect(script.textContent).not.toContain("__LG_ATTEMPT_P__");
  }
});
