#!/usr/bin/env node
// P8-1 slice S1.4 — the ThemeRecord re-verification PROBE.
//
// MISSION EVIDENCE TOOLING ONLY: not wired into CI, package.json, or
// verify:all (docs/leadgen/r2/P8-DEFECT-CONTRACT.md v3 §1 — "no gates,
// guards, validators, blockers... no clause asks for" beyond the fix
// itself). Run it by hand: `node scripts/p8/verify-themerecord-keys.mjs`
// from the api/ cwd, against the conductor's already-running wrangler dev
// (http://127.0.0.1:8901). This script is a CLIENT of that server — it
// never starts/stops/binds anything.
//
// WHY (contract B2 acceptance, second leg — R2-2 verbatim): "Then
// re-verify the ThemeRecord keys that were unverifiable before, and report
// which were actually alive." R2-2 also states all 25 ThemeRecord content
// keys were UNVERIFIED before this mission (7 `roles` + 4 `typography` + 3
// `controls` + 7 `extra_roles` + 3 `button_style` + 1 `spacing`).
//
// FIX ROUND F3 (adversarial re-review of this sweep's OWN first output,
// docs/leadgen/r2/evidence/p8/b2/themerecord-sweep-conductor.txt): a plain
// ALIVE/DEAD/UNMEASURABLE vocabulary let a real defect hide inside an ALIVE
// row (`roles.card` repaints `.lg-input`, never `.lg-question-card` — the
// element its own name claims) and let zero-consumer keys sit under the
// softer "UNMEASURABLE" instead of the honest "DEAD". Four verdicts now:
//   ALIVE         — the measured value moved on the element the key's own
//                   label/name implies.
//   MIS-TARGETED  — SOME painted value moved, but not the element the
//                   label implies; the label-implied element is measured
//                   too (same page) and shown constant across A/B.
//   DEAD          — either (a) no consumer of the token exists anywhere in
//                   api/src (verified by grep, basis printed in the row),
//                   or (b) the one measured consumer did not move.
//   UNMEASURABLE  — a real consumer exists (source-cited), but no page
//                   this fixture renders reaches it.
//
// METHOD (never stylesheet bytes — evidence-standards E10/E11): for each
// key, PATCH only that key's group to value A, fetch the LIVE visitor page
// in a real chromium, measure the mapped PAINTED property with
// getComputedStyle/element-count on a visible element; PATCH to value B,
// fresh-fetch, measure again. A mis-target candidate ALSO measures the
// label-implied element (same page load) and, where a second real
// consumer exists, that second element on its own page — always a live
// getComputedStyle, never a stylesheet read. Still PATCHed both ways for
// every key (even DEAD/UNMEASURABLE ones) to prove the write path itself,
// since a PATCH round-trip alone cannot distinguish "wrote fine, nothing
// paints it" from "never wrote".
//
// Exit 0 once the sweep completes (verdicts are DATA, not a gate). Exit 1
// only on a harness-level failure (server unreachable / fixture missing /
// browser will not launch).

import { chromium } from "playwright";

const LG_BASE = "http://127.0.0.1:8901";
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_PATH = "/lg/r2fix";
const THEME_ID = "thm_p8-repro";
const THEME_API = `${LG_BASE}/api/admin/leadgen/themes/${THEME_ID}`;

// seed-leadgen-fixture.ts REAL_UA convention — the live /lg/ runtimeRequestGuard
// 403s a headless/empty UA in dev (no request.cf locally, UA heuristics only).
const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let cbCounter = 0;
function freshUrl() {
  cbCounter += 1;
  return `http://${SITE_HOST}:8901${FUNNEL_PATH}?_cb=${Date.now()}-${cbCounter}`;
}

async function patchTheme(group) {
  const res = await fetch(THEME_API, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(group),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH ${THEME_API} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text).item;
}

async function getTheme() {
  const res = await fetch(THEME_API);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${THEME_API} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text).item;
}

