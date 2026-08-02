// R2 P7 — LIVE OPERATOR/VISITOR DRIVE for the owner's three screenshot defects
// (E6/E10/E11). Nothing here asserts that code exists: every number below is
// measured out of a real browser, on the real admin canvas and the real served
// visitor page, after the change was made through the real admin API.
//
//   D1 (SRC-11A "I chose a site - why I don't see its logo????")
//       — the canvas logo box for an ACTIVATED and a NOT-ACTIVATED site with
//         the SAME logo (activation is not the discriminator), plus the
//         unreachable-asset case that IS the reported "tiny mark".
//   D2 ("three of the five options are identical … where is the icon on
//       track??? how do I define it????")
//       — all five progress styles measured on the LIVE visitor page and
//         proven pairwise distinct by what a visitor can SEE.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOGO_UNREACHABLE_CANVAS_TEXT } from "../src/admin/leadgen/quotes-tabs/templates";

const PW_PORT = process.env["PW_PORT"] || "8787";
const BASE = `http://127.0.0.1:${PW_PORT}`;
const ADMIN = `${BASE}/api/admin/leadgen`;
const HOST = "r2fix.e2e.test";
const SLUG = "r2fix";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "..", "..", "docs", "leadgen", "r2", "evidence", "p7-owner", "logo-progress-copy");

// The seeded fixture (scripts/seed-leadgen-fixture.ts) — ACTIVATED site.
const ACTIVE_SITE_NAME = "R2Fix Fixture Site";
// A second CMS site with NO activation row for this quote → the site select
// badges it "Not activated yet", the owner's exact state.
const UNACTIVATED_SITE_NAME = "Seed Local Living";

const PROGRESS_STYLES = ["bar", "dots", "numbered", "percent", "icon_on_track"] as const;

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });
test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

interface Ids {
  quote: string;
  funnel: string;
  variant: string;
  activeSite: string;
  unactivatedSite: string;
}

async function ids(request: import("@playwright/test").APIRequestContext): Promise<Ids> {
  const quotes = await (await request.get(`${ADMIN}/quotes`)).json();
  const quote = (quotes.items as Array<{ public_id: string; quote_name: string }>).find((q) =>
    q.quote_name.toLowerCase().includes("r2fix"),
  );
  expect(quote, "the seeded R2Fix quote exists").toBeTruthy();
  const detail = await (await request.get(`${ADMIN}/quotes/${quote!.public_id}`)).json();
  const funnel = detail.funnels[0];
  const variants = await (await request.get(`${ADMIN}/funnels/${funnel.public_id}/variants`)).json();
  const sites = await (await request.get(`${BASE}/api/admin/sites`)).json();
  const byName = (n: string): string => {
    const row = (sites.resource as Array<{ id: string; name: string }>).find((s) => s.name === n);
    expect(row, `CMS site "${n}" exists`).toBeTruthy();
    return row!.id;
  };
  return {
    quote: quote!.public_id,
    funnel: funnel.public_id,
    variant: variants.items[0].public_id,
    activeSite: byName(ACTIVE_SITE_NAME),
    unactivatedSite: byName(UNACTIVATED_SITE_NAME),
  };
}

async function setSiteLogo(
  request: import("@playwright/test").APIRequestContext,
  siteId: string,
  value: string,
): Promise<void> {
  const res = await request.patch(`${BASE}/api/admin/settings`, {
    data: { site_id: siteId, updates: { logo_media_id: value } },
  });
  expect(res.status(), await res.text()).toBe(200);
}

