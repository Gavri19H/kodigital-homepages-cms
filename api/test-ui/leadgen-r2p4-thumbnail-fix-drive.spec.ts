// R2 P4 S4c thumbnail-fix — the DRIVEN picker<->render side-by-side (contract
// §5.5, this slice's acceptance pack). S4c found the stepper THUMBNAIL had
// drifted the OTHER way from the original probe: the §6.8 renders (S4a,
// 1e2ea09) were fixed to FLANK a prominent value with -/+ on one row, then a
// SEPARATE full track+handle+captions below, but the picker's stepper
// thumbnail still depicted [-box][mini-track][+box] — a different, smaller
// anatomy than the render now delivers. This spec drives BOTH sides for real
// (the studio picker AND the live visitor render) and captures them
// side-by-side as the evidence pack's proof that picker == render.
//
// Own quote/section/slug (never the shared "r2fix" fixture rows the S4a/S4c
// specs already own): this mission runs its own wrangler dev on PW_PORT
// against the SAME shared local D1 file the S4b/S4c sibling servers use, so
// this spec creates ITS OWN quote + section + a UNIQUE activation slug
// rather than mutating shared fixture state. It reuses (read-only) the
// fixture's shared-page section and site row. No auction/offer is wired —
// the activation preflight's per-section provider-field check is a no-op
// when a section carries no selected_offers/answer_maps (quotes-handlers.ts
// computeVariantPreflightBlocks: `offerIds.length === 0` -> skip), and the
// auction-config check is gated on `variant.auction_id !== null` — so a
// bare headline+stepper+continue section needs neither.

import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { PW_PORT } from "./utils/base-url";

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "p4thumbfix";
const SHOT_DIR = "../docs/leadgen/r2/evidence/p4/thumbnails";
const HEADLINE = "P4 thumbnail-fix — stepper";
const STEPPER_QID = "p4tf_stepper";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});
test.describe.configure({ mode: "serial" });

let SECTION_ID: number;
let SECTION_PUBLIC_ID: string;
let QUOTE_PUBLIC_ID: string;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });

  // A brand-new section: ONE stepper slider (the anatomy under proof).
  const sectionRes = await ctx.post("/api/admin/leadgen/sections", {
    data: {
      section_name: "P4 Thumbnail-Fix Evidence Section",
      activity: "r2fix_activity",
      vertical: "r2fix_vertical",
      headline_text: HEADLINE,
      status: "active",
      content_json: {
        components: [
          { type: "QuestionHeadline", question_id: "p4tf_head", props: { text: HEADLINE } },
          {
            type: "NumberRangeQuestion",
            question_id: STEPPER_QID,
            question_key: "p4tf_coverage",
            internal_field: "p4tf_coverage",
            answer_type: "number",
            props: {
              label: "Stepper — Coverage",
              slider_type: "stepper",
              min: 5000,
              max: 500000,
              step: 5000,
              default: 170000,
              currency_affix: true,
            },
          },
          { type: "ContinueButton", question_id: "p4tf_cont", props: { label: "Continue" } },
        ],
      },
    },
  });
  const sectionStatus = sectionRes.status();
  const sectionBody = (await sectionRes.json()) as { id: number; public_id: string };
  console.log(`CREATE section -> HTTP ${sectionStatus} (id=${sectionBody.id})`);
  if (sectionStatus !== 200 && sectionStatus !== 201) throw new Error(`section create failed: ${sectionStatus}`);
  SECTION_ID = sectionBody.id;
  SECTION_PUBLIC_ID = sectionBody.public_id;

  // A brand-new quote (own funnel/variant, auto-created by the quote create).
  const quoteRes = await ctx.post("/api/admin/leadgen/quotes", {
    data: { quote_name: "P4 Thumbnail-Fix Evidence Quote", activity: "r2fix_activity", verticals: ["r2fix_vertical"] },
  });
  const quoteStatus = quoteRes.status();
  const quoteBody = (await quoteRes.json()) as { id: number; public_id: string };
  console.log(`CREATE quote -> HTTP ${quoteStatus} (public_id=${quoteBody.public_id})`);
  if (quoteStatus !== 200 && quoteStatus !== 201) throw new Error(`quote create failed: ${quoteStatus}`);
  QUOTE_PUBLIC_ID = quoteBody.public_id;

  const structureRes = await ctx.get(`/api/admin/leadgen/quotes/${QUOTE_PUBLIC_ID}/structure`);
  const structure = (await structureRes.json()) as {
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const variantPublicId = structure.funnels[0]?.variants[0]?.public_id;
  if (variantPublicId === undefined) throw new Error("fresh quote has no default funnel/variant");

  const wireRes = await ctx.put(`/api/admin/leadgen/variants/${variantPublicId}`, {
    data: { sections: [{ section_id: SECTION_ID, position: 0 }] },
  });
  console.log(`WIRE variant sections -> HTTP ${wireRes.status()}`);
  if (wireRes.status() !== 200) throw new Error(`variant wire failed: ${wireRes.status()} ${await wireRes.text()}`);

  // Reuse (read-only) the fixture's shared-page section — the activation
  // preflight requires a shared first page with >=1 section.
  const sharedList = (await (await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; public_id: string; section_name: string }>;
  };
  const sharedSection = sharedList.items.find((s) => s.section_name === "R2Fix Fixture Shared Continue");
  if (sharedSection === undefined) throw new Error("fixture shared section missing — run npm run seed:leadgen-fixture");
  const sharedRes = await ctx.post(`/api/admin/leadgen/quotes/${QUOTE_PUBLIC_ID}/shared-page`, {
    data: { sections: [{ section_id: sharedSection.id }] },
  });
  console.log(`CREATE shared page -> HTTP ${sharedRes.status()}`);
  if (sharedRes.status() !== 200 && sharedRes.status() !== 201) {
    throw new Error(`shared page create failed: ${sharedRes.status()} ${await sharedRes.text()}`);
  }

  // Reuse (read-only) the fixture's site row; activate under a UNIQUE slug.
  const sites = (await (await ctx.get("/api/admin/sites")).json()) as {
    resource?: Array<{ id: string; domain: string }>;
  };
  const site = (sites.resource ?? []).find((s) => s.domain === SITE_HOST);
  if (site === undefined) throw new Error("fixture site missing — run npm run seed:leadgen-fixture");
  const actRes = await ctx.put(`/api/admin/leadgen/quotes/${QUOTE_PUBLIC_ID}/activation/${site.id}`, {
    data: { enabled: true, slug: FUNNEL_SLUG },
  });
  console.log(`ACTIVATE quote (slug=${FUNNEL_SLUG}) -> HTTP ${actRes.status()}`);
  if (actRes.status() !== 200) throw new Error(`activation failed: ${actRes.status()} ${await actRes.text()}`);

  await ctx.dispose();
  await pollShellHas(STEPPER_QID);
});