// Navigate fresh + walk `clicks` Continue buttons. 0 = shared page (Continue
// button + question-card chrome, always visible). 1 = the address page
// (p8_addr — 4 plain .lg-input text fields, no per-field override). 2 = the
// carrier ButtonAnswerGroup page (r2fix_q_carrier, 3 choices) — the script
// NEVER selects a choice or submits this page's own Continue (that would
// walk into /lg/auction, out of this probe's scope).
async function loadAtDepth(page, clicks) {
  await page.goto(freshUrl(), { waitUntil: "domcontentloaded" });
  await page
    .waitForSelector('#lg-funnel-root[data-lg-ready="1"]', { timeout: 8000 })
    .catch(() => {
      /* engine.ts stamps this post-hydration; the prehydrate queue replays a
         click issued before it appears, so a miss here is not fatal. */
    });
  if (clicks >= 1) {
    await page.click('[data-question-id="r2fix_shared_cont"]');
    await page.waitForSelector("#lg-addr-p8_addr_street", { state: "visible", timeout: 8000 });
  }
  if (clicks >= 2) {
    await page.fill("#lg-addr-p8_addr_street", "123 Main St");
    await page.fill("#lg-addr-p8_addr_city", "Springfield");
    await page.fill("#lg-addr-p8_addr_state", "IL");
    await page.fill("#lg-addr-p8_addr_zip", "62704");
    await page.click('[data-question-id="p8_addr_cont"]');
    await page.waitForSelector(".lg-headline", { state: "visible", timeout: 8000 });
  }
  // styles.ts:1805-1812 (.lg-input rule, doc comment verbatim): the
  // var(--lg-field-border, color.border) fallback this script measures is
  // RESTING-STATE ONLY — `.lg-input:focus{border-color:#1B3A5C}` is a higher-
  // specificity rule (pseudo-class beats a bare class) that wins whenever a
  // field is focused. The engine autofocuses the first field of a freshly-
  // revealed section, so an un-blurred measurement right after the depth-1
  // transition reads the FOCUS color, not the role-driven fallback — a script
  // artifact, not a product signal. Blur unconditionally before every
  // measurement (harmless for every other measured property here).
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === "function") el.blur();
  });
}

// Locator-based (never a raw stylesheet read): .first() so a selector that
// matches more than one node (e.g. hidden sibling sections still in the DOM)
// deterministically measures the leading — on this fixture, always the
// currently-relevant — match.
async function computedProp(page, selector, prop) {
  return page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
}

async function countMatches(page, selector) {
  return page.locator(selector).count();
}

// MIS-TARGETED audit support: proves a "constant" measurement is honest
// (the label-implied element is really THERE, rendered with real pixels)
// rather than the number never moving because the element doesn't exist.
async function elementBox(page, selector) {
  return page.locator(selector).first().evaluate((el) => ({
    visible: el.offsetWidth > 0 && el.offsetHeight > 0,
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
  }));
}

// ---------------------------------------------------------------------------
// The 25-key table (7 roles + 7 extra_roles + 4 typography + 3 controls + 3
// button_style + 1 spacing — theme.ts's own ThemeRecord shape, source truth
// read at ~theme.ts:944-960). Each entry either names a real painted
// consumer (measure != null) or states, from the source, exactly why none
// exists on this fixture's rendered pages (measure == null, `reason`).
// ---------------------------------------------------------------------------