// A real, decodable 120x40 PNG built here (no fixture file, no hand-typed
// base64 that could quietly be corrupt — a corrupt bitmap would be measured as
// the very "broken image" case leg (b) is about, so the good case has to be
// provably good).
function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w * 3 }, (_, i) => [0x2b, 0x6c, 0xf6][i % 3] as number))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Upload a real 120x40 PNG through the REAL media endpoint (E11: the consumed
// side of the boundary is the artifact the product itself produced).
async function uploadLogo(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const png = makePng(120, 40);
  const res = await request.post(`${BASE}/admin/media`, {
    multipart: { file: { name: "r2p7-logo.png", mimeType: "image/png", buffer: png } },
  });
  expect(res.status(), await res.text()).toBeLessThan(400);
  return (await res.json()).storage_key as string;
}

// Drive the REAL Templates tab: open it, choose a preview site in the REAL
// select, wait for the canvas to re-render under that site's branding.
async function openCanvasForSite(
  page: import("@playwright/test").Page,
  quote: string,
  siteId: string,
): Promise<void> {
  await page.goto(`${BASE}/admin/leadgen/quotes/${quote}/edit`, { waitUntil: "domcontentloaded" });
  await page.locator('.lg-qtab[data-tab="templates"]').click();
  await page.locator("#lg-tpl-site-select").waitFor({ state: "visible", timeout: 20000 });
  await page.selectOption("#lg-tpl-site-select", siteId);
  const frame = page.frameLocator("#lg-tpl-canvas-iframe");
  await expect
    .poll(async () => frame.locator("[data-frame-region]").count(), { timeout: 20000 })
    .toBeGreaterThan(0);
  // the D1 broken-logo pass is deferred one tick after srcdoc parse
  await page.waitForTimeout(600);
}

test("D1 · the canvas logo: activation is not the discriminator, and an unreachable asset says so in words", async ({
  page,
  request,
}) => {
  const id = await ids(request);
  const key = await uploadLogo(request);

  // (a) BOTH states carry the SAME logo → measure the painted box in each.
  const boxes: Record<string, { w: number; h: number; natural: string }> = {};
  for (const [label, siteId] of [
    ["activated", id.activeSite],
    ["not-activated", id.unactivatedSite],
  ] as const) {
    await setSiteLogo(request, siteId, key);
    await openCanvasForSite(page, id.quote, siteId);
    const img = page.frameLocator("#lg-tpl-canvas-iframe").locator("img.lg-logo-img");
    await expect(img, `${label}: the chosen site's logo renders`).toHaveCount(1);
    const m = await img.first().evaluate((el) => {
      const i = el as HTMLImageElement;
      const r = i.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), natural: `${i.naturalWidth}x${i.naturalHeight}` };
    });
    boxes[label] = m;
    expect(m.natural, `${label}: the logo bitmap actually decoded`).toBe("120x40");
    expect(m.w, `${label}: the logo is painted, not a sliver`).toBeGreaterThan(60);
    expect(m.h, `${label}: the logo is painted, not a sliver`).toBeGreaterThan(24);
  }
  // The owner's hypothesis, measured: the two states are the SAME box.
  expect(boxes["not-activated"], "an unactivated site's logo renders exactly like an activated one").toEqual(
    boxes["activated"],
  );
  console.log(`D1 logo box activated=${JSON.stringify(boxes["activated"])} not-activated=${JSON.stringify(boxes["not-activated"])}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(SHOTS, "d1-logo-unactivated-1280.png"), fullPage: false });

  // (b) THE REPORTED SYMPTOM: the site still names a logo, but the asset is
  // gone. Before this fix the canvas painted a ~143x18 broken-image sliver
  // with no explanation; now it reads as a sentence.
  await setSiteLogo(request, id.unactivatedSite, "2026/08/02/r2p7-deleted-asset.png");
  const gone = await request.get(`${BASE}/media/2026/08/02/r2p7-deleted-asset.png`);
  expect(gone.status(), "the referenced asset really is unreachable").toBe(404);
  await openCanvasForSite(page, id.quote, id.unactivatedSite);
  const canvas = page.frameLocator("#lg-tpl-canvas-iframe");
  const chip = canvas.locator("[data-logo-unreachable]");
  await expect(chip, "the canvas explains the missing logo in plain words").toHaveCount(1);
  await expect(chip).toHaveText(LOGO_UNREACHABLE_CANVAS_TEXT);
  await expect(canvas.locator("img.lg-logo-img"), "no dead <img> is left behind").toHaveCount(0);
  const chipBox = await chip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  expect(chipBox.w, "the message is a readable line, not a tiny mark").toBeGreaterThan(200);
  console.log(`D1 unreachable-asset chip box=${JSON.stringify(chipBox)} text=${LOGO_UNREACHABLE_CANVAS_TEXT}`);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `d1-logo-unreachable-${width}.png`) });
  }

  // (c) and the site with NO logo at all keeps its own honest chip.
  await setSiteLogo(request, id.unactivatedSite, "");
  await openCanvasForSite(page, id.quote, id.unactivatedSite);
  await expect(
    page.frameLocator("#lg-tpl-canvas-iframe").locator(".lg-frame-logo-fallback"),
    "a site with no logo still says so",
  ).toHaveCount(1);
  await setSiteLogo(request, id.unactivatedSite, key);
});

interface StyleShot {
  visibleBoxes: string;
  markerPaint: string;
  text: string;
}

async function visitorStyleShot(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  funnel: string,
  style: string,
  icon: string | null,
  quote: string,
  siteId: string,
  width: number,
): Promise<StyleShot> {
  const progress: Record<string, unknown> = { style, position: "under_header", width: "content", thickness: "m" };
  if (icon !== null) progress["icon"] = icon;
  const put = await request.put(`${ADMIN}/funnels/${funnel}/frame`, {
    data: { frame_config_json: { version: 1, template: "centered", progress } },
  });
  expect(put.status(), await put.text()).toBe(200);
  // ADJ-N39: the served shell is cached; re-assert the activation and poll a
  // cache-busted URL until the shell carries the style just written.
  await request.put(`${ADMIN}/quotes/${quote}/activation/${siteId}`, { data: { enabled: true, slug: SLUG } });
  const want = `lg-frame-progress--${style}`;
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) {
    if (i > 0 && i % 12 === 0) {
      await request.put(`${ADMIN}/quotes/${quote}/activation/${siteId}`, { data: { enabled: true, slug: SLUG } });
    }
    const res = await request.get(`${BASE}/lg/${SLUG}?_cb=p${Date.now()}${i}`, { headers: { Host: HOST } });
    const body = await res.text();
    expect(body, "the polled response is the funnel shell").toContain("lg-funnel-root");
    ok = body.includes(want);
    if (!ok) await new Promise((r) => setTimeout(r, 250));
  }
  expect(ok, `the served shell reflects progress style ${style}`).toBe(true);

  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://${HOST}:${PW_PORT}/lg/${SLUG}?_cb=${Date.now()}${width}`, { waitUntil: "load" });
  const region = page.locator("[data-frame-region='progress']");
  await region.first().waitFor({ state: "visible", timeout: 15000 });
  return await region.first().evaluate((el) => {
    // What a VISITOR can see: every descendant that actually occupies pixels,
    // with its painted size and colour — a 0x0 or display:none node is not a
    // visible difference and is deliberately excluded (that exclusion is what
    // exposed bar/percent as identical before this change).
    const seen: string[] = [];
    el.querySelectorAll("*").forEach((k) => {
      const r = (k as HTMLElement).getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const cs = getComputedStyle(k);
      seen.push(
        `${k.tagName}|${Math.round(r.width)}x${Math.round(r.height)}|bg=${cs.backgroundColor}` +
          `|img=${cs.backgroundImage.slice(0, 40)}|ring=${cs.boxShadow.slice(0, 40)}|radius=${cs.borderRadius}`,
      );
    });
    const fill = el.querySelector(".lg-progress-fill");
    // A cheap stable digest so two different glyph data-URIs never collapse to
    // the same signature through truncation (they did at 60 chars).
    const digest = (s: string): string => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
      return `${s.length}#${(h >>> 0).toString(36)}`;
    };
    const paint = (pseudo: string): string => {
      const t = getComputedStyle(fill ?? el, pseudo);
      if (t.content === "none") return `${pseudo}:none`;
      const mask = (t as unknown as Record<string, string>)["maskImage"] ?? "none";
      return `${pseudo}:${t.width}x${t.height}|bg=${t.backgroundColor}|mask=${digest(mask)}|img=${digest(t.backgroundImage)}`;
    };
    return {
      visibleBoxes: seen.join(" · "),
      markerPaint: `${paint("::before")} ;; ${paint("::after")}`,
      text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
    };
  });
}

