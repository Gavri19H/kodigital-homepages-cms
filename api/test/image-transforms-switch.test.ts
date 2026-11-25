import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { SEED_HOSTNAME, SEED_SITE_ID } from "../scripts/seed/seed-fixture";
import { buildSeedSql } from "../scripts/seed/seed-sql";
import { tableBodies } from "../scripts/verify/worker-config";
import { configureImageTransforms, type Env } from "../src/env";
import worker, { PublicPage } from "../src/index";
import { cfTransform, responsiveImg } from "../src/public/templates/responsive-img";
import { buildLeadgenEnv, ctxCapture, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { parseHtml } from "./helpers/mini-dom";
import { createDb, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const logo = "/media/brand/logo.png";
const prefix = "/cdn-cgi/image/";
const id = (prefix: string) => prefix + "_" + "1".padStart(26, "0");
let sqlite: SqliteDb;
let db: D1Database;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
  sqlite = createDb();
  (sqlite.exec as (sql: string) => void)(buildSeedSql());
  const setting = sqlite.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  setting.run(SEED_SITE_ID, "logo_media_id", "brand/logo.png");
  setting.run(SEED_SITE_ID, "favicon_media_id", "brand/icon.png");

  sqlite.prepare(`INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status)
    VALUES (1, 'art_guide', ?, 'guide', 'A local guide', 'published')`).run(SEED_SITE_ID);
  sqlite.prepare(`INSERT INTO listicle_article_versions (id, public_id, article_id, headline, intro_paragraph, hero_media_url)
    VALUES (1, 'ver_guide', 1, 'Local offers', 'Offers from the guide.', '/media/guide.jpg')`).run();
  sqlite.prepare("INSERT INTO listicle_pages (id, public_id, article_version_id, page_index) VALUES (1, 'pg_guide', 1, 0)").run();
  sqlite.prepare(`INSERT INTO listicle_sections (id, public_id, section_name, headline_text, content_json)
    VALUES (1, 'sec_guide', 'Offers', 'Local offers', '{"blocks":[]}')`).run();
  sqlite.prepare("INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id) VALUES ('cand_guide', 1, 1)").run();

  sqlite.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (1, ?, 'Home', 'quote_funnel', '[]', 'active')`).run(id("lgq"));
  sqlite.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, 1, 1, 'home')").run(SEED_SITE_ID);
  sqlite.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status, frame_config_json)
    VALUES (1, ?, 1, 'Home', 'active', ?)`).run(id("lgf"), JSON.stringify({
    version: 1, template: "header-footer", header: { enabled: true, logo_size: "m" },
  }));
  sqlite.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp)
    VALUES (1, ?, 1, 'A', 10000)`).run(id("lgn"));
  sqlite.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (1, ?, 'Home', 'quote_funnel', 'home', 'Home insurance', '{"components":[]}')`).run(id("lgs"));
  sqlite.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 1, 0)").run();

  db = d1FromSqlite(sqlite);
  db.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(stmt => stmt.all<T>()));
});

afterEach(() => configureImageTransforms(undefined));
afterAll(() => {
  sqlite?.close();
  vi.useRealTimers();
});

const pages = [
  { name: "home", path: "/", variant: "human", logoSelector: ".brand-logo-img", transform: "width=400,quality=75,format=auto" },
  { name: "article", path: "/article/morning-light-rituals", variant: "human", logoSelector: ".brand-logo-img", transform: "width=400,quality=75,format=auto" },
  { name: "listicle", path: "/guide", variant: "lst:ver_guide", logoSelector: ".lst-logo img", transform: "width=466,fit=scale-down,quality=75,format=auto" },
  { name: "quote shell", path: "/lg/home", variant: "lg:" + id("lgn"), logoSelector: ".lg-logo-img", transform: "height=64,fit=scale-down,format=auto,quality=75" },
];

async function renderPage(path: string, variantKey: string, mode?: string) {
  const env = buildLeadgenEnv(db, makeKvStub().kv, { extra: { IMAGE_TRANSFORMS: mode } });
  const { ctx, promises } = ctxCapture();
  const page = new PublicPage({ ...ctx, props: { siteKey: SEED_SITE_ID, variantKey } }, env);
  const response = await page.fetch(new Request(`https://${SEED_HOSTNAME}${path}`));
  expect(response.status).toBe(200);
  const html = await response.text();
  await Promise.all(promises);
  return html;
}

it.each(pages)("$name uses original images when off and preserves its default HTML when on", async page => {
  const baseline = await renderPage(page.path, page.variant);
  const plain = await renderPage(page.path, page.variant, "off");
  expect(await renderPage(page.path, page.variant, "on")).toBe(baseline);
  expect(plain).not.toContain(prefix);

  const enabled = parseHtml(baseline);
  const disabled = parseHtml(plain);
  expect(enabled.querySelector(page.logoSelector)?.getAttribute("src")).toBe(prefix + page.transform + logo);
  expect(disabled.querySelector(page.logoSelector)?.getAttribute("src")).toBe(logo);
  const originalImages = enabled.querySelectorAll("img");
  const images = disabled.querySelectorAll("img");
  expect(images).toHaveLength(originalImages.length);
  for (const [index, image] of images.entries()) {
    const original = originalImages[index]!;
    const originalSrc = original.getAttribute("src")!;
    expect(image.getAttribute("src")).toBe(originalSrc.replace(/^\/cdn-cgi\/image\/[^/]+/, ""));
    for (const dimension of ["width", "height"]) {
      expect(image.getAttribute(dimension)).toMatch(/^[1-9]\d*$/);
      expect(image.getAttribute(dimension)).toBe(original.getAttribute(dimension));
    }
  }
});

it("reads the binding on successive gateway fallback requests and enables every value except off", async () => {
  const request = new Request(`https://${SEED_HOSTNAME}/article/morning-light-rituals`);
  for (const mode of ["off", undefined, "off", "", "OFF", " off ", "on"]) {
    const env = buildLeadgenEnv(db, makeKvStub().kv, { extra: { IMAGE_TRANSFORMS: mode } });
    Object.assign(env.CACHE, { getWithMetadata: async () => ({ value: null, metadata: null }) });
    const response = await worker.fetch(request.clone(), env);
    expect(response.status).toBe(200);
    const src = parseHtml(await response.text()).querySelector(".brand-logo-img")?.getAttribute("src");
    expect(src).toBe(mode === "off" ? logo : prefix + "width=400,quality=75,format=auto" + logo);
  }
});

it("emits just the original src and retains image attributes for a stored media key when off", () => {
  configureImageTransforms("off");
  expect(cfTransform("/media/logo.png?v=2", "width=80")).toBe("/media/logo.png?v=2");
  expect(responsiveImg({
    src: "brand/my logo.png?a=1&b=2", alt: "News", width: 200, height: 40,
    sizes: "200px", className: "brand", loading: "eager", fetchpriority: "high",
  })).toBe('<img class="brand" src="/media/brand/my%20logo.png?a=1&amp;b=2" alt="News" width="200" height="40" loading="eager" fetchpriority="high" decoding="async">');
});

it("disables transforms locally and enables them in each deployed environment", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  for (const [section, mode] of [
    ["[vars]", "off"], ["[env.staging.vars]", "on"], ["[env.production.vars]", "on"], ["[env.perfstage.vars]", "on"],
  ] as const) {
    const blocks = tableBodies(toml, section);
    expect(blocks, section).toHaveLength(1);
    expect(blocks[0]?.match(/^IMAGE_TRANSFORMS\s*=\s*"([^"]*)"/m)?.[1], section).toBe(mode);
  }
});