// The tenant host only resolves inside the browser (--host-resolver-rules),
// so the SSR poll speaks raw HTTP to loopback with an explicit Host header
// (the same technique the S4a drive spec + seed script use).
function rawShell(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: Number(PW_PORT),
        path: `/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`,
        method: "GET",
        headers: { host: SITE_HOST, "user-agent": REAL_CHROME_UA },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve(body));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ADJ-N20: a section save can leave the visitor on a stale shell for up to
// 300s (the shell cache key does not carry content_version). This is a
// FIRST-time activation of a brand-new quote+site pair (no prior cached
// shell can exist under this key), so this converges immediately in
// practice — poll anyway rather than assume.
async function pollShellHas(needle: string): Promise<void> {
  const t0 = Date.now();
  for (let i = 0; i < 40; i += 1) {
    const html = await rawShell();
    if (html.includes(needle)) {
      console.log(`SSR converged in ${Date.now() - t0}ms (${i + 1} poll(s)): ${needle}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`SSR never served ${needle} (${Date.now() - t0}ms)`);
}

async function shot(page: Page, l: import("@playwright/test").Locator, path: string): Promise<void> {
  const b = await l.boundingBox();
  if (b === null) throw new Error(`no box for ${path}`);
  const vp = page.viewportSize() ?? { width: 1280, height: 1000 };
  const x = Math.max(0, b.x - 16);
  const y = Math.max(0, b.y - 62);
  await page.screenshot({
    path,
    clip: { x, y, width: Math.min(vp.width - x, b.width + 32), height: Math.min(vp.height - y, b.height + 74) },
  });
}

test("the studio picker's five slider-type thumbnails, driven live", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/admin/leadgen/sections/${SECTION_PUBLIC_ID}/edit`, { waitUntil: "domcontentloaded" });

  const canvasNode = page.frameLocator("#lg-studio-canvas-frame").locator(`[data-question-id="${STEPPER_QID}"]`);
  await expect(canvasNode.first(), "the stepper node is rendered in the canvas").toBeVisible({ timeout: 20_000 });
  await canvasNode.first().click();

  const contentTab = page.locator('[data-studio-inspector-tab="content"]');
  if (await contentTab.isVisible()) await contentTab.click();

  const grid = page.locator(".studio-slider-type-grid");
  await expect(grid, "the slider-type picker is revealed for a selected NumberRangeQuestion").toBeVisible({
    timeout: 10_000,
  });
  await expect(grid.locator('[data-set-slider-type="stepper"]'), "the stepper card is present").toBeVisible();
  await grid.screenshot({ path: `${SHOT_DIR}/thumbnails-1280.png` });
  console.log(`CAPTURED picker thumbnails -> ${SHOT_DIR}/thumbnails-1280.png`);
});

test("the live visitor stepper render, driven for real", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`http://${SITE_HOST}:${PW_PORT}/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByText(HEADLINE).first().isVisible()) break;
    await page.locator("[data-lg-continue]:visible").first().click();
    await page.waitForTimeout(600);
  }
  await expect(page.getByText(HEADLINE).first()).toBeVisible();

  const stepper = page.locator(`[data-lg-question="${STEPPER_QID}"]`).first();
  await expect(stepper.locator(".lg-range-track")).toHaveCount(1);
  await expect(stepper.locator(".lg-range-handle")).toHaveCount(1);
  await expect(stepper.locator('[data-lg-step="dec"]')).toBeVisible();
  await expect(stepper.locator('[data-lg-step="inc"]')).toBeVisible();
  await shot(page, stepper, `${SHOT_DIR}/stepper-render-1280.png`);
  console.log(`CAPTURED stepper render -> ${SHOT_DIR}/stepper-render-1280.png`);
});