const KEYS = [
  // --- roles (THEME_RECORD_ROLE_KEYS, bridged onto FUNNEL_TOKEN_ROLES) -----
  {
    key: "roles.brand_primary",
    patch: (v) => ({ roles: { brand_primary: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 0,
    measure: (page) => computedProp(page, ".lg-progress-fill", "backgroundColor"),
    target: ".lg-progress-fill background-color (frame progress, lg-frame-progress--role-brand_primary !important rule, styles.ts:2514)",
  },
  {
    key: "roles.accent",
    patch: (v) => ({ roles: { accent: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 0,
    measure: null,
    reason:
      "design.color.accent's only consumer is nodeBorderColorValue('accent') (presets.ts) — a PER-NODE design_overrides.border_color enum this fixture's fields never set; the emitted --lg-accent custom property is never read by any rule in default-funnel/styles.ts.",
  },
  {
    key: "roles.page_bg",
    patch: (v) => ({ roles: { page_bg: v } }),
    valueA: "#f0f0f5",
    valueB: "#101018",
    clicks: 0,
    measure: (page) => computedProp(page, "#lg-funnel-root", "backgroundColor"),
    target: "#lg-funnel-root background-color (scope-root rule, styles.ts:487)",
  },
  {
    key: "roles.card",
    patch: (v) => ({ roles: { card: v } }),
    valueA: "#fafaff",
    valueB: "#1a1a22",
    // MIS-TARGETED (fix-round F3, M-1 — was wrongly certified ALIVE): the
    // key's own operator-facing name is "card" — the natural read is
    // .lg-question-card, the funnel's one visible card wrapper. It is NOT:
    // .lg-question-card's background is questionCard.background, a
    // SEPARATE non-role-wired token (styles.ts:570) that never reads
    // color.card. color.card's real consumers are .lg-input's own
    // background (styles.ts:1825, address page) AND `.lg-btn.lg-btn-answer`
    // background via var(--lg-answer-bg, color.card) when no per-choice
    // color is authored (styles.ts:1380-1392, carrier page) — confirmed by
    // source read, not asserted. All three elements are measured below;
    // the label-implied element (.lg-question-card) is proven CONSTANT
    // while the two real consumers move.
    clicks: 1,
    measure: (page) => computedProp(page, "#lg-addr-p8_addr_street", "backgroundColor"),
    target: "#lg-addr-p8_addr_street background-color (address page .lg-input, styles.ts:1825)",
    impliedTarget:
      ".lg-question-card background-color (LABEL 'card' implies THIS element — styles.ts:570 questionCard.background, a SEPARATE non-role-wired token; never reads color.card)",
    impliedMeasure: (page) => computedProp(page, ".lg-question-card", "backgroundColor"),
    secondaryActual: {
      clicks: 2,
      measure: (page) => computedProp(page, ".lg-btn-answer", "backgroundColor"),
      target:
        ".lg-btn-answer background-color (carrier page, first choice; styles.ts:1380-1392 var(--lg-answer-bg, color.card) fallback — SECOND real consumer of this same role, confirmed live not just cited)",
    },
    visibilityProbe: async (page) => ({
      input: await elementBox(page, "#lg-addr-p8_addr_street"),
      card: await elementBox(page, ".lg-question-card"),
    }),
  },
  {
    key: "roles.text",
    patch: (v) => ({ roles: { text: v } }),
    valueA: "#111111",
    valueB: "#eeeeee",
    clicks: 0,
    measure: (page) => computedProp(page, "#lg-funnel-root", "color"),
    target: "#lg-funnel-root color (scope-root rule, styles.ts:488)",
  },
  {
    key: "roles.success",
    patch: (v) => ({ roles: { success: v } }),
    valueA: "#00ff00",
    valueB: "#003300",
    clicks: 0,
    measure: null,
    deadReason:
      'grep -rn -- "var(--lg-success)" src/ -> 0 matches; grep -rn "color\\.success\\b" src/ (whole tree) -> exactly 2 hits, both definitions not consumers: theme.ts:93 (role-name map "success":"color.success") and default-funnel/styles.ts:497 ("--lg-success": color.success, the custom-property DEFINITION). No CSS rule, no JS branch, anywhere in api/src reads color.success or var(--lg-success). reassuranceBadge.iconColor/successState.iconColor are separate fixed tokens, not role-wired.',
  },
  {
    key: "roles.error",
    patch: (v) => ({ roles: { error: v } }),
    valueA: "#ff0000",
    valueB: "#330000",
    clicks: 0,
    measure: null,
    // NOT reclassified to DEAD (fix-round F3 dispatch asked for this
    // reclassification; independent re-verification contradicts it — see
    // the F3 report). color.error DOES have a real consumer beyond the
    // unconsumed --lg-error var: default-funnel/styles.ts:279
    // `.lg-tscard[data-error="true"] { border-color: color.error }`, and
    // "card" IS a real, currently-selectable ThemeRecordButtonStyle.layout
    // value (THEME_BUTTON_LAYOUTS = ["grid","list","card"], theme.ts:437).
    // Gated behind button_style.layout="card" (untested by this fixture,
    // which only exercises grid/list) AND a live client-validation error
    // DOM state — same "real consumer, unreached by this fixture" shape as
    // roles.accent, which the fix round correctly keeps UNMEASURABLE.
    reason:
      'design.color.error only reaches --lg-error (unconsumed) plus .lg-tscard[data-error="true"] (default-funnel/styles.ts:279), which needs button_style.layout="card" (theme.ts:437 THEME_BUTTON_LAYOUTS, a real selectable value of a different key, tested separately) AND a live client-validation error DOM state — neither is present on this fixture\'s default render; validation.errorTextColor (the inline per-field error paragraph color actually seen in the served HTML) is a separate, non-role-wired token.',
  },

  // --- typography (ThemeRecordTypography) -----------------------------------
  {
    key: "typography.headline_font",
    patch: (v) => ({ typography: { headline_font: v } }),
    valueA: "Newsreader",
    valueB: "Roboto Mono",
    clicks: 2,
    measure: (page) => computedProp(page, ".lg-headline", "fontFamily"),
    target: ".lg-headline font-family (carrier page headline; applyDisplayFont -> design.headline.fontFamily, styles.ts headline rule)",
  },
  {
    key: "typography.body_font",
    patch: (v) => ({ typography: { body_font: v } }),
    valueA: "Fraunces",
    valueB: "Work Sans",
    clicks: 0,
    measure: (page) => computedProp(page, "#lg-funnel-root", "fontFamily"),
    target: "#lg-funnel-root font-family (applyBodyFont -> design.page.fontFamily, styles.ts:489)",
  },
  {
    key: "typography.base_px",
    patch: (v) => ({ typography: { base_px: v } }),
    valueA: 10,
    valueB: 24,
    clicks: 0,
    measure: (page) => computedProp(page, ".lg-continue", "fontSize"),
    target: ".lg-continue font-size (Continue button, scaleFontSizes(basePxFactor) touches primaryButton.fontSize, styles.ts:1236)",
  },
  {
    key: "typography.display_size",
    patch: (v) => ({ typography: { display_size: v } }),
    valueA: "m",
    valueB: "xxl",
    clicks: 2,
    measure: (page) => computedProp(page, ".lg-headline", "fontSize"),
    target: ".lg-headline font-size (carrier page headline; scaleDisplayFontSizes -> headline.fontSizeDesktop, theme.ts DISPLAY_FONTSIZE_PATHS)",
  },

  // --- controls (ThemeRecordControls) ---------------------------------------
  {
    key: "controls.field_height",
    patch: (v) => ({ controls: { field_height: v } }),
    valueA: "small",
    valueB: "large",
    clicks: 1,
    measure: (page) => computedProp(page, "#lg-addr-p8_addr_street", "minHeight"),
    target: "#lg-addr-p8_addr_street min-height (address page .lg-input, applyFieldHeightStep -> design.input.minHeight, styles.ts:1824)",
  },
  {
    key: "controls.button_size",
    patch: (v) => ({ controls: { button_size: v } }),
    valueA: "s",
    valueB: "l",
    clicks: 0,
    measure: (page) => computedProp(page, ".lg-continue", "minHeight"),
    target: ".lg-continue min-height (applyButtonSizeStep -> design.primaryButton.minHeight, styles.ts:1231)",
  },
  {
    key: "controls.corners",
    patch: (v) => ({ controls: { corners: v } }),
    valueA: "sharp",
    valueB: "pill",
    clicks: 0,
    measure: (page) => computedProp(page, ".lg-question-card", "borderRadius"),
    target: ".lg-question-card border-radius (applyRadiusScale -> design.questionCard.borderRadius, styles.ts:572)",
  },

  // --- extra_roles (P6 THEME v2 — the 7 completing-the-14-role keys) --------
  {
    key: "extra_roles.brand_secondary",
    patch: (v) => ({ extra_roles: { brand_secondary: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 0,
    measure: null,
    reason:
      "the only consumer is .lg-frame-background.lg-frame-bg-style-brand_gradient (styles.ts:2440); this fixture's frame background style class is lg-frame-bg-style-flat (confirmed in the served HTML), so the gradient rule never matches an element on this fixture.",
  },
  {
    key: "extra_roles.surface_wash",
    patch: (v) => ({ extra_roles: { surface_wash: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 0,
    measure: null,
    reason:
      "the only consumer of color.primaryWash outside the unconsumed --lg-primary-wash var is .lg-range-radial:focus-within (styles.ts:1211), a RangeQuestion component; this fixture has no RangeQuestion section.",
  },
  {
    key: "extra_roles.border",
    patch: (v) => ({ extra_roles: { border: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 1,
    measure: (page) => computedProp(page, "#lg-addr-p8_addr_street", "borderTopColor"),
    target: "#lg-addr-p8_addr_street border-top-color (address page .lg-input, unoverridden fallback var(--lg-field-border, color.border), styles.ts:1810-1813)",
  },
  {
    key: "extra_roles.text_muted",
    patch: (v) => ({ extra_roles: { text_muted: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 1,
    measure: (page) => computedProp(page, ".lg-address-field-label", "color"),
    target: ".lg-address-field-label color (address page field labels, styles.ts:1788-1792, page.textSecondaryColor)",
  },
  {
    key: "extra_roles.button_primary_bg",
    patch: (v) => ({ extra_roles: { button_primary_bg: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 0,
    measure: (page) => computedProp(page, ".lg-continue", "backgroundColor"),
    target: ".lg-continue background-color (shared-page Continue button; no section palette re-point -> falls back to design.primaryButton.background, styles.ts:1228/1273)",
  },
  {
    key: "extra_roles.button_primary_text",
    patch: (v) => ({ extra_roles: { button_primary_text: v } }),
    valueA: "#123456",
    valueB: "#eeeeee",
    clicks: 0,
    measure: (page) => computedProp(page, ".lg-continue", "color"),
    target: ".lg-continue color (shared-page Continue button; falls back to design.primaryButton.color, styles.ts:1229)",
  },
  {
    key: "extra_roles.button_secondary_bg",
    patch: (v) => ({ extra_roles: { button_secondary_bg: v } }),
    valueA: "#123456",
    valueB: "#ee7733",
    clicks: 0,
    measure: null,
    reason:
      "color.primaryGhost's only other consumers are .lg-frame-benefit (styles.ts:2570, a frame benefit-bar region this fixture's frame does not configure) and .lg-frame-logo-hint (styles.ts:3218, explicitly commented 'never emitted live' — admin-preview only).",
  },

  // --- button_style (P6 THEME v2 — fill/layout/selected) --------------------
  {
    key: "button_style.fill",
    patch: (v) => ({ button_style: { fill: v } }),
    valueA: "outline",
    valueB: "soft",
    clicks: 2,
    measure: (page) => computedProp(page, ".lg-btn-answer", "borderRadius"),
    target: ".lg-btn-answer border-radius (carrier page, first choice; bs.fill===\"soft\" sets radius.full, styles.ts:170-173)",
  },
  {
    key: "button_style.layout",
    patch: (v) => ({ button_style: { layout: v } }),
    valueA: "grid",
    valueB: "list",
    clicks: 2,
    measure: (page) => computedProp(page, ".lg-answer-group", "gridTemplateColumns"),
    target: ".lg-answer-group grid-template-columns (carrier page; bs.layout===\"list\" forces 1fr, styles.ts:187)",
  },
  {
    key: "button_style.selected",
    patch: (v) => ({ button_style: { selected: v } }),
    valueA: "wash",
    valueB: "mark",
    clicks: 2,
    measure: (page) => countMatches(page, ".lg-answer-group .lg-check-hollow"),
    target: "count(.lg-answer-group .lg-check-hollow) (carrier page; bs.selected===\"mark\" unconditionally renders a hollow+badge span pair per choice, presets.ts selectedMarkerMarkup)",
  },

  // --- spacing (top-level, reserved) -----------------------------------------
  {
    key: "spacing",
    patch: (v) => ({ spacing: v }),
    valueA: "cozy",
    valueB: "roomy",
    clicks: 0,
    measure: null,
    deadReason:
      'theme.ts:925-928 doc comment (ThemeRecordSpacing), verbatim: "Round-tripped only; never rendered without a design addendum (§0 fidelity-vs-function rule) — no Phase-A code interprets it." grep -rn "\\.spacing\\b" src/ (whole tree) finds only: themes-handlers.ts:299/322 (write-time PATCH merge, round-trip only, matches the doc), quotes-tabs/themes.ts:198 (a DIFFERENT field, inline theme_json\'s scales.spacing), and presets.ts/ui-section-studio.ts design.spacing.{md,sm} (internal per-key design tokens, unrelated to this top-level reserved field). Zero render-time consumers of ThemeRecord.spacing anywhere.',
  },
];

// ---------------------------------------------------------------------------

async function withRetry(fn, label, notes) {
  try {
    return await fn();
  } catch (e1) {
    notes.push(`${label}: first attempt failed (${(e1 && e1.message) || e1}) — retrying once`);
    try {
      return await fn();
    } catch (e2) {
      notes.push(`${label}: retry also failed (${(e2 && e2.message) || e2})`);
      throw e2;
    }
  }
}

async function runKey(browser, entry) {
  const notes = [];
  let measuredA = "n/a";
  let measuredB = "n/a";
  let impliedA = "n/a";
  let impliedB = "n/a";
  let secondaryA = "n/a";
  let secondaryB = "n/a";
  let visSnapshot = null;
  let verdict;
  let context;
  try {
    context = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    await withRetry(() => patchTheme(entry.patch(entry.valueA)), `${entry.key} PATCH A`, notes);
    if (entry.measure) {
      const a = await withRetry(
        async () => {
          await loadAtDepth(page, entry.clicks);
          const primary = await entry.measure(page);
          const implied = entry.impliedMeasure ? await entry.impliedMeasure(page) : undefined;
          const vis = entry.visibilityProbe ? await entry.visibilityProbe(page) : undefined;
          return { primary, implied, vis };
        },
        `${entry.key} measure A`,
        notes,
      );
      measuredA = a.primary;
      if (entry.impliedMeasure) impliedA = a.implied;
      if (entry.visibilityProbe) visSnapshot = a.vis; // dims don't depend on the A/B color value — one snapshot suffices.
      if (entry.secondaryActual) {
        // Best-effort ONLY: this is bonus corroboration (a second real
        // consumer of the same token), never load-bearing for the verdict
        // (which is fully decided by primary vs. implied above). A failure
        // here must NOT abort the primary/implied measurement already in
        // hand — isolated try/catch, no re-throw. Uses its OWN fresh
        // context/page (not the primary's `page`): the primary probe just
        // walked to depth `entry.clicks` on `page`, and re-navigating the
        // SAME page to a DIFFERENT (deeper) depth immediately after left
        // the shared-page Continue button present-but-not-visible (observed
        // empirically) — a fresh context sidesteps whatever carried-over
        // state (this fixture's funnel persists progress client-side)
        // caused that, without touching product source to diagnose it.
        try {
          secondaryA = await withRetry(
            async () => {
              const sCtx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
              try {
                const sPage = await sCtx.newPage();
                await loadAtDepth(sPage, entry.secondaryActual.clicks);
                return await entry.secondaryActual.measure(sPage);
              } finally {
                await sCtx.close().catch(() => {});
              }
            },
            `${entry.key} secondary measure A`,
            notes,
          );
        } catch (e2) {
          secondaryA = "n/a (probe failed, non-fatal)";
          notes.push(`${entry.key} secondary measure A: giving up (non-fatal, bonus corroboration only): ${(e2 && e2.message) || e2}`);
        }
      }
    }

    await withRetry(() => patchTheme(entry.patch(entry.valueB)), `${entry.key} PATCH B`, notes);
    if (entry.measure) {
      const b = await withRetry(
        async () => {
          await loadAtDepth(page, entry.clicks);
          const primary = await entry.measure(page);
          const implied = entry.impliedMeasure ? await entry.impliedMeasure(page) : undefined;
          return { primary, implied };
        },
        `${entry.key} measure B`,
        notes,
      );
      measuredB = b.primary;
      if (entry.impliedMeasure) impliedB = b.implied;
      if (entry.secondaryActual) {
        // Same best-effort, non-fatal discipline + fresh-context isolation
        // as the A-value probe above.
        try {
          secondaryB = await withRetry(
            async () => {
              const sCtx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
              try {
                const sPage = await sCtx.newPage();
                await loadAtDepth(sPage, entry.secondaryActual.clicks);
                return await entry.secondaryActual.measure(sPage);
              } finally {
                await sCtx.close().catch(() => {});
              }
            },
            `${entry.key} secondary measure B`,
            notes,
          );
        } catch (e2) {
          secondaryB = "n/a (probe failed, non-fatal)";
          notes.push(`${entry.key} secondary measure B: giving up (non-fatal, bonus corroboration only): ${(e2 && e2.message) || e2}`);
        }
      }
    }

    if (!entry.measure) {
      // No reachable measurement on this fixture: DEAD only when a grep
      // basis PROVES zero consumers anywhere; otherwise UNMEASURABLE (a
      // real consumer exists, source-cited, just unreached here).
      verdict = entry.deadReason ? "DEAD" : "UNMEASURABLE";
    } else if (String(measuredA) === String(measuredB)) {
      verdict = "DEAD";
    } else if (entry.impliedMeasure && String(impliedA) === String(impliedB)) {
      // Something painted DID move (measuredA !== measuredB), but the
      // element the key's own label implies stayed constant.
      verdict = "MIS-TARGETED";
    } else {
      verdict = "ALIVE";
    }
  } catch (e) {
    verdict = entry.deadReason ? "DEAD" : "UNMEASURABLE";
    notes.push(`harness error: ${(e && e.message) || e}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }
  return { entry, measuredA, measuredB, impliedA, impliedB, secondaryA, secondaryB, visSnapshot, verdict, notes };
}

function mdEscape(v) {
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function main() {
  // --- harness setup (failures here are the ONLY exit-1 case) --------------
  let original;
  try {
    original = await getTheme();
  } catch (e) {
    console.error(`FATAL: cannot reach ${THEME_API} — is the conductor's wrangler dev up on :8901?`);
    console.error(String((e && e.message) || e));
    process.exit(1);
  }
  if (!original || !original.roles || !original.typography || !original.controls) {
    console.error(`FATAL: ${THEME_ID} did not return a shape with roles/typography/controls — fixture missing?`);
    console.error(JSON.stringify(original));
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`],
    });
  } catch (e) {
    console.error("FATAL: chromium failed to launch");
    console.error(String((e && e.message) || e));
    process.exit(1);
  }

  // --- the sweep (never exits non-zero past this point) ---------------------
  const results = [];
  try {
    for (const entry of KEYS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runKey(browser, entry);
      results.push(r);
    }
  } finally {
    // Best-effort restore of the 3 groups that existed before this sweep ran
    // (roles/typography/controls — confirmed present on thm_p8-repro pre-
    // sweep). This PATCH endpoint has no per-field delete (mergeThemeBody can
    // only overwrite a key, never remove it — deleteThemeHandler's own doc
    // comment: themes have no archive/delete-field lifecycle), so any OPTIONAL
    // field that did NOT exist on the original record before this sweep ran
    // (extra_roles, button_style, spacing — all absent pre-sweep — PLUS
    // typography.display_size specifically, an optional sub-field inside a
    // group this restore otherwise fully repairs) cannot be unset back to
    // "absent" here; each is left at whichever value this sweep's last test
    // for that field used. Real residual state on the shared fixture —
    // reported to the conductor, not silently dropped.
    try {
      await patchTheme({
        name: original.name,
        roles: original.roles,
        typography: original.typography,
        controls: original.controls,
      });
    } catch (e) {
      console.error(`WARNING: restore PATCH failed: ${(e && e.message) || e}`);
    }
    await browser.close().catch(() => {});
  }

  // --- report -----------------------------------------------------------
  const lines = [];
  lines.push("| key | values flipped | element/property | measured A | measured B | verdict |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of results) {
    const flipped = `${JSON.stringify(r.entry.valueA)} -> ${JSON.stringify(r.entry.valueB)}`;
    let target;
    if (!r.entry.measure) {
      const basis = r.entry.deadReason ? `DEAD — zero consumers anywhere in api/src. ${r.entry.deadReason}` : r.entry.reason;
      target = `${r.entry.target ?? "(no consumer)"} — ${basis}`;
    } else if (r.entry.impliedMeasure) {
      const impliedConstant = String(r.impliedA) === String(r.impliedB);
      const parts = [
        `ACTUAL: ${r.entry.target}`,
        `LABEL IMPLIES: ${r.entry.impliedTarget} — measured A=${r.impliedA} B=${r.impliedB} (constant=${impliedConstant})`,
      ];
      if (r.entry.secondaryActual) {
        parts.push(`SECOND CONSUMER: ${r.entry.secondaryActual.target} — measured A=${r.secondaryA} B=${r.secondaryB}`);
      }
      if (r.visSnapshot) parts.push(`visibility: ${JSON.stringify(r.visSnapshot)}`);
      target = parts.join(" || ");
    } else {
      target = r.entry.target;
    }
    lines.push(
      `| ${mdEscape(r.entry.key)} | ${mdEscape(flipped)} | ${mdEscape(target)} | ${mdEscape(r.measuredA)} | ${mdEscape(r.measuredB)} | ${mdEscape(r.verdict)} |`,
    );
  }

  const totals = { ALIVE: 0, DEAD: 0, "MIS-TARGETED": 0, UNMEASURABLE: 0 };
  for (const r of results) totals[r.verdict] = (totals[r.verdict] ?? 0) + 1;
  lines.push("");
  lines.push(
    `TOTALS: ${results.length} keys swept — ALIVE ${totals.ALIVE}, DEAD ${totals.DEAD}, MIS-TARGETED ${totals["MIS-TARGETED"]}, UNMEASURABLE ${totals.UNMEASURABLE}.`,
  );

  const allNotes = results.flatMap((r) => r.notes.map((n) => `${r.entry.key}: ${n}`));
  if (allNotes.length > 0) {
    lines.push("");
    lines.push("Harness notes (retries / flakes):");
    for (const n of allNotes) lines.push(`  - ${n}`);
  }

  console.log(lines.join("\n"));
  process.exit(0);
}

main();
