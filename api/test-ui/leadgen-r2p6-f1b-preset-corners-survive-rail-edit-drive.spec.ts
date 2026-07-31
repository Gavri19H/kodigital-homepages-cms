// LeadGen R2 · P6 terminal — F-1 FOLLOW-UP DRIVE: does a PRESET's Corners
// choice SURVIVE the operator's next rail edit?
//
// THE SILENT-LOSS PATH (the class the owner rejected repeatedly — a change that
// quietly discards work the operator did):
//   1. Operator builds a theme preset, picks Pill, applies it to the funnel.
//      theme_json is now a {theme_id} REFERENCE and — since F-1 (e6bfc98) — the
//      record's controls.corners paints: 20/14/14.
//   2. Operator then edits ANY unrelated control in the quote editor's Themes
//      rail (here: a COLOUR, through the real role-swatch strip).
//   3. themes.ts flushThemeEdits sees a theme_id and RESOLVES the preset into
//      inline values (theme-preset-resolve.ts inlineThemeFromPreset) before
//      merging the edit — because inline and preset are MUTUALLY EXCLUSIVE by
//      construction (resolveTokens: isThemeIdRef empties `theme`; the record
//      only loads for a pure {theme_id}).
//   4. inlineThemeFromPreset carried palette / button_defaults / typography but
//      NOT corners, so the record dropped out of resolution and the corners
//      reverted to the "soft" identity: 16/10/10. The operator changed a colour
//      and silently lost their pill corners.
//
// This spec measures the PAINTED border-radius on the live /lg page (never the
// emitted custom properties alone, never source), before AND after the colour
// edit, on ONE funnel:
//   A · Pill preset  -> colour edit -> corners must still be Pill (20/14/14),
//                       and the colour edit must have landed.
//   B · Sharp preset -> colour edit -> corners must still be Sharp (10/6/6).
//
// Run (worktree-isolated, this worktree's port):
//   cd api && PW_PORT=8901 F1B_ARM=before npx playwright test \
//     test-ui/leadgen-r2p6-f1b-preset-corners-survive-rail-edit-drive.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import {
  LG_API,
  ORIGIN,
  REAL_CHROME_UA,
  json,
  ready,
  seedRoutingQuote,
  shellUrl,
  uniqueTag,
} from "./leadgen-rework-acceptance-helpers";

const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p6/f1-followup";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const MEASUREMENTS = `${EVIDENCE_DIR}/measurements.txt`;
const ARM = process.env["F1B_ARM"] ?? "unset";

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

