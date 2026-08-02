// LeadGen R2 · P7 — F-3 DRIVE: does the operator's SIZE work survive the
// preset -> inline fork?
//
// THE CLASS (rejected in ADJ-A7, P5-F11, P6-FIX-1, and closed for `corners`
// only in P6-FIX-7): inline theme_json and a {theme_id} preset are MUTUALLY
// EXCLUSIVE. The operator's FIRST Themes-rail edit forks theme_json from a
// pointer into inline values (themes.ts flushThemeEdits -> the shared island's
// inlineThemeFromPreset), and the record leaves resolution for good. Anything
// the resolver does not carry is discarded at that instant, silently.
//
// This spec measures the PAINTED box on the live visitor page — never source,
// never the emitted declaration alone — across the real fork:
//   1. build a preset with a NON-DEFAULT field height + button size + corners
//   2. apply it through the REAL "Apply to this funnel" button
//   3. measure (1280 + 375)
//   4. edit ONE UNRELATED rail control — a COLOUR — through the REAL rail
//   5. re-measure after a fresh cache-bust; the two must be identical
// Arm B proves the three field-height steps are VISIBLY distinct; arm C
// re-proves the seeded no-theme funnel is untouched.
//
// Run (worktree-isolated, this worktree's port):
//   cd api && PW_PORT=8901 F3_ARM=before npx playwright test \
//     test-ui/leadgen-r2p7-f3-fork-survival-drive.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  LG_API,
  ORIGIN,
  PORT,
  REAL_CHROME_UA,
  createSection,
  json,
  passSharedPage,
  ready,
  seedRoutingQuote,
  shellUrl,
  uniqueTag,
} from "./leadgen-rework-acceptance-helpers";

const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p7-owner/fork-survival";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const MEASUREMENTS = `${EVIDENCE_DIR}/measurements.txt`;
const ARM = process.env["F3_ARM"] ?? "unset";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  appendFileSync(MEASUREMENTS, `\n===== ARM=${ARM} run ${new Date().toISOString()} =====\n`);
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

function note(line: string): void {
  appendFileSync(MEASUREMENTS, `[${ARM}] ${line}\n`);
}

function firstMatch(haystack: string, re: RegExp): string {
  const m = haystack.match(re);
  return m === null ? "ABSENT" : m[0];
}

interface Painted {
  fieldMinHeight: string;
  fieldBox: number;
  fieldPadding: string;
  btnMinHeight: string;
  btnBox: number;
  cardRadius: string;
}

// The three controls under audit, measured as the browser paints them.
async function measureLive(page: Page, host: string, slug: string, label: string): Promise<Painted> {
  await page.goto(shellUrl(host, slug, `?_cb=${Date.now()}${Math.floor(Math.random() * 1000)}`), {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  // The seeded quote opens on its SHARED page; the text field lives on the
  // funnel page behind it. Walk forward until the real field is on screen —
  // a hidden node's getBoundingClientRect is not a measurement.
  const field = page.locator("input.lg-input").first();
  for (let i = 0; i < 4 && !(await field.isVisible()); i++) {
    await passSharedPage(page);
    await page.waitForTimeout(400);
  }
  await field.waitFor({ state: "visible", timeout: 20_000 });
  const data = await page.locator("#lg-funnel-root").evaluate((root) => {
    const input = root.querySelector<HTMLElement>("input.lg-input");
    // The funnel keeps every non-current step in the DOM behind `hidden`, and a
    // hidden node's rect is 0 — which is not a painted measurement. Take the
    // first button that is actually on screen.
    const visible = (sel: string): HTMLElement | null =>
      Array.from(root.querySelectorAll<HTMLElement>(sel)).find((el) => el.getClientRects().length > 0) ?? null;
    const btn = visible(".lg-continue") ?? visible(".lg-btn");
    const card = root.querySelector<HTMLElement>(".lg-question-card");
    const ics = input === null ? null : getComputedStyle(input);
    return {
      fieldMinHeight: ics === null ? "ABSENT" : ics.minHeight,
      fieldBox: input === null ? -1 : Math.round(input.getBoundingClientRect().height),
      fieldPadding: ics === null ? "ABSENT" : `${ics.paddingTop}/${ics.paddingBottom}`,
      btnMinHeight: btn === null ? "ABSENT" : getComputedStyle(btn).minHeight,
      btnBox: btn === null ? -1 : Math.round(btn.getBoundingClientRect().height),
      cardRadius: card === null ? "ABSENT" : getComputedStyle(card).borderRadius,
    };
  });
  note(
    `${label} PAINTED field min-height=${data.fieldMinHeight} box=${data.fieldBox}px padding=${data.fieldPadding} | ` +
      `button min-height=${data.btnMinHeight} box=${data.btnBox}px | card radius=${data.cardRadius}`,
  );
  return data;
}

// E6: both contract viewports, with the 375 overflow measured.
async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-1280.png`, fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-375.png`, fullPage: false });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  note(`${name} @375 scrollWidth=${m.sw} innerWidth=${m.iw} overflow=${m.sw > m.iw ? "YES" : "no"}`);
  expect(m.sw, `no horizontal overflow @375 (${name})`).toBeLessThanOrEqual(m.iw);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}