test("D2 · all five progress styles are pairwise distinct to a visitor on the LIVE page", async ({ page, request }) => {
  const id = await ids(request);
  const shots: Record<string, StyleShot> = {};
  for (const style of PROGRESS_STYLES) {
    for (const width of [1280, 375]) {
      const shot = await visitorStyleShot(
        page,
        request,
        id.funnel,
        style,
        style === "icon_on_track" ? "car" : null,
        id.quote,
        id.activeSite,
        width,
      );
      if (width === 1280) shots[style] = shot;
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `no horizontal overflow at ${width} for ${style}`,
      ).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `d2-${style}-${width}.png`) });
    }
    console.log(`D2 ${style} boxes = ${shots[style]!.visibleBoxes}`);
    console.log(`D2 ${style} marker = ${shots[style]!.markerPaint}`);
    console.log(`D2 ${style} text   = ${JSON.stringify(shots[style]!.text)}`);
  }
  let pairs = 0;
  for (let i = 0; i < PROGRESS_STYLES.length; i++) {
    for (let k = i + 1; k < PROGRESS_STYLES.length; k++) {
      const a = PROGRESS_STYLES[i] as string;
      const b = PROGRESS_STYLES[k] as string;
      const sa = shots[a] as StyleShot;
      const sb = shots[b] as StyleShot;
      const same =
        sa.visibleBoxes === sb.visibleBoxes && sa.markerPaint === sb.markerPaint && sa.text === sb.text;
      expect(same, `${a} and ${b} must not paint the same thing`).toBe(false);
      pairs++;
    }
  }
  expect(pairs, "every unordered pair of the five styles was compared").toBe(10);
});