// E6: the same state at 1280 AND 375, with the 375 overflow measured.
async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-1280.png`, fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-375.png`, fullPage: false });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  note(`${name} @375 scrollWidth=${m.sw} innerWidth=${m.iw} overflow=${m.sw > m.iw ? "YES" : "no"}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}

interface Painted {
  card: string;
  answer: string;
  continue_: string;
  brandPrimary: string;
  progressTrack: string;
  vars: Record<string, string>;
}

// The three corners an operator looks at, plus `--lg-primary` — the CSS custom
// property default-funnel/styles.ts emits on the funnel-root scope straight
// from `color.primary`, which is exactly what §9.1 ROLE_TO_BASE_TOKEN maps
// brand_primary onto. Reading it off the LIVE page proves the colour edit
// reached paint (not just the stored row) — and the progress pill (the 9999px
// carve-out that must never move) is measured alongside.
async function measureLive(page: Page, host: string, slug: string, label: string): Promise<Painted> {
  await page.goto(shellUrl(host, slug, `?_cb=${Date.now()}${Math.floor(Math.random() * 1000)}`), {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  const data = await page.locator("#lg-funnel-root").evaluate((root) => {
    const r = (sel: string): string => {
      const el = root.querySelector<HTMLElement>(sel);
      return el === null ? "ABSENT" : getComputedStyle(el).borderRadius;
    };
    const cs = getComputedStyle(root);
    const vars: Record<string, string> = {};
    ["sm", "md", "lg", "xl", "full"].forEach((k) => {
      vars[k] = cs.getPropertyValue("--lg-radius-" + k).trim();
    });
    return {
      card: r(".lg-question-card"),
      answer: r(".lg-btn-answer"),
      continue_: r(".lg-continue"),
      brandPrimary: cs.getPropertyValue("--lg-primary").trim(),
      progressTrack: r(".lg-progress-track"),
      vars,
    };
  });
  note(
    `${label} PAINTED card=${data.card} answer=${data.answer} continue=${data.continue_} ` +
      `--lg-primary=${data.brandPrimary} progressTrack=${data.progressTrack} vars=${JSON.stringify(data.vars)}`,
  );
  return data;
}

// One preset -> one colour edit -> measured twice. Parameterised so the same
// journey runs for Pill (the operator's headline case) and Sharp.
async function driveOne(
  page: Page,
  label: string,
  corners: string,
  expected: { card: string; answer: string; continue_: string },
): Promise<void> {
  const u = uniqueTag(`f1b${corners}`);
  const seed = await seedRoutingQuote(apiCtx, {
    tag: `p6f1b${corners}`,
    sharedHeadline: `F1b ${corners} ${u}`,
    sharedQuestionField: `f1b_${corners}_s`,
    funnels: [{ headline: `F1b ${corners} tail ${u}`, field: `f1b_${corners}_t` }],
  });
  const funnelId = seed.funnels[0]!.public_id;
  const variantId = seed.funnels[0]!.variant_public_id;

  // --- (1) build the preset through the REAL Themes manager ------------------
  await page.goto(`${ORIGIN}/admin/leadgen/themes?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.locator("#tm-new-theme").click();
  await page.waitForURL(/\/admin\/leadgen\/themes\?theme=/, { timeout: 20_000 });
  const themeId = new URL(page.url()).searchParams.get("theme") ?? "";
  note(`${label} preset created id=${themeId}`);
  expect(themeId, "the Themes manager minted a preset id").not.toBe("");

  const seg = page.locator(`[data-tm-seg][data-group="corners"][data-value="${corners}"]`).first();
  await expect(seg, `the Corners "${corners}" segment is on the manager`).toBeVisible({ timeout: 15_000 });
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/admin/leadgen/themes/${themeId}`) && r.request().method() === "PATCH",
  );
  await seg.click();
  const patchStatus = (await patched).status();
  await page.waitForTimeout(600);
  const readBack = await json<{ item: { controls: { corners: string } } }>(
    await apiCtx.get(`${LG_API}/themes/${themeId}`),
    "theme read-back",
  );
  note(`${label} PATCH corners=${corners} HTTP ${patchStatus} stored=${JSON.stringify(readBack.item.controls)}`);
  expect(patchStatus).toBe(200);
  expect(readBack.item.controls.corners).toBe(corners);
  await page.waitForTimeout(1200);

  // --- (2) apply it through the REAL "Apply to this funnel" button -----------
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${seed.quotePublicId}/edit?variant=${variantId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-tab="themes"]').click();
  const sel = page.locator("#lg-theme-preset-select");
  await expect(sel).toBeVisible({ timeout: 15_000 });
  await expect(sel.locator(`option[value="${themeId}"]`)).toHaveCount(1, { timeout: 15_000 });
  await sel.selectOption(themeId);
  const applied = page.waitForResponse(
    (r) => r.url().includes(`/funnels/${funnelId}/theme`) && r.request().method() === "PUT",
  );
  await page.locator("#lg-theme-preset-apply").click();
  expect((await applied).status(), "apply-to-funnel succeeds").toBe(200);
  await page.waitForTimeout(1500);

  const storedRef = await json<{ theme: unknown }>(
    await apiCtx.get(`${LG_API}/funnels/${funnelId}/theme`),
    "stored theme (ref)",
  );
  note(`${label} stored theme_json BEFORE colour edit = ${JSON.stringify(storedRef.theme)}`);
  expect(JSON.stringify(storedRef.theme), "the funnel stores a {theme_id} REFERENCE").toContain(themeId);

  // The activation re-PUT mints a FRESH shell key — the documented workaround
  // for the ADJACENT (pre-existing, NOT this slice) caches.default mirror that
  // invalidateOnVariantPublish never deletes. Without it a stale mirror can
  // serve the pre-edit shell for up to HTML_CACHE_TTL_SECONDS.
  const bumpActivation = async (): Promise<void> => {
    const res = await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${seed.siteId}`, {
      data: { enabled: true, slug: seed.slug },
    });
    note(`${label} activation re-PUT (fresh shell key) HTTP ${res.status()}`);
    expect(res.status()).toBe(200);
    await page.waitForTimeout(1200);
  };

  // --- (3) BEFORE the colour edit: the preset's corners paint (F-1) ----------
  await bumpActivation();
  const before = await measureLive(page, seed.host, seed.slug, `${label} 1-PRESET-APPLIED corners=${corners}`);
  await shot(page, `${corners}-1-preset-applied`);
  expect(before.card, `${label} preset ${corners} card (F-1)`).toBe(expected.card);
  expect(before.answer, `${label} preset ${corners} answer (F-1)`).toBe(expected.answer);
  expect(before.continue_, `${label} preset ${corners} continue (F-1)`).toBe(expected.continue_);

  // --- (4) the operator edits ONE UNRELATED rail control: a COLOUR -----------
  // Driven through the REAL affordance: the Colors row's "Edit" disclosure ->
  // the role-swatch strip. funnel.ts's ONE palette write path announces
  // lg:palette-draft-change; themes.ts consumes it through queueThemeEdit ->
  // flushThemeEdits, which is the fork this defect lives at.
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${seed.quotePublicId}/edit?variant=${variantId}&_cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-tab="themes"]').click();
  await expect(page.locator("#lg-theme-editor")).toBeVisible({ timeout: 15_000 });
  const row = page.locator('#lg-theme-palette [data-theme-role="brand_primary"]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator("summary").click();
  // `error` (#B23A2C red) is deliberately far from brand_primary's base
  // (#1B3A5C navy) so the painted change is unmistakable at a glance.
  const swatch = row.locator('[data-role-pick="error"][data-role-pick-for="palette.brand_primary"]').first();
  await expect(swatch, "the role-swatch strip is open").toBeVisible({ timeout: 15_000 });
  const themePut = page.waitForResponse(
    (r) => r.url().includes(`/funnels/${funnelId}/theme`) && r.request().method() === "PUT",
    { timeout: 25_000 },
  );
  await swatch.click();
  const putStatus = (await themePut).status();
  note(`${label} colour-edit PUT HTTP ${putStatus}`);
  expect(putStatus, "the rail colour edit is accepted").toBe(200);
  await page.waitForTimeout(1500);

  const storedInline = await json<{ theme: Record<string, unknown> }>(
    await apiCtx.get(`${LG_API}/funnels/${funnelId}/theme`),
    "stored theme (inline)",
  );
  note(`${label} stored theme_json AFTER colour edit = ${JSON.stringify(storedInline.theme)}`);
  // The fork actually happened: theme_json is now INLINE, the record has
  // dropped out of resolution. (If this ever stops being true the defect's
  // mechanism changed and this spec must be re-derived, not relaxed.)
  expect(storedInline.theme["theme_id"], "the rail edit forked theme_json to INLINE").toBeUndefined();
  expect(storedInline.theme["palette"], "the colour edit landed in the stored theme").toBeTruthy();

  // --- (5) AFTER the colour edit: the corners must still be the operator's ---
  await bumpActivation();
  const after = await measureLive(page, seed.host, seed.slug, `${label} 2-AFTER-COLOUR-EDIT corners=${corners}`);
  await shot(page, `${corners}-2-after-colour-edit`);
  note(
    `${label} SUMMARY ${corners}: before=${before.card}/${before.answer}/${before.continue_} ` +
      `after=${after.card}/${after.answer}/${after.continue_} ` +
      `--lg-primary before=${before.brandPrimary} after=${after.brandPrimary}`,
  );

  // The colour edit PAINTED (proof the journey really changed the funnel) ...
  expect(after.brandPrimary, "the colour edit moved --lg-primary on the live page").not.toBe(before.brandPrimary);
  // ... and the operator did NOT lose their corners.
  expect(after.card, `${label} ${corners} card SURVIVES the colour edit`).toBe(expected.card);
  expect(after.answer, `${label} ${corners} answer SURVIVES the colour edit`).toBe(expected.answer);
  expect(after.continue_, `${label} ${corners} continue SURVIVES the colour edit`).toBe(expected.continue_);
  expect(after.vars["full"], "--lg-radius-full stays 9999px").toBe("9999px");
  expect(after.progressTrack, "the progress pill stays 9999px").toBe("9999px");
}

test("A — a Pill preset's corners survive an unrelated rail COLOUR edit", async ({ page }) => {
  await driveOne(page, "A", "pill", { card: "20px", answer: "14px", continue_: "14px" });
});

test("B — a Sharp preset's corners survive an unrelated rail COLOUR edit", async ({ page }) => {
  await driveOne(page, "B", "sharp", { card: "10px", answer: "6px", continue_: "6px" });
});