// ADJ-N39: the served shell lags a theme write (the KV sweep does not clear the
// caches.default mirror). The operator's own activation re-PUT mints a fresh
// shell key; poll the SERVED bytes until the chrome <style> block actually
// changes before believing any measurement.
async function chromeStyleHash(host: string, slug: string): Promise<string> {
  const res = await apiCtx.get(`http://127.0.0.1:${PORT}/lg/${slug}?_cb=${Date.now()}${Math.random()}`, {
    headers: { "user-agent": REAL_CHROME_UA, host },
  });
  const html = await res.text();
  const styles = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join("\n");
  return createHash("sha256").update(styles).digest("hex");
}

async function republishUntilStyleChanges(
  quotePublicId: string,
  siteId: string,
  slug: string,
  host: string,
  wasHash: string,
  label: string,
): Promise<string> {
  for (let i = 0; i < 90; i++) {
    if (i % 8 === 0) {
      const res = await apiCtx.put(`${LG_API}/quotes/${quotePublicId}/activation/${siteId}`, {
        data: { enabled: true, slug },
      });
      expect(res.status(), "the activation re-PUT succeeds").toBe(200);
    }
    const now = await chromeStyleHash(host, slug);
    if (now !== wasHash) {
      note(`${label}: served chrome <style> changed after ${i} polls (${wasHash.slice(0, 12)} -> ${now.slice(0, 12)})`);
      return now;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label}: served chrome <style> never changed from ${wasHash.slice(0, 12)} (ADJ-N39 ruled out)`);
}

// The EXACT body the Themes manager's own "New theme" button POSTs
// (ui-theme-manager.ts wireNewTheme) — a preset built any other way would not
// be the operator's preset.
const newThemeBody = (name: string): Record<string, unknown> => ({
  name,
  roles: {
    brand_primary: "#1B3A5C",
    accent: "#2E6BB0",
    page_bg: "#FFFFFF",
    card: "#FFFFFF",
    text: "#1A1F36",
    success: "#0E7C3A",
    error: "#B23A2C",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
});

const TEXT_FIELD_NODES = (tag: string): unknown[] => [
  { type: "QuestionHeadline", question_id: `${tag}_head`, props: { text: `F3 text ${tag}` } },
  {
    type: "FreeTextQuestion",
    question_id: `${tag}_text`,
    question_key: `${tag}_text`,
    internal_field: `${tag}_text`,
    answer_type: "string",
    props: { label: "Your name", placeholder: "Name" },
  },
  { type: "ContinueButton", question_id: `${tag}_cont`, props: { label: "Continue" } },
];

// ===========================================================================
// A — the operator's field height + button size must SURVIVE the first rail
//     edit. Corners rides along as the P6-FIX-7 regression re-proof.
// ===========================================================================
test("A — a preset's field height, button size and corners all survive the first rail edit", async ({ page }) => {
  const u = uniqueTag("f3a");
  const seed = await seedRoutingQuote(apiCtx, {
    tag: "p7f3a",
    sharedHeadline: `F3 shared ${u}`,
    funnels: [{ headline: `F3 tail ${u}`, field: "f3a_tail" }],
  });
  const funnelId = seed.funnels[0]!.public_id;
  const variantId = seed.funnels[0]!.variant_public_id;

  // A funnel page carrying a REAL `.lg-input` — the helper sections only build
  // ButtonAnswerGroup pages, and a field height with no field is not a
  // measurement.
  const textSection = await createSection(apiCtx, `F3 text ${u}`, TEXT_FIELD_NODES("f3a"));
  await json(
    await apiCtx.put(`${LG_API}/variants/${variantId}`, {
      data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: textSection.id }] }] },
    }),
    "variant pages (text field)",
  );

  // --- (1) a preset with THREE non-default controls ------------------------
  const created = await json<{ item: { id: string } }>(
    await apiCtx.post(`${LG_API}/themes`, { data: newThemeBody(`F3 preset ${u}`) }),
    "theme create",
  );
  const themeId = created.item.id;
  const patch = await apiCtx.patch(`${LG_API}/themes/${themeId}`, {
    data: { controls: { field_height: "large", button_size: "l", corners: "pill" } },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  const stored = await json<{ item: { controls: Record<string, string> } }>(
    await apiCtx.get(`${LG_API}/themes/${themeId}`),
    "theme read-back",
  );
  note(`A preset ${themeId} controls = ${JSON.stringify(stored.item.controls)}`);
  expect(stored.item.controls).toMatchObject({ field_height: "large", button_size: "l", corners: "pill" });

  // --- (2) apply it through the REAL "Apply to this funnel" button ---------
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${seed.quotePublicId}/edit?variant=${variantId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-tab="themes"]').click();
  const sel = page.locator("#lg-theme-preset-select");
  await expect(sel).toBeVisible({ timeout: 20_000 });
  await expect(sel.locator(`option[value="${themeId}"]`)).toHaveCount(1, { timeout: 20_000 });
  await sel.selectOption(themeId);
  const applied = page.waitForResponse(
    (r) => r.url().includes(`/funnels/${funnelId}/theme`) && r.request().method() === "PUT",
  );
  await page.locator("#lg-theme-preset-apply").click();
  expect((await applied).status(), "apply-to-funnel succeeds").toBe(200);
  await page.waitForTimeout(1200);

  const beforeTheme = await json<{ theme: unknown }>(
    await apiCtx.get(`${LG_API}/funnels/${funnelId}/theme`),
    "stored theme (pre-fork)",
  );
  note(`A stored theme_json PRE-FORK = ${JSON.stringify(beforeTheme.theme)}`);
  expect(JSON.stringify(beforeTheme.theme), "the funnel stores a {theme_id} REFERENCE").toContain(themeId);

  // --- (3) measure the live page BEFORE the fork ---------------------------
  const applyHash = await republishUntilStyleChanges(
    seed.quotePublicId,
    seed.siteId,
    seed.slug,
    seed.host,
    "sentinel-never-matches",
    "A apply-preset",
  );
  const before = await measureLive(page, seed.host, seed.slug, "A BEFORE fork (preset applied)");
  await shot(page, "a-before-fork");

  // --- (4) the operator edits ONE UNRELATED rail control: a COLOUR ---------
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${seed.quotePublicId}/edit?variant=${variantId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-tab="themes"]').click();
  await expect(page.locator("#lg-theme-editor")).toBeVisible({ timeout: 20_000 });
  const row = page.locator("#lg-theme-palette .lg-theme-role-row").first();
  await row.locator("summary").first().click();
  const swatch = row.locator("[data-role-pick]").nth(2);
  await expect(swatch, "the palette role strip offers swatches").toBeVisible({ timeout: 15_000 });
  const themePut = page.waitForResponse(
    (r) => r.url().includes(`/funnels/${funnelId}/theme`) && r.request().method() === "PUT",
    { timeout: 30_000 },
  );
  await swatch.click();
  expect((await themePut).status(), "the rail colour edit is saved").toBe(200);
  await page.waitForTimeout(1200);

  const afterTheme = await json<{ theme: Record<string, unknown> }>(
    await apiCtx.get(`${LG_API}/funnels/${funnelId}/theme`),
    "stored theme (post-fork)",
  );
  note(`A stored theme_json POST-FORK = ${JSON.stringify(afterTheme.theme)}`);
  expect(afterTheme.theme["theme_id"], "the rail edit FORKED the pointer into inline values").toBeUndefined();

  // --- (5) re-measure with a fresh cache-bust ------------------------------
  await republishUntilStyleChanges(seed.quotePublicId, seed.siteId, seed.slug, seed.host, applyHash, "A post-fork");
  const after = await measureLive(page, seed.host, seed.slug, "A AFTER fork (one colour edited)");
  await shot(page, "a-after-fork");

  note(
    `A SUMMARY before field=${before.fieldMinHeight}/${before.fieldBox}px button=${before.btnMinHeight}/${before.btnBox}px card=${before.cardRadius} | ` +
      `after field=${after.fieldMinHeight}/${after.fieldBox}px button=${after.btnMinHeight}/${after.btnBox}px card=${after.cardRadius}`,
  );

  // The whole point: the operator changed a COLOUR. Nothing about size may move.
  expect(after.fieldMinHeight, "field height survives the fork (declared)").toBe(before.fieldMinHeight);
  expect(after.fieldBox, "field height survives the fork (PAINTED box)").toBe(before.fieldBox);
  expect(after.btnMinHeight, "button size survives the fork (declared)").toBe(before.btnMinHeight);
  expect(after.btnBox, "button size survives the fork (PAINTED box)").toBe(before.btnBox);
  expect(after.cardRadius, "corners survive the fork — the P6-FIX-7 re-proof").toBe(before.cardRadius);
  // …and the numbers must be REAL painted boxes, not a 0-height hidden node.
  expect(before.fieldBox, "the field was measured on screen").toBeGreaterThan(0);
  expect(before.btnBox, "the button was measured on screen").toBeGreaterThan(0);
});

// ===========================================================================
// B — the three field-height steps must be VISIBLY distinct on the live page.
//     A control that is measurably governed but paints the same box at 2 of 3
//     settings is still, from the operator's chair, a control that does
//     nothing.
// ===========================================================================
test("B — Small / Medium / Large paint three DIFFERENT field boxes", async ({ page }) => {
  const u = uniqueTag("f3b");
  const seed = await seedRoutingQuote(apiCtx, {
    tag: "p7f3b",
    sharedHeadline: `F3B shared ${u}`,
    funnels: [{ headline: `F3B tail ${u}`, field: "f3b_tail" }],
  });
  const variantId = seed.funnels[0]!.variant_public_id;
  const funnelId = seed.funnels[0]!.public_id;

  const textSection = await createSection(apiCtx, `F3B text ${u}`, TEXT_FIELD_NODES("f3b"));
  await json(
    await apiCtx.put(`${LG_API}/variants/${variantId}`, {
      data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: textSection.id }] }] },
    }),
    "variant pages (text field)",
  );

  const created = await json<{ item: { id: string } }>(
    await apiCtx.post(`${LG_API}/themes`, { data: newThemeBody(`F3B preset ${u}`) }),
    "theme create",
  );
  const themeId = created.item.id;
  const put = await apiCtx.put(`${LG_API}/funnels/${funnelId}/theme`, { data: { theme_json: { theme_id: themeId } } });
  expect(put.status(), await put.text()).toBe(200);

  let hash = "sentinel-never-matches";
  const boxes: number[] = [];
  const mins: string[] = [];
  const pads: string[] = [];
  for (const height of ["small", "medium", "large"]) {
    const patch = await apiCtx.patch(`${LG_API}/themes/${themeId}`, {
      data: { controls: { field_height: height, button_size: "m", corners: "rounded" } },
    });
    expect(patch.status(), await patch.text()).toBe(200);
    hash = await republishUntilStyleChanges(seed.quotePublicId, seed.siteId, seed.slug, seed.host, hash, `B ${height}`);
    const m = await measureLive(page, seed.host, seed.slug, `B field_height=${height}`);
    boxes.push(m.fieldBox);
    mins.push(m.fieldMinHeight);
    pads.push(m.fieldPadding);
    await shot(page, `b-field-${height}`);
  }
  note(
    `B SUMMARY painted field boxes small/medium/large = ${JSON.stringify(boxes)} ` +
      `(min-height ${JSON.stringify(mins)}, padding ${JSON.stringify(pads)})`,
  );
  expect(new Set(boxes).size, `three DISTINCT painted field boxes, got ${JSON.stringify(boxes)}`).toBe(3);
  expect(boxes[0]!).toBeLessThan(boxes[1]!);
  expect(boxes[1]!).toBeLessThan(boxes[2]!);
});

// ===========================================================================
// C — the seeded NO-THEME funnel is untouched.
// ===========================================================================
test("C — the seeded no-theme funnel paints the base design (unchanged)", async ({ page }) => {
  const host = "r2fix.e2e.test";
  const slug = "r2fix";
  const res = await apiCtx.get(`http://127.0.0.1:${PORT}/lg/${slug}?_cb=${Date.now()}`, {
    headers: { "user-agent": REAL_CHROME_UA, host },
  });
  expect(res.status(), "the seeded fixture funnel serves").toBe(200);
  const html = await res.text();
  const styles = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join("\n");
  note(`C no-theme chrome <style> bytes=${styles.length} sha256=${createHash("sha256").update(styles).digest("hex")}`);
  const inputRule = firstMatch(styles, /\.lg-input\{[^}]*\}/);
  note(`C no-theme .lg-input rule = ${inputRule}`);
  note(`C no-theme .lg-btn rule = ${firstMatch(styles, /\.lg-btn\{[^}]*\}/)}`);

  await page.goto(shellUrl(host, slug, `?_cb=${Date.now()}`), { waitUntil: "domcontentloaded" });
  await ready(page);
  const painted = await page.locator("#lg-funnel-root").evaluate((root) => {
    const btn = root.querySelector<HTMLElement>(".lg-continue") ?? root.querySelector<HTMLElement>(".lg-btn");
    const card = root.querySelector<HTMLElement>(".lg-question-card");
    return {
      btnMinHeight: btn === null ? "ABSENT" : getComputedStyle(btn).minHeight,
      btnBox: btn === null ? -1 : Math.round(btn.getBoundingClientRect().height),
      cardRadius: card === null ? "ABSENT" : getComputedStyle(card).borderRadius,
    };
  });
  note(`C SUMMARY no-theme button=${painted.btnMinHeight}/${painted.btnBox}px card=${painted.cardRadius}`);
  await shot(page, "c-no-theme");
  // The unthemed base design: primaryButton.minHeight 52px, radius lg 16px card.
  expect(painted.btnMinHeight, "no-theme button min-height is the base 52px").toBe("52px");
  expect(painted.cardRadius, "no-theme question card radius is the base 16px").toBe("16px");
  expect(inputRule, "no-theme .lg-input keeps the base 44px floor").toContain("min-height:44px");
});