test("D2 · the five picker thumbnails are five different pictures (ADJ-N23: a picker must look like what it produces)", async ({
  page,
  request,
}) => {
  const id = await ids(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin/leadgen/quotes/${id.quote}/edit`, { waitUntil: "domcontentloaded" });
  await page.locator('.lg-qtab[data-tab="templates"]').click();
  const picker = page.locator("#lg-tpl-progress-types");
  await picker.waitFor({ state: "visible", timeout: 20000 });
  const paints: Record<string, string> = {};
  for (const style of PROGRESS_STYLES) {
    const thumb = picker.locator(`.lg-tpl2-ptype-thumb--${style}`);
    await expect(thumb, `${style} has its own thumbnail`).toHaveCount(1);
    paints[style] = await thumb.evaluate((el) => {
      const cs = getComputedStyle(el);
      const knob = getComputedStyle(el, "::after");
      return [
        cs.backgroundImage,
        cs.backgroundSize,
        cs.backgroundPosition,
        cs.boxShadow,
        knob.content === "none" ? "no-knob" : `knob:${knob.width}x${knob.height}@${knob.left}`,
      ].join(" | ");
    });
    console.log(`D2 thumb ${style} = ${paints[style]}`);
  }
  const seen = new Set(Object.values(paints));
  expect(seen.size, "no two thumbnails paint the same picture").toBe(PROGRESS_STYLES.length);
  // and each thumbnail carries the trait of the render it stands for
  expect(paints["bar"], "bar's thumbnail is a plain fill").toContain("linear-gradient");
  expect(paints["percent"], "percent's thumbnail is striped like its fill").toContain("repeating-linear-gradient");
  expect(paints["dots"], "dots' thumbnail is round dots").toContain("radial-gradient");
  expect(paints["numbered"], "numbered's thumbnail is ringed badges").toContain("radial-gradient");
  expect(paints["icon_on_track"], "icon-on-track's thumbnail carries the marker").toContain("knob:");
  await picker.screenshot({ path: path.join(SHOTS, "d2-picker-thumbnails-1280.png") });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(150);
  await picker.screenshot({ path: path.join(SHOTS, "d2-picker-thumbnails-375.png") });
});

test("D2 · the operator chooses WHICH icon, and the choice reaches the live visitor page", async ({ page, request }) => {
  const id = await ids(request);

  // The control exists in the REAL I·Progress panel and offers the real enum.
  await page.goto(`${BASE}/admin/leadgen/quotes/${id.quote}/edit`, { waitUntil: "domcontentloaded" });
  await page.locator('.lg-qtab[data-tab="templates"]').click();
  const iconSelect = page.locator('[data-tplbox-panel="progress"] select[data-frame-key="progress.icon"]');
  await expect(iconSelect, "the I·Progress panel carries a marker-icon control").toHaveCount(1);
  const options = await iconSelect.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(options).toEqual(["dot", "car", "shield", "check", "star", "site_logo"]);

  // Two different choices must PAINT differently on the live page.
  const painted: Record<string, string> = {};
  for (const icon of ["dot", "car", "star", "site_logo"]) {
    const shot = await visitorStyleShot(page, request, id.funnel, "icon_on_track", icon, id.quote, id.activeSite, 1280);
    painted[icon] = shot.markerPaint;
    console.log(`D2 icon=${icon} marker = ${shot.markerPaint}`);
    await page.screenshot({ path: path.join(SHOTS, `d2-icon-${icon}-1280.png`) });
  }
  expect(painted["car"], "car is not the bare dot").not.toBe(painted["dot"]);
  expect(painted["star"], "star is not car").not.toBe(painted["car"]);
  expect(painted["site_logo"], "the site mark is not a built-in glyph").not.toBe(painted["star"]);

  // The marker must ride the VISITOR'S POSITION, not a fixed spot. Proof in two
  // measured hops on the composed preview (the surface that server-renders a
  // chosen step): (1) the mark is anchored to the fill's right edge — computed
  // right:0 with translate(50%,-50%) — and (2) that edge really moves between
  // step 1 and step 2, so the mark moves with it. Screenshots at both steps.
  const anchors: Array<{ step: number; fillRight: number; before: string; after: string }> = [];
  for (const step of [1, 2]) {
    const res = await request.post(`${ADMIN}/variants/${id.variant}/preview`, {
      data: {
        mode: "all",
        page: step,
        site_id: id.activeSite,
        draft_frame_config: { version: 1, template: "centered", progress: { style: "icon_on_track", icon: "car" } },
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()).preview as { html: string; css: string; section_count: number; page?: number };
    expect(
      body.section_count,
      "the travel proof needs a funnel with at least two steps (re-run npm run seed:leadgen-fixture)",
    ).toBeGreaterThan(1);
    expect(body.page, "the composed preview rendered the step asked for").toBe(step);
    const p = body;
    await page.setContent(`<base href="${BASE}/"><style>${p.css}</style>${p.html}`);
    const m = await page.locator("[data-frame-region='progress'] .lg-progress-fill").first().evaluate((el) => {
      const b = getComputedStyle(el, "::before");
      const a = getComputedStyle(el, "::after");
      return {
        fillRight: Math.round(el.getBoundingClientRect().right),
        before: `${b.right}|${b.transform}`,
        after: `${a.right}|${a.transform}`,
      };
    });
    anchors.push({ step, ...m });
    await page.screenshot({ path: path.join(SHOTS, `d2-icon-travel-step${step}.png`) });
  }
  console.log(`D2 marker travel = ${JSON.stringify(anchors)}`);
  for (const a of anchors) {
    expect(a.before, "the glyph is pinned to the fill's leading edge").toContain("0px");
    expect(a.after, "the disc is pinned to the fill's leading edge").toContain("0px");
  }
  expect(anchors[1]!.fillRight, "the fill's leading edge advances with the step").toBeGreaterThan(
    anchors[0]!.fillRight,
  );
});
