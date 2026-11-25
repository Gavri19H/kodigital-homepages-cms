import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import media from "../src/media";
import { publicCss } from "../src/public/assets/public-css";
import { loadPreparedFunnelBundle } from "../src/public/leadgen/bundle";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import { renderLayout } from "../src/public/templates/layout";
import { buildLeadgenEnv, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { parseHtml, type MiniNode } from "./helpers/mini-dom";
import { addSite, createDb, type SqliteDb } from "./helpers/x06-a2-sqlite";

const site = "cls-site";
const host = site + ".example";
const snapshotVersion = "a".repeat(64);
const id = (prefix: string) => prefix + "_" + "1".padStart(26, "0");
const wide = { key: "partners/wide.png", width: 813, height: 217 };
const square = { key: "partners/square.png", width: 175, height: 175 };
const tall = { key: "partners/tall.png", width: 91, height: 150 };
const frame = {
  version: 1, template: "header-footer",
  header: { enabled: true, logo_size: "s" }, mobile: { logo_size: "l" },
  brand_logos: { enabled: true, layout: "row", items: [
    { media_id: square.key, alt: "Square", size: "l" },
    { url: "/media/" + tall.key, alt: "Tall", size: "s" },
    { media_id: "empty.png", alt: "Unsized", size: "m" },
    { url: "https://outside.example/logo.png", alt: "External", size: "l" },
  ] },
  trust_strip: { enabled: true, source: "site_logo_set" },
  footer: { enabled: true, blocks: [
    { type: "logo", logo_source: "manual", logo_media_id: tall.key, logo_alt: "Footer" },
    { type: "logo", logo_source: "site" },
  ] },
};
const components = [
  { type: "QuestionHeadline", question_id: "q_title", bind: "section_headline" },
  { type: "Subheadline", question_id: "q_intro", props: { text: "Choose your cover" } },
  { type: "TwoButtonYesNo", question_id: "q_own", question_key: "own", internal_field: "own" },
  { type: "LogoStrip", question_id: "q_partners", props: { logos: [{ mediaId: tall.key, alt: "Section" }] } },
];

function seed(db: SqliteDb) {
  addSite(db, site, "CLS Quotes", "health");
  db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(site, host);
  const media = db.prepare("INSERT INTO media (site_id, filename, storage_key, mime_type, width, height) VALUES (?, ?, ?, 'image/png', ?, ?)");
  for (const logo of [wide, square, tall]) media.run(logo === square ? null : site, logo.key, logo.key, logo.width, logo.height);
  media.run(site, "empty.png", "empty.png", null, 100);
  const setting = db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  setting.run(site, "logo_media_id", wide.key);
  setting.run(site, "trust_logo_media_ids", JSON.stringify([square.key]));
  db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (1, ?, 'Home insurance', 'quote_funnel', '[]', 'active')`).run(id("lgq"));
  db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, 1, 1, 'home')").run(site);
  db.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status, frame_config_json, theme_json)
    VALUES (1, ?, 1, 'Home', 'active', ?, ?)`).run(id("lgf"), JSON.stringify(frame),
    JSON.stringify({ typography: { display: "poppins", body: "poppins" } }));
  db.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp)
    VALUES (1, ?, 1, 'A', 10000)`).run(id("lgn"));
  db.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (1, ?, 'Home', 'quote_funnel', 'health', 'Do you own your home?', ?)`).run(id("lgs"), JSON.stringify({ components }));
  db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 1, 0)").run();
}

function expectBox(doc: MiniNode, selector: string, size: { width: number; height: number }, height: number) {
  const node = doc.querySelector(selector);
  expect(node, selector).not.toBeNull();
  expect(node!.getAttribute("height"), selector).toBe(String(height));
  expect(node!.getAttribute("width"), selector).toMatch(/^\d+$/);
  expect(Math.abs(Number(node!.getAttribute("width")) - height * size.width / size.height), selector).toBeLessThanOrEqual(1);
}

function fontPreloads(doc: MiniNode) {
  return doc.querySelectorAll('head link[rel="preload"][as="font"]').map(link => {
    expect(link.hasAttribute("crossorigin")).toBe(true);
    expect(link.getAttribute("type")).toBe("font/woff2");
    return link.getAttribute("href");
  });
}

function pngHeader(width: number, height: number) {
  const bytes = Uint8Array.of(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 0, 0, 0, 0, 0,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

describe("quote first paint", () => {
  let db: SqliteDb;
  beforeEach(() => { db = createDb(); seed(db); });
  afterEach(() => db.close());

  function shellReader(failFirstMediaRead = false) {
    const binding = d1FromSqlite(db);
    // Two reads share a D1 round only when both have started before the first reply.
    const rounds: string[][] = [];
    let reply: Promise<void> | undefined;
    const prepare = binding.prepare.bind(binding);
    binding.prepare = sql => {
      const stmt = prepare(sql);
      const all = stmt.all.bind(stmt);
      stmt.all = async <T>() => {
        if (!reply) {
          rounds.push([]);
          reply = new Promise(resolve => setImmediate(() => { reply = undefined; resolve(); }));
        }
        rounds[rounds.length - 1]!.push(sql);
        await reply;
        if (failFirstMediaRead && /JOIN media\b/i.test(sql)) {
          failFirstMediaRead = false;
          throw new Error("media read unavailable");
        }
        return all<T>();
      };
      return stmt;
    };
    const get = vi.fn<(key: string, options: R2GetOptions) => Promise<Pick<R2ObjectBody, "arrayBuffer"> | null>>()
      .mockResolvedValue(null);
    const env = buildLeadgenEnv(binding, makeKvStub().kv, { extra: { EDGE_INNER: "1", MEDIA: { get } } });
    const read = async (withSnapshot = true) => {
      const headers = new Headers({ "x-cms-variant": "lg:" + id("lgn") });
      if (withSnapshot) headers.set("x-cms-snap-version", snapshotVersion);
      const res = await leadgenRouter.request("https://" + host + "/lg/home", { headers }, env);
      expect(res.status).toBe(200);
      return res.text();
    };
    return { read, rounds, get, env };
  }

  it("reserves intrinsic logo widths at each display height on a cold and warm bundle", async () => {
    const { read, rounds } = shellReader();
    const cold = await read();
    const doc = parseHtml(cold);
    expectBox(doc, ".lg-logo-img", wide, 24);
    expectBox(doc, "picture source", wide, 44);
    expectBox(doc, 'img[alt="Square"]', square, 48);
    expectBox(doc, 'img[alt="Tall"]', tall, 24);
    expectBox(doc, ".lg-frame-trust img", square, 32);
    expectBox(doc, 'img[alt="Footer"]', tall, 32);
    expectBox(doc, ".lg-frame-footer-logo", wide, 32);
    expectBox(doc, 'img[alt="Section"]', tall, 32);
    expectBox(doc, 'img[alt="Unsized"]', { width: 3, height: 1 }, 32);
    expectBox(doc, 'img[alt="External"]', { width: 3, height: 1 }, 48);
    expect(cold).not.toContain('"logoDimensions"');
    const mediaReads = rounds.flat().filter(sql => /JOIN media\b/i.test(sql));
    expect(mediaReads).toHaveLength(1);
    expect(rounds.find(round => round.includes(mediaReads[0]!))?.some(sql => sql.includes("FROM leadgen_section_answer_maps"))).toBe(true);
    rounds.length = 0;
    expect(await read()).toBe(cold);
    expect(rounds.flat().filter(sql => /JOIN media\b/i.test(sql))).toHaveLength(0);
  });

  it("reserves the same widths without a snapshot version, in the existing shell-input round", async () => {
    const { read, rounds } = shellReader();
    const doc = parseHtml(await read(false));
    expectBox(doc, 'img[alt="Square"]', square, 48);
    expectBox(doc, 'img[alt="Section"]', tall, 32);
    const mediaRounds = rounds.filter(round => round.some(sql => /JOIN media\b/i.test(sql)));
    expect(mediaRounds).toHaveLength(1);
    expect(mediaRounds[0]!.some(sql => sql.includes("FROM leadgen_section_answer_maps"))).toBe(true);
  });

  it("reads one R2 prefix per unsized object in parallel and serves those sizes from the warm bundle", async () => {
    const tallRow = db.prepare("UPDATE media SET width = NULL, height = NULL WHERE storage_key = ? RETURNING id")
      .get(tall.key) as { id: number };
    db.prepare("UPDATE site_settings SET value = ? WHERE site_id = ? AND key = 'trust_logo_media_ids'")
      .run(JSON.stringify([String(tallRow.id)]), site);
    const partner = { width: 530, height: 75 };
    const { read, rounds, get, env } = shellReader();
    const heads = new Map([["empty.png", partner], [tall.key, tall]]);
    let activeReads = 0;
    let peakReads = 0;
    get.mockImplementation(async key => {
      activeReads++;
      peakReads = Math.max(peakReads, activeReads);
      await new Promise<void>(resolve => setImmediate(resolve));
      activeReads--;
      const size = heads.get(key);
      return size ? new Response(pngHeader(size.width, size.height)) : null;
    });
    const cold = await read();
    const doc = parseHtml(cold);
    expectBox(doc, 'img[alt="Unsized"]', partner, 32);
    expectBox(doc, 'img[alt="Section"]', tall, 32);
    expectBox(doc, ".lg-frame-trust img", tall, 32);
    expect(get).toHaveBeenCalledTimes(2);
    for (const key of heads.keys()) {
      expect(get).toHaveBeenCalledWith(key, { range: { offset: 0, length: 65536 } });
    }
    expect(peakReads).toBe(2);
    expect(db.prepare("SELECT width, height FROM media WHERE storage_key = ?").get("empty.png"))
      .toEqual({ width: null, height: 100 });

    get.mockClear();
    rounds.length = 0;
    const bundle = await loadPreparedFunnelBundle(env, new Headers({ "x-cms-snap-version": snapshotVersion }), site, id("lgn"));
    expect(bundle?.resolved.site_branding?.logoDimensions).toMatchObject({
      "/media/empty.png": partner,
      ["/media/" + tall.key]: { width: tall.width, height: tall.height },
      ["/media/" + tallRow.id]: { width: tall.width, height: tall.height },
    });
    expect(await read()).toBe(cold);
    expect(get).toHaveBeenCalledTimes(0);
    expect(rounds.flat().filter(sql => /JOIN media\b/i.test(sql))).toHaveLength(0);
  });

  it("keeps the other logo sizes when an R2 read fails and retries on the next build", async () => {
    const { read, get } = shellReader();
    get.mockRejectedValueOnce(new Error("R2 read failed"))
      .mockResolvedValue(new Response(pngHeader(255, 50)));
    const first = parseHtml(await read());
    expectBox(first, 'img[alt="Square"]', square, 48);
    expectBox(first, 'img[alt="Unsized"]', { width: 3, height: 1 }, 32);
    const repaired = await read();
    expectBox(parseHtml(repaired), 'img[alt="Unsized"]', { width: 255, height: 50 }, 32);
    expect(await read()).toBe(repaired);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["/api/admin/leadgen/assets/brand-logo", 200],
    ["/admin/media", 200],
    ["/api/admin/media/upload", 201],
  ] as const)("stores the uploaded SVG's dimensions on the new row via %s", async (url, status) => {
    const put = vi.fn().mockResolvedValue(null);
    const env = buildLeadgenEnv(d1FromSqlite(db), makeKvStub().kv, { extra: { DEV_BYPASS_AUTH: "true", MEDIA: { put } } });
    const form = new FormData();
    form.set("file", new File(['<svg viewBox="0 0 315 71"><rect width="4" height="2"/></svg>'],
      "new-partner.svg", { type: "image/svg+xml" }));
    const router = url === "/admin/media" ? media : admin;
    const res = await router.request(url, { method: "POST", body: form }, env);
    expect(res.status).toBe(status);
    expect(put).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT width, height FROM media WHERE filename = ?").get("new-partner.svg"))
      .toEqual({ width: 315, height: 71 });
  });

  it("matches absolute media URLs on this site's domains and keeps foreign logos at their original size", async () => {
    addSite(db, "neighbor", "Neighbor", "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES ('neighbor', 'neighbor.example', 'active')").run();
    db.prepare("INSERT INTO media (site_id, filename, storage_key, mime_type, width, height) VALUES ('neighbor', 'foreign.png', 'foreign.png', 'image/png', 62, 62)").run();
    const manual = { ...frame, trust_strip: { enabled: true, source: "manual", logos: [
      { media_id: "https://" + host + "/media/" + square.key, alt: "Local" },
      { media_id: "https://neighbor.example/media/" + square.key, alt: "ForeignHost" },
      { media_id: "foreign.png", alt: "ForeignRow" },
    ] }, footer: { enabled: true, show_logo: true } };
    db.prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE id = 1").run(JSON.stringify(manual));
    const { read, get } = shellReader();
    const doc = parseHtml(await read());
    expectBox(doc, 'img[alt="Local"]', square, 32);
    expectBox(doc, 'img[alt="ForeignHost"]', { width: 3, height: 1 }, 32);
    expectBox(doc, 'img[alt="ForeignRow"]', { width: 3, height: 1 }, 32);
    expectBox(doc, ".lg-frame-footer-logo", wide, 32);
    expect(get.mock.calls.map(([key]) => key)).toEqual(["empty.png"]);
  });

  it("uses the media row in a frameless section's header, header bar and auto site logo", async () => {
    db.prepare("UPDATE leadgen_funnels SET frame_config_json = NULL, theme_json = NULL WHERE id = 1").run();
    const numericId = db.prepare("SELECT id FROM media WHERE storage_key = ?").get(tall.key) as { id: number };
    const nodes = [
      { type: "HeaderLogo", question_id: "q_header", props: { logoUrl: wide.key, siteName: "Header" } },
      { type: "HeaderBar", question_id: "q_bar", props: { logoMediaId: String(numericId.id), logoAlt: "Bar" } },
      { type: "ImageBlock", question_id: "q_site", props: { source: "auto_logo", logoUrl: square.key, siteName: "Auto" } },
    ];
    db.prepare("UPDATE leadgen_sections SET content_json = ? WHERE id = 1").run(JSON.stringify({ components: nodes }));
    const doc = parseHtml(await shellReader().read());
    expectBox(doc, 'img[alt="Header"]', wide, 18);
    expectBox(doc, 'img[alt="Bar"]', tall, 32);
    expectBox(doc, 'img[alt="Auto"]', square, 18);
  });

  it("uses the previous box during a media read failure and retries on the next build", async () => {
    const { read, rounds } = shellReader(true);
    expectBox(parseHtml(await read()), 'img[alt="Square"]', { width: 3, height: 1 }, 48);
    expectBox(parseHtml(await read()), 'img[alt="Square"]', square, 48);
    expect(rounds.flat().filter(sql => /JOIN media\b/i.test(sql))).toHaveLength(2);
  });

  it.each(["poppins", "manrope"])("preloads the faces of the visible display and %s body families", async body => {
    db.prepare("UPDATE leadgen_funnels SET theme_json = ? WHERE id = 1")
      .run(JSON.stringify({ typography: { display: "poppins", body } }));
    const html = await shellReader().read();
    const doc = parseHtml(html);
    const section = doc.querySelector('[data-lg-index="0"]')!;
    expect(section.hasAttribute("hidden")).toBe(false);
    expect(section.querySelector(".lg-headline")?.getAttribute("style")).toContain("font-family:'Poppins'");
    expect(section.querySelector(".lg-subheadline")).not.toBeNull();
    const family = body === "poppins" ? "Poppins" : "Manrope";
    const bodyStack = /\[data-funnel-design="[^"]+"\]\s*\{[^}]*?font-family:\s*'([^']+)'/.exec(html);
    expect(bodyStack?.[1]).toBe(family);
    const facePaths = Array.from(html.matchAll(/@font-face\{font-family:'([^']+)';[^}]*src:url\("([^"]+)"\)/g))
      .filter(face => face[1] === "Poppins" || face[1] === family).map(face => face[2]!);
    expect(facePaths.length).toBe(body === "poppins" ? 3 : 5);
    expect(fontPreloads(doc).sort()).toEqual(facePaths.sort());
  });
});

it("adds only the article h1 face to the public head", () => {
  const head = (ogType: "article" | "website") => parseHtml(renderLayout({
    site: { name: "CLS Quotes", hostname: host }, meta: { title: "Insurance basics", ogType },
    body: '<h1 class="article-title">Insurance basics</h1>',
  }));
  const ordinary = fontPreloads(head("website"));
  expect(ordinary).toHaveLength(2);
  const article = head("article");
  expect(publicCss).toMatch(/--tw-font-display:\s*"Nunito"/);
  expect(publicCss).toMatch(/\.article-title\s*\{[^}]*font-family:\s*var\(--tw-font-display\)[^}]*font-weight:\s*900\b/);
  const css = article.querySelector("head style")!.textContent;
  const h1Face = /@font-face\{font-family:"Nunito";font-style:normal;font-weight:900;[^}]*src:url\("([^"]+)"\)/.exec(css);
  expect(h1Face).not.toBeNull();
  expect(fontPreloads(article)).toEqual([...ordinary, h1Face![1]]);
});
