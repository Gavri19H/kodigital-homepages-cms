#!/usr/bin/env node
// P8-3 slice S3.4 — the 34-KEY INLINE theme_json SWEEP PROBE.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI, package.json or
// verify:all (docs/leadgen/r2/P8-DEFECT-CONTRACT.md §1 — no gates/validators/
// blockers no clause asks for). Run by hand: `node scripts/p8/verify-inline-theme-keys.mjs`
// from the api/ cwd, against the conductor's already-running wrangler dev
// (http://127.0.0.1:8901). This script is a CLIENT of that server — it never
// starts/stops/binds anything.
//
// WHY (contract M2 / R3, verbatim): "Every one of the 80 keys either governs
// a measurable painted value on a visible element, or is removed from the
// UI." This probe answers that for the 34 INLINE `theme_json` keys (the
// Funnel-level palette/typography/scales/button_defaults/card_defaults/
// field_defaults object) — a SEPARATE data path from the 25-key ThemeRecord
// sweep (verify-themerecord-keys.mjs) and the conductor's 6-key reproduction
// (repro-m2-inline.mjs), even though several keys resolve through the SAME
// underlying resolveTokens() mechanism (theme.ts).
//
// THE KEY LIST IS DERIVED FROM SOURCE, not from any document. Enumerated from
// api/src/public/leadgen/designs/theme.ts's `ThemeJson` interface (:546):
//   palette          14 — one entry per FUNNEL_TOKEN_ROLES member (theme.ts:45-60)
//   typography        4 — display, body, size, display_size (theme.ts:498-505)
//   scales            3 — spacing, radius, shadow (theme.ts:507-511)
//   button_defaults   8 — background_role, text_role, radius, min_height,
//                         casing, fill, layout, selected (theme.ts:513-524)
//   card_defaults     4 — background_role, border_role, radius, shadow (theme.ts:526-531)
//   field_defaults    1 — min_height (theme.ts:536-538)
//   TOTAL            34 — matches the contract's stated count exactly (no forcing).
// Each key's value vocabulary is taken from its own THEME_* constant in
// theme.ts (cited per-row below), never invented.
//
// METHOD (E10/E11 — never a stylesheet byte, never a hand-built page): write
// a FULL inline theme_json via the real operator route
// (PUT /api/admin/leadgen/funnels/:id/theme, body {theme_json}), fetch the
// LIVE visitor page in a real chromium on a fresh ?_cb, walk to the page
// depth the key's target surface renders on (advanceUntil — never a
// hard-coded Continue id), and read getComputedStyle on the FIRST VISIBLE
// matching element. Repeat for arm B; the two arms differ ONLY in the key
// under test (a full 14-role palette baseline is held constant across every
// non-palette arm, and across the 13 untested roles in every palette arm).
//
// FOUR VERDICTS (same vocabulary as verify-themerecord-keys.mjs, whose header
// documents them; this probe reuses them verbatim):
//   ALIVE         — the measured value moved on the element the key's own
//                   operator-facing LABEL implies (quotes-tabs/themes.ts /
//                   quotes-tabs/shared.ts ROLE_META).
//   MIS-TARGETED  — SOME painted, VISIBLE value moved, but not the
//                   label-implied element; the label-implied element is
//                   measured too (same page) and shown constant.
//   DEAD          — either (a) no consumer of the resolved token exists
//                   anywhere in api/src (grep basis printed in the row), or
//                   (b) a real, reachable, VISIBLE consumer did not move.
//   UNMEASURABLE  — a real consumer exists (source-cited), but no page this
//                   fixture renders reaches it VISIBLY (hidden modal, unmet
//                   layout/hover/hover gate, admin-preview-only, etc.).
// A value that only differs on an INVISIBLE node (0x0 / display:none) is
// NEVER counted as "moved" for ALIVE/MIS-TARGETED — that is exactly the
// false-green class this contract exists to kill (repro-m2-inline.mjs's own
// hazard note). Every row prints matched/visible counts + box size so this
// is auditable, not asserted.
//
// A found issue with an OWNED slice is NOT this script's job: this probe
// MEASURES ONLY. It does not fix, does not judge "should be fixed", and does
// not decide scope. Non-ALIVE keys are reported to the conductor for
// fix-or-defer routing by a (different) product-fix slice.
//
// Exit 0 when the sweep completes (verdicts are DATA, not a gate); exit 1
// only on harness failure (server unreachable / browser will not launch).

import { chromium } from "playwright";

const LG_BASE = "http://127.0.0.1:8901";
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_ID = "lgf_01KZ271383F5X1SQ3DXTXKNJE5"; // funnel A — the one /lg/r2fix serves
const FUNNEL_PATH = "/lg/r2fix";
const THEME_API = `${LG_BASE}/api/admin/leadgen/funnels/${FUNNEL_ID}/theme`;
// S3.8 — additional real operator routes used ONLY to AUTHOR the 5 states the
// S3.4 sweep could not reach (contract M2/R3): the frame PUT (a sparse
// per-group patch, recursively merged over whatever is already stored —
// frames.ts mergeInto/effectiveFrame, verified by reading both), the
// funnel/quote/variant reads needed to resolve the fixture's OWN section ids
// without hardcoding them, and the sections CRUD an operator's Section Studio
// already calls.
const FUNNEL_API = `${LG_BASE}/api/admin/leadgen/funnels/${FUNNEL_ID}`;
const FRAME_API = `${LG_BASE}/api/admin/leadgen/funnels/${FUNNEL_ID}/frame`;
const SECTIONS_API = `${LG_BASE}/api/admin/leadgen/sections`;
const sectionApi = (id) => `${LG_BASE}/api/admin/leadgen/sections/${id}`;
const variantApi = (id) => `${LG_BASE}/api/admin/leadgen/variants/${id}`;
const RESTORE = { theme_id: "thm_p8-repro" }; // A's binding before this run (repro-m2-inline.mjs convention)

// seed-leadgen-fixture.ts REAL_UA convention — the live /lg/ runtimeRequestGuard
// 403s a headless/empty UA in dev (no request.cf locally, UA heuristics only).
const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function redact(s) {
  return String(s)
    .replace(/([?&](?:key|token)=)[^&\s]+/gi, "$1***")
    .replace(/authorization:\s*\S+/gi, "authorization: ***");
}

let cbCounter = 0;
function freshUrl() {
  cbCounter += 1;
  return `http://${SITE_HOST}:8901${FUNNEL_PATH}?_cb=${Date.now()}-${cbCounter}`;
}

async function putTheme(theme_json) {
  const res = await fetch(THEME_API, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme_json }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT ${THEME_API} -> HTTP ${res.status}: ${redact(text.slice(0, 400))}`);
  return JSON.parse(text);
}

// S3.8 generic JSON HTTP verbs — every one of these is the SAME real
// operator-facing admin route a human would call from the Quote Builder /
// Section Studio UI; none of them starts/stops/binds anything (this script
// stays a CLIENT of the conductor's already-running wrangler dev).
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
async function httpJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}: ${redact(text.slice(0, 400))}`);
  return text === "" ? null : JSON.parse(text);
}
const getJson = (url) => httpJson("GET", url);
const putJson = (url, body) => httpJson("PUT", url, body);
const patchJson = (url, body) => httpJson("PATCH", url, body);
const postJson = (url, body) => httpJson("POST", url, body);
const deleteJson = (url) => httpJson("DELETE", url);

// Resolves the fixture's OWN current variant/section structure by READING it
// (GET /funnels/:id -> quote_id -> GET /quotes/:id/structure), never by
// hardcoding a section id — a sibling slice sharing this dev server could
// change ids under us (the contract's own hot-reload warning), and this
// script's own "derive from source, never assume" discipline extends to
// fixture STATE, not just code.
async function getFunnelStructure() {
  const funnel = await getJson(FUNNEL_API);
  const quoteId = funnel.quote_id;
  const variantPublicId = funnel.variants[0].public_id;
  const structure = await getJson(`${LG_BASE}/api/admin/leadgen/quotes/${quoteId}/structure`);
  const f = structure.funnels.find((x) => x.public_id === FUNNEL_ID);
  const v = f.variants.find((vv) => vv.public_id === variantPublicId);
  return {
    variantId: v.id,
    variantPublicId,
    sections: v.sections.map((s) => ({ section_id: s.section_id })), // ORIGINAL order, exact
  };
}

// A funnel-level FRAME group patch, sparse-merged over whatever is currently
// stored (frames.ts mergeInto: "objects merge recursively... `undefined` keys
// inherit") — setup() captures the PRE-EXISTING frame_config_json (null on
// this fixture) and teardown() writes it back. PUT /frame requires a JSON
// OBJECT (isRecord(raw) gate in frame-handlers.ts), so a `null` original
// restores as `{}` — verified behaviorally equivalent by reading
// effectiveFrame: `{template,version,...groups}` over `{}` yields
// `groups:{}`, and `mergeInto(frame, {})` is a no-op, so the EFFECTIVE frame
// is unchanged even though the STORED column differs (null vs {}) — called
// out explicitly in the teardown note, never silently glossed over.
// S3.8 per-key authored-state capture (module scope is safe: KEYS run
// strictly sequentially, one entry's setup/teardown always completes before
// the next entry starts — see main()'s `for` loop).
let accentOriginalSection; // { id, content_json } — the address section, pre-patch
let surfaceWashOriginalStructure; // { variantId, variantPublicId, sections } — pre-insert
let surfaceWashNewSectionId; // the temp probe section's numeric id
// S3.12 — same per-key authored-state discipline, two more entries that need
// a REAL inserted section to reach a surface the role now actually paints.
let successOriginalStructure; // { variantId, variantPublicId, sections } — pre-insert
let successNewSectionId; // the temp ReassuranceBadge probe section's numeric id
let accentCategoryOriginalStructure; // { variantId, variantPublicId, sections } — pre-insert
let accentCategoryNewSectionId; // the temp CategoryLabel probe section's numeric id

function makeFrameGroupSetupTeardown(groupKey, buildValue) {
  const state = { original: undefined };
  return {
    setup: async (notes) => {
      const proj = await getJson(FRAME_API);
      state.original = proj.frame_config; // object or null, EXACT prior value
      const currentGroup = isRecord(state.original) ? state.original[groupKey] : undefined;
      const value = buildValue();
      const patch = {
        version: 1,
        ...(isRecord(state.original) ? state.original : {}),
        [groupKey]: { ...(isRecord(currentGroup) ? currentGroup : {}), ...value },
      };
      await putJson(FRAME_API, { frame_config_json: patch });
      notes.push(
        `frame.${groupKey} patched to ${JSON.stringify(value)} (prior frame_config_json: ${JSON.stringify(state.original)})`,
      );
    },
    teardown: async (notes) => {
      const restore = isRecord(state.original) ? state.original : {};
      await putJson(FRAME_API, { frame_config_json: restore });
      notes.push(
        `frame restored to ${JSON.stringify(restore)}` +
          (isRecord(state.original)
            ? ""
            : " ({} stands in for the original null — PUT /frame requires an object; mergeInto(frame,{}) is a no-op so the EFFECTIVE frame is unchanged)"),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The 14-role baseline (theme.ts:45-60 FUNNEL_TOKEN_ROLES, exhaustive). Held
// CONSTANT across every arm of every non-palette-group test, and across the
// 13 untested roles of every palette-group test — so the two arms of ANY key
// differ ONLY in the key under test (repro-m2-inline.mjs's own discipline,
// widened from its 6-role subset to the full 14).
// ---------------------------------------------------------------------------
const BASE_PALETTE = {
  brand_primary: "#1D9BF0",
  brand_secondary: "#F0A500",
  accent: "#8E44AD",
  success: "#0E7C3A",
  error: "#D32F2F",
  page_background: "#F5F7FA",
  card_background: "#FFFFFF",
  surface_wash: "#E8F0FE",
  border: "#CBD5E1",
  text_primary: "#12181F",
  text_muted: "#5B6472",
  button_primary_bg: "#1B3A5C",
  button_primary_text: "#FFFFFF",
  button_secondary_bg: "#F2F6FA",
};

function armTheme(entry, value) {
  const patch = { [entry.sub]: value };
  const base =
    entry.group === "palette"
      ? { version: 1, palette: { ...BASE_PALETTE, ...patch } }
      : { version: 1, palette: BASE_PALETTE, [entry.group]: patch };
  // S3.8 — an entry may need a SECOND theme group set alongside its own key
  // (palette.error needs button_defaults.layout:"card" to even render the
  // .lg-tscard element its consumer is gated behind). Additive only: every
  // pre-S3.8 entry omits `extraTheme` and this is a no-op for them (I5).
  if (entry.extraTheme) {
    for (const [group, groupValue] of Object.entries(entry.extraTheme)) {
      base[group] = { ...(base[group] ?? {}), ...groupValue };
    }
  }
  return base;
}

// The fixture's page order is NOT hard-coded: earlier phases added/removed
// sections, so a walk pinned to a named Continue id breaks silently the
// moment page order changes. Advance by clicking whichever Continue is
// actually VISIBLE, filling the visible fields a required-question gate
// would block on, until the target selector is visible. Copied verbatim
// (shape) from repro-m2-inline.mjs's advanceUntil.
async function advanceUntil(page, targetSel, maxSteps = 8) {
  const seen = async () =>
    page.locator(targetSel).evaluateAll((els) => els.some((el) => el.offsetWidth > 0 && el.offsetHeight > 0));
  for (let i = 0; i < maxSteps; i += 1) {
    if (await seen()) return true;
    await page.evaluate(() => {
      const val = (el) => {
        const id = el.id || "";
        if (/zip/i.test(id)) return "62704";
        if (/state/i.test(id)) return "IL";
        if (/city/i.test(id)) return "Springfield";
        if (el.type === "email") return "p8@example.com";
        if (el.type === "tel") return "5551234567";
        return "123 Main St";
      };
      document
        .querySelectorAll("input.lg-input, input[type=text], input[type=tel], input[type=email]")
        .forEach((el) => {
          if (el.offsetWidth > 0 && el.offsetHeight > 0 && !el.value) {
            el.value = val(el);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
    });
    const cont = page.locator("[data-lg-continue]:visible").first();
    if ((await cont.count()) === 0) return false;
    await cont.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  return seen();
}

// depth 0 = shared page (question card + Continue). 1 = the address page (4
// .lg-input text fields). 2 = the carrier ButtonAnswerGroup page (3 choices).
// NEVER submits the carrier page's own Continue — that posts to /lg/auction,
// out of this probe's scope.
async function load(page, depth = 0) {
  await page.goto(freshUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#lg-funnel-root[data-lg-ready="1"]', { timeout: 8000 }).catch(() => {});
  if (depth >= 1) await advanceUntil(page, "#lg-addr-p8_addr_street");
  if (depth >= 2) await advanceUntil(page, ".lg-btn-answer");
  // .lg-input:focus outranks the role-driven resting border (higher
  // specificity) — the engine autofocuses a freshly revealed section's first
  // field, so an un-blurred read measures the FOCUS colour, a script
  // artifact. Blur unconditionally (harmless for every other property here).
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === "function") el.blur();
  });
}

// Measures the FIRST VISIBLE match, never merely the first match — a 0x0
// node still yields computed values, and comparing those is exactly the
// false-green this contract exists to kill. Reports matched vs visible
// counts + box size so an ABSENT/INVISIBLE reading is stated, not silently
// treated as constant. Copied verbatim from repro-m2-inline.mjs's probe().
async function probe(page, selector, props) {
  return page.locator(selector).evaluateAll(
    (els, ps) => {
      const vis = els.filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
      const el = vis[0] ?? els[0];
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const out = {
        _vis: el.offsetWidth > 0 && el.offsetHeight > 0,
        _w: Math.round(r.width),
        _h: Math.round(r.height),
        _matched: els.length,
        _visible: vis.length,
      };
      for (const p of ps) out[p] = cs[p];
      return out;
    },
    props,
  );
}

async function countMatches(page, selector) {
  return page.locator(selector).count();
}

async function withRetry(fn, label, notes) {
  try {
    return await fn();
  } catch (e1) {
    notes.push(`${label}: first attempt failed (${redact((e1 && e1.message) || e1)}) — retrying once (fresh ?_cb)`);
    try {
      return await fn();
    } catch (e2) {
      notes.push(`${label}: retry also failed (${redact((e2 && e2.message) || e2)})`);
      throw e2;
    }
  }
}

function valueOf(r) {
  if (r === null || r === undefined) return null;
  if (typeof r === "number") return String(r);
  const { _vis, _w, _h, _matched, _visible, ...rest } = r;
  return JSON.stringify(rest);
}
function isVisible(r) {
  return typeof r === "object" && r !== null && r._visible > 0;
}
function fmt(v) {
  if (v === null || v === undefined) return "ABSENT (selector matched 0 nodes)";
  if (typeof v === "number") return `count=${v}`;
  const { _vis, _w, _h, _matched, _visible, ...rest } = v;
  const props = Object.entries(rest)
    .map(([k, val]) => `${k}=${val}`)
    .join("  ");
  return `${props}   [_vis:${_vis} ${_w}x${_h}  matched:${_matched} visible:${_visible}]`;
}

// ---------------------------------------------------------------------------
// THE 34-KEY TABLE. Grouped exactly as ThemeJson (theme.ts:546-554). Each
// row's `label` cites the operator-facing control name (quotes-tabs/themes.ts
// / quotes-tabs/shared.ts ROLE_META) — the LABEL is what "the key's own
// operator-facing LABEL implies" (contract wording) is measured against.
// `sub` is the leaf field name inside its group; `valueA`/`valueB` are drawn
// from that field's own THEME_* vocabulary constant (cited per row).
// ---------------------------------------------------------------------------
const KEYS = [
  // === palette — 14, one per FUNNEL_TOKEN_ROLES (theme.ts:45-60) ===========
  // Values: a #hex colour (ThemePaletteValue = string, theme.ts:544). Roles
  // bridge through setRoleToken (theme.ts:133-138) onto ROLE_TO_BASE_TOKEN
  // (theme.ts:89-104) — the SAME base tokens the ThemeRecord roles/extra_roles
  // sweep measured, reached here via the inline `palette.<role>` path instead.
  {
    key: "palette.brand_primary",
    group: "palette",
    sub: "brand_primary",
    label: "Brand primary — quotes-tabs/shared.ts:458 ROLE_META, used_by \"buttons, progress fill, selected borders, logo text\"",
    valueA: "#123456",
    valueB: "#ee7733",
    depth: 0,
    measure: (page) => probe(page, ".lg-progress-fill", ["backgroundColor"]),
    target: ".lg-progress-fill background-color (color.primary -> frame progress fill, styles.ts .lg-frame-progress--role-brand_primary rule)",
  },
  {
    key: "palette.brand_secondary",
    group: "palette",
    sub: "brand_secondary",
    label: "Brand secondary — quotes-tabs/shared.ts:459 ROLE_META, used_by \"gradients, secondary emphasis\"",
    valueA: "#123456",
    valueB: "#ee7733",
    // S3.8: reachable by AUTHORING the state (contract M2/R3) — the frame's
    // ONLY consumer of this role is .lg-frame-background.lg-frame-bg-style-
    // brand_gradient (styles.ts, "background: linear-gradient(160deg,
    // brand_primary,brand_secondary)"); this fixture's frame_config_json was
    // null (style defaults to "flat"). setup() PUTs a real frame.background
    // patch {style:"brand_gradient"} via PUT /funnels/:id/frame (the exact
    // route the Quote Builder's frame editor calls); teardown() restores the
    // prior frame_config_json exactly. A linear-gradient resolves into the
    // computed `background-image`, NEVER `background-color` (which stays its
    // transparent initial value) — measuring backgroundColor here would be a
    // false-DEAD read, so this measures backgroundImage.
    depth: 0,
    ...makeFrameGroupSetupTeardown("background", () => ({ style: "brand_gradient" })),
    measure: (page) => probe(page, ".lg-frame-background.lg-frame-bg-style-brand_gradient", ["backgroundImage"]),
    target:
      '.lg-frame-background.lg-frame-bg-style-brand_gradient background-image (AUTHORED: PUT /funnels/:id/frame {background:{style:"brand_gradient"}}; styles.ts "linear-gradient(160deg,brand_primary,brand_secondary)")',
  },
  {
    key: "palette.accent",
    group: "palette",
    sub: "accent",
    label: "Accent — quotes-tabs/shared.ts:460 ROLE_META, used_by \"category label, highlights, recommended\"",
    valueA: "#123456",
    valueB: "#ee7733",
    // S3.8: design.color.accent's per-node consumer is
    // nodeBorderColorValue('accent') (presets.ts), reached via a
    // design_overrides.border_color enum on the p8_addr node (PATCH
    // /sections/:id, the SAME route the Style tab calls) — kept below as a
    // SECONDARY, bonus-corroboration probe; real and unaffected by the fix.
    // S3.12: theme.ts's applyAccentRole (~:1667) now wires the AUTHORED
    // `accent` role directly into design.categoryLabel.color. The row's OWN
    // prior note — "this fixture renders no .lg-category node at all,
    // corroborating the claim is unwired" — was a GAP to close, not a code
    // fix: authoring a REAL CategoryLabel section (POST /sections + PUT
    // /variants/:id, the SAME insertion pattern palette.surface_wash /
    // palette.success use) makes the label-implied element ACTUALLY
    // RENDER, so it is now the PRIMARY target directly (no separate
    // impliedMeasure indirection needed — decide() already returns ALIVE
    // once a row with no impliedMeasure moves+is-visible). NOT measured
    // here, deliberately: banner.recommendedBorder (the role's third
    // consumer) rests on banner-default/styles.ts's own scope
    // (`[data-banner-design="banner-default"]`), which has ZERO producers
    // anywhere in src/ (theme.ts's own applyAccentRole comment) — a verdict
    // resting on that surface would be false. header.logoAccentColor is a
    // second real, unmeasured surface — reported, not fixed, out of slice.
    depth: 1,
    setup: async (notes) => {
      const struct = await getFunnelStructure();
      const addrSectionId = struct.sections[0].section_id;
      const section = await getJson(sectionApi(addrSectionId));
      accentOriginalSection = { id: addrSectionId, content_json: section.content_json };
      const mutated = JSON.parse(JSON.stringify(section.content_json));
      const addrNode = (mutated.components ?? []).find((c) => c.question_id === "p8_addr");
      if (!addrNode) throw new Error("p8_addr node not found in the fixture's address section");
      addrNode.design_overrides = { ...(addrNode.design_overrides ?? {}), border_color: "accent" };
      await patchJson(sectionApi(addrSectionId), { content_json: mutated });
      notes.push(`section ${addrSectionId} (p8_addr node) design_overrides.border_color set to "accent"`);

      accentCategoryOriginalStructure = struct;
      const created = await postJson(SECTIONS_API, {
        section_name: "P8 S3.12 Accent CategoryLabel Probe (temporary)",
        activity: "r2fix_activity",
        vertical: "r2fix_vertical",
        headline_text: "P8 S3.12 accent probe",
        content_json: {
          components: [
            { type: "CategoryLabel", question_id: "p8_s312_category", props: { text: "P8 S3.12 category" } },
            { type: "ContinueButton", question_id: "p8_s312_category_cont", props: { label: "Continue" } },
          ],
        },
      });
      accentCategoryNewSectionId = created.id;
      const newOrder = [struct.sections[0], { section_id: accentCategoryNewSectionId }, ...struct.sections.slice(1)];
      await putJson(variantApi(struct.variantPublicId), { sections: newOrder });
      notes.push(
        `created temp section ${accentCategoryNewSectionId} (CategoryLabel) and inserted at position 1 of variant ${struct.variantPublicId}`,
      );
    },
    teardown: async (notes) => {
      if (accentOriginalSection) {
        await patchJson(sectionApi(accentOriginalSection.id), { content_json: accentOriginalSection.content_json });
        notes.push(`section ${accentOriginalSection.id} content_json restored byte-exact`);
      }
      if (accentCategoryOriginalStructure) {
        await putJson(variantApi(accentCategoryOriginalStructure.variantPublicId), {
          sections: accentCategoryOriginalStructure.sections,
        });
        notes.push(
          `variant ${accentCategoryOriginalStructure.variantPublicId} section order restored to original ${JSON.stringify(accentCategoryOriginalStructure.sections)}`,
        );
      }
      if (accentCategoryNewSectionId) {
        await deleteJson(sectionApi(accentCategoryNewSectionId));
        notes.push(`temp section ${accentCategoryNewSectionId} deleted`);
      }
    },
    measure: async (page) => {
      await advanceUntil(page, ".lg-category", 8);
      return probe(page, ".lg-category", ["color"]);
    },
    target:
      '.lg-category color (LABEL "category label" — quotes-tabs/shared.ts:460 ROLE_META; AUTHORED: POST /sections + PUT /variants/:id inserting a CategoryLabel section; applyAccentRole -> design.categoryLabel.color, presets.ts renderCategoryLabel)',
    secondary: {
      depth: 1,
      measure: (page) => probe(page, "#lg-addr-p8_addr_street", ["borderTopColor"]),
      target:
        '#lg-addr-p8_addr_street border-top-color (AUTHORED: PATCH /sections/:id design_overrides.border_color="accent" on the p8_addr node -> --lg-field-border custom property, presets.ts nodeBorderColorValue/appearanceStyleEntries; the PRE-existing per-node override mechanism, independent of applyAccentRole — bonus corroboration only)',
    },
  },
  {
    key: "palette.success",
    group: "palette",
    sub: "success",
    label: "Success — quotes-tabs/shared.ts:461 ROLE_META, used_by \"reassurance, valid states\"",
    valueA: "#00ff00",
    valueB: "#003300",
    // S3.12 DEFECT FIX: this row previously carried a hardcoded `deadReason`
    // with NO `measure` function at all — a verdict asserted, never
    // measured (the exact paper-audit failure mode this contract exists to
    // end). The grep basis it cited ("color.success has exactly 2 hits,
    // both definitions") is now STALE, not merely outdated: theme.ts's
    // applySuccessRole (~:1568) wires the AUTHORED `success` role into the
    // frozen component slots successState.border/.iconColor,
    // reassuranceBadge.border/.iconColor/.textColor and trustBar.iconColor —
    // none of those tokens is named `color.success`, so a grep on that
    // literal string can never see this fix (the applySuccessRole comment's
    // own point: "A grep is not a measurement"). "reassurance" is literally
    // the FIRST word of this role's own operator-facing ROLE_META `used_by`
    // (quotes-tabs/shared.ts), so ReassuranceBadge (.lg-badge/.lg-badge-
    // icon, presets.ts renderReassuranceBadge) IS the label-implied surface
    // itself — no impliedMeasure indirection needed. setup() creates a new
    // section (ReassuranceBadge + ContinueButton) via POST /sections and
    // inserts it at position 1 of the fixture's OWN variant (resolved
    // live) — the SAME insertion point palette.surface_wash already uses,
    // right after the address section and BEFORE the carrier page, never
    // crossing the carrier's required ButtonAnswerGroup/auction boundary.
    // teardown() restores the variant's original section order, then
    // deletes the temp section.
    depth: 1,
    setup: async (notes) => {
      const struct = await getFunnelStructure();
      successOriginalStructure = struct;
      const created = await postJson(SECTIONS_API, {
        section_name: "P8 S3.12 Success Role Probe (temporary)",
        activity: "r2fix_activity",
        vertical: "r2fix_vertical",
        headline_text: "P8 S3.12 success probe",
        content_json: {
          components: [
            { type: "ReassuranceBadge", question_id: "p8_s312_badge", props: { text: "Trusted & secure" } },
            { type: "ContinueButton", question_id: "p8_s312_badge_cont", props: { label: "Continue" } },
          ],
        },
      });
      successNewSectionId = created.id;
      const newOrder = [struct.sections[0], { section_id: successNewSectionId }, ...struct.sections.slice(1)];
      await putJson(variantApi(struct.variantPublicId), { sections: newOrder });
      notes.push(
        `created temp section ${successNewSectionId} (ReassuranceBadge) and inserted at position 1 of variant ${struct.variantPublicId}`,
      );
    },
    teardown: async (notes) => {
      if (successOriginalStructure) {
        await putJson(variantApi(successOriginalStructure.variantPublicId), {
          sections: successOriginalStructure.sections,
        });
        notes.push(
          `variant ${successOriginalStructure.variantPublicId} section order restored to original ${JSON.stringify(successOriginalStructure.sections)}`,
        );
      }
      if (successNewSectionId) {
        await deleteJson(sectionApi(successNewSectionId));
        notes.push(`temp section ${successNewSectionId} deleted`);
      }
    },
    measure: async (page) => {
      await advanceUntil(page, ".lg-badge-icon", 8);
      return probe(page, ".lg-badge-icon", ["color"]);
    },
    target:
      '.lg-badge-icon color (LABEL "reassurance" — quotes-tabs/shared.ts:461 ROLE_META; AUTHORED: POST /sections + PUT /variants/:id inserting a ReassuranceBadge section; applySuccessRole -> design.reassuranceBadge.iconColor, presets.ts renderReassuranceBadge)',
  },
  {
    key: "palette.error",
    group: "palette",
    sub: "error",
    label: "Error — quotes-tabs/shared.ts:462 ROLE_META, used_by \"validation errors\"",
    valueA: "#ff0000",
    valueB: "#330000",
    // S3.8/S3.9 (kept — still true): a drive of button_defaults.layout=
    // "card" + an unanswered required-choice Continue on the carrier
    // ButtonAnswerGroup measured LIVE that `.lg-tscard[data-error="true"]`
    // never matches (0 matched, both arms) — grepping the WHOLE visitor
    // runtime for `data-error` finds zero producers anywhere. The real
    // required-validation path is render.ts:228 setFieldError.
    // S3.12 FIRST ATTEMPT (superseded, kept as a note): depth 1 + a bare
    // Continue click on the address page with every field EMPTY also read
    // UNMEASURABLE — driven and checked, not assumed: a click-by-click walk
    // of this fixture with NOTHING ever filled shows the address group's
    // OWN required check PASSES on empty input (the click legitimately
    // advances past it; validation.ts has no per-field `props.fields` on
    // this node, so it validates as one scalar keyed to internal_field
    // "p8_addr" — and that check does not require an answer here). So
    // `.lg-input[aria-invalid="true"]` is genuinely unreachable via the
    // address page on THIS fixture.
    // S3.12 REAL FIX: this fixture's one actually-enforced required field is
    // the carrier's own ButtonAnswerGroup (question_id "r2fix_q_carrier",
    // internal_field "r2fix_carrier", section "R2Fix Fixture Carrier
    // Buttons") — confirmed live: a Continue click there with NO choice
    // selected paints "This field is required." into its message slot.
    // `[data-lg-error-for="r2fix_carrier"]` carries validation.errorTextColor
    // as an INLINE style set by the renderer itself (render.ts:228 unhides
    // it; presets.ts style({color: validation.errorTextColor}) at render
    // time) — the SAME token applyErrorRole now writes, and the one of its
    // two real consumers reachable WITHOUT authoring a new required
    // text-input section (no question in this fixture has a bare `<input
    // data-lg-input>` gated by `required`, so `input.errorBorderColor` /
    // `.lg-input[aria-invalid="true"]` stays genuinely UNREACHABLE here —
    // driven and confirmed below as a bonus secondary, expected ABSENT, not
    // merely assumed).
    depth: 2,
    measure: async (page) => {
      const cont = page.locator("[data-lg-continue]:visible").first();
      if ((await cont.count()) > 0) {
        await cont.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
      return probe(page, '[data-lg-error-for="r2fix_carrier"]', ["color"]);
    },
    target:
      'DRIVEN: [data-lg-error-for="r2fix_carrier"] color, after a Continue click on the carrier ButtonAnswerGroup with NO choice selected (engine.ts handleContinue/sectionPassesAt -> render.ts:228 setFieldError, the real required-validation producer, unhides the slot and inline-styles it with validation.errorTextColor); styles.ts .lg-error{color:validation.errorTextColor}, same token applyErrorRole writes',
    secondary: {
      depth: 2,
      measure: async (page) => {
        const cont = page.locator("[data-lg-continue]:visible").first();
        if ((await cont.count()) > 0) {
          await cont.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
        return probe(page, '.lg-input[aria-invalid="true"]', ["borderTopColor"]);
      },
      target:
        '.lg-input[aria-invalid="true"] border-top-color (bonus corroboration, EXPECTED ABSENT: this fixture has no required question backed by a bare <input data-lg-input> — driven and confirmed, not assumed; input.errorBorderColor is a real consumer, styles.ts .lg-input[aria-invalid="true"]{border-color:input.errorBorderColor}, just unreachable on THIS fixture\'s current structure without authoring a new section)',
    },
  },
  {
    key: "palette.page_background",
    group: "palette",
    sub: "page_background",
    label: "Page background — quotes-tabs/shared.ts:463 ROLE_META, used_by \"frame background\"",
    valueA: "#123456",
    valueB: "#ee7733",
    depth: 0,
    measure: (page) => probe(page, "#lg-funnel-root", ["backgroundColor"]),
    target: "#lg-funnel-root background-color (page.backgroundColor, scope-root rule)",
  },
  {
    key: "palette.card_background",
    group: "palette",
    sub: "card_background",
    label: "Card background — quotes-tabs/shared.ts:464 ROLE_META, used_by \"question card, answer cards\"",
    valueA: "#123456",
    valueB: "#ee7733",
    depth: 1,
    measure: (page) => probe(page, "#lg-addr-p8_addr_street", ["backgroundColor"]),
    target: "#lg-addr-p8_addr_street background-color (color.card -> .lg-input background, styles.ts:1828)",
    impliedMeasure: (page) => probe(page, ".lg-question-card", ["backgroundColor"]),
    impliedTarget:
      ".lg-question-card background-color (LABEL 'card' implies THIS element — styles.ts:570 questionCard.background, a SEPARATE token the plain palette.card_background write does NOT touch; unlike card_defaults.background_role, below, which now also writes it)",
    secondary: {
      depth: 2,
      measure: (page) => probe(page, ".lg-btn-answer", ["backgroundColor"]),
      target: ".lg-btn-answer background-color (carrier page, first choice; var(--lg-answer-bg, color.card) fallback, styles.ts:1392)",
    },
  },
  {
    key: "palette.surface_wash",
    group: "palette",
    sub: "surface_wash",
    label: "Soft fill — quotes-tabs/shared.ts:465 ROLE_META, used_by \"selected fills, quiet panels\"",
    valueA: "#123456",
    valueB: "#ee7733",
    // S3.8: reachable by AUTHORING a real RangeQuestion(radial) section
    // (contract M2/R3) — color.primaryWash's only consumer is
    // ".lg-range-radial:focus-within .lg-range-radial-outer{box-shadow:0 0 0
    // 3px color.primaryWash}" (styles.ts; re-read live — the contract's cited
    // line number had drifted, the SELECTOR is a descendant combinator, not
    // bare .lg-range-radial:focus-within). setup() creates a new section
    // (NumberRangeQuestion, props.slider_type:"radial") via POST /sections
    // and inserts it at position 1 of the fixture's OWN variant (resolved
    // live), right after the address section and BEFORE the carrier page —
    // never crossing the carrier's required ButtonAnswerGroup or its
    // auction-entry boundary. teardown() restores the variant's original
    // section order, THEN deletes the temp section (delete is blocked while
    // still attached, sections-handlers.ts deleteSectionHandler). measure()
    // reuses advanceUntil (fills the address fields, clicks through) to
    // reach the new section, then REAL-focuses the native range input
    // (:focus-within reacts to genuine DOM focus, not a class) before probing
    // the outer dial's box-shadow.
    depth: 1,
    setup: async (notes) => {
      const struct = await getFunnelStructure();
      surfaceWashOriginalStructure = struct;
      const created = await postJson(SECTIONS_API, {
        section_name: "P8 S3.8 Surface Wash Probe (temporary)",
        activity: "r2fix_activity",
        vertical: "r2fix_vertical",
        headline_text: "P8 S3.8 surface_wash probe",
        content_json: {
          components: [
            {
              type: "NumberRangeQuestion",
              question_id: "p8_s38_range",
              internal_field: "p8_s38_range",
              props: { slider_type: "radial", min: 0, max: 100, step: 1 },
            },
            { type: "ContinueButton", question_id: "p8_s38_range_cont", props: { label: "Continue" } },
          ],
        },
      });
      surfaceWashNewSectionId = created.id;
      const newOrder = [
        struct.sections[0],
        { section_id: surfaceWashNewSectionId },
        ...struct.sections.slice(1),
      ];
      await putJson(variantApi(struct.variantPublicId), { sections: newOrder });
      notes.push(
        `created temp section ${surfaceWashNewSectionId} (NumberRangeQuestion radial) and inserted at position 1 of variant ${struct.variantPublicId}`,
      );
    },
    teardown: async (notes) => {
      if (surfaceWashOriginalStructure) {
        await putJson(variantApi(surfaceWashOriginalStructure.variantPublicId), {
          sections: surfaceWashOriginalStructure.sections,
        });
        notes.push(
          `variant ${surfaceWashOriginalStructure.variantPublicId} section order restored to original ${JSON.stringify(surfaceWashOriginalStructure.sections)}`,
        );
      }
      if (surfaceWashNewSectionId) {
        await deleteJson(sectionApi(surfaceWashNewSectionId));
        notes.push(`temp section ${surfaceWashNewSectionId} deleted`);
      }
    },
    measure: async (page) => {
      await advanceUntil(page, ".lg-range-radial", 8);
      await page.locator(".lg-range-radial .lg-range-radial-input").first().focus();
      return probe(page, ".lg-range-radial-outer", ["boxShadow"]);
    },
    target:
      "AUTHORED: .lg-range-radial-outer box-shadow while .lg-range-radial-input is REAL-focused (a NumberRangeQuestion radial section inserted via PUT /variants/:id sections); styles.ts .lg-range-radial:focus-within .lg-range-radial-outer{box-shadow:0 0 0 3px color.primaryWash}",
  },
  {
    key: "palette.border",
    group: "palette",
    sub: "border",
    label: "Border — quotes-tabs/shared.ts:466 ROLE_META, used_by \"card/input borders\"",
    valueA: "#123456",
    valueB: "#ee7733",
    depth: 1,
    measure: (page) => probe(page, "#lg-addr-p8_addr_street", ["borderTopColor"]),
    target: "#lg-addr-p8_addr_street border-top-color (unoverridden fallback var(--lg-field-border, color.border), styles.ts:1816)",
  },
  {
    key: "palette.text_primary",
    group: "palette",
    sub: "text_primary",
    label: "Text — quotes-tabs/shared.ts:467 ROLE_META, used_by \"headlines, labels\"",
    valueA: "#111111",
    valueB: "#eeeeee",
    depth: 0,
    measure: (page) => probe(page, "#lg-funnel-root", ["color"]),
    target: "#lg-funnel-root color (page.textColor, scope-root rule)",
  },
  {
    key: "palette.text_muted",
    group: "palette",
    sub: "text_muted",
    label: "Muted text — quotes-tabs/shared.ts:468 ROLE_META, used_by \"subheadlines, helper, meta\"",
    valueA: "#123456",
    valueB: "#ee7733",
    depth: 1,
    measure: (page) => probe(page, ".lg-address-field-label", ["color"]),
    target: ".lg-address-field-label color (page.textSecondaryColor, styles.ts:1794)",
  },
  {
    key: "palette.button_primary_bg",
    group: "palette",
    sub: "button_primary_bg",
    label: "Button — quotes-tabs/shared.ts:469 ROLE_META, used_by \"Continue/CTA background\"",
    valueA: "#123456",
    valueB: "#ee7733",
    depth: 0,
    measure: (page) => probe(page, ".lg-continue", ["backgroundColor"]),
    target: ".lg-continue background-color (primaryButton.background, shared .lg-btn base rule, styles.ts:1228)",
  },
  {
    key: "palette.button_primary_text",
    group: "palette",
    sub: "button_primary_text",
    label: "Button text — quotes-tabs/shared.ts:470 ROLE_META, used_by \"Continue/CTA text\"",
    valueA: "#123456",
    valueB: "#eeeeee",
    depth: 0,
    measure: (page) => probe(page, ".lg-continue", ["color"]),
    target: ".lg-continue color (primaryButton.color, shared .lg-btn base rule, styles.ts:1229)",
  },
  {
    key: "palette.button_secondary_bg",
    group: "palette",
    sub: "button_secondary_bg",
    label: "Secondary button — quotes-tabs/shared.ts:471 ROLE_META, used_by \"back button-style, quiet buttons\"",
    valueA: "#123456",
    valueB: "#ee7733",
    // S3.8: reachable by AUTHORING the frame's benefit bar (contract M2/R3
    // names it "the cleanest" of the 4 gated consumers — used here; a
    // real :hover on .lg-tscard/.lg-range-stepper-btn was the alternative).
    // setup() PUTs a real frame.benefit_bar patch {enabled:true,
    // items:[...], placement:"below_unit"} via PUT /funnels/:id/frame (the
    // exact route the frame editor's benefit-bar panel calls); teardown()
    // restores the prior frame_config_json exactly (same discipline as
    // brand_secondary above). .lg-frame-benefit is always rendered once
    // enabled+non-empty (frame.ts renderBenefitRegion, no hover/layout gate),
    // so a plain backgroundColor probe suffices — no impliedMeasure needed.
    depth: 0,
    ...makeFrameGroupSetupTeardown("benefit_bar", () => ({
      enabled: true,
      items: [{ icon: "circle-check", text: "Fast & free" }],
      placement: "below_unit",
    })),
    measure: (page) => probe(page, ".lg-frame-benefit", ["backgroundColor"]),
    target:
      '.lg-frame-benefit background-color (AUTHORED: PUT /funnels/:id/frame {benefit_bar:{enabled:true,items:[...],placement:"below_unit"}}; styles.ts .lg-frame-benefit{background:color.primaryGhost})',
  },

  // === typography — 4 (ThemeTypography, theme.ts:498-505) ===================
  {
    key: "typography.display",
    group: "typography",
    sub: "display",
    label: "Display font (headlines) — quotes-tabs/themes.ts:207",
    valueA: "literata",
    valueB: "playfair",
    depth: 2,
    measure: (page) => probe(page, ".lg-headline", ["fontFamily"]),
    target: ".lg-headline font-family (applyDisplayFont -> design.headline.fontFamily, THEME_FONT_STACKS[displayId])",
  },
  {
    key: "typography.body",
    group: "typography",
    sub: "body",
    label: "Body font (paragraphs) — quotes-tabs/themes.ts:208",
    valueA: "sora",
    valueB: "work_sans",
    depth: 0,
    measure: (page) => probe(page, "#lg-funnel-root", ["fontFamily"]),
    target: "#lg-funnel-root font-family (applyBodyFont -> design.page.fontFamily)",
  },
  {
    key: "typography.size",
    group: "typography",
    sub: "size",
    label: "Body text size — quotes-tabs/themes.ts:209 (panel copy: \"Body sets paragraphs, labels and inputs\")",
    valueA: "s",
    valueB: "l",
    depth: 1,
    measure: (page) => probe(page, ".lg-address-field-label", ["fontSize"]),
    target: ".lg-address-field-label font-size (subheadline.fontSize, scaleFontSizes(THEME_SIZE_FACTORS[size]) touches every *FontSize* token, styles.ts:1793)",
  },
  {
    key: "typography.display_size",
    group: "typography",
    sub: "display_size",
    label: "Display size — quotes-tabs/themes.ts:210",
    valueA: "m",
    valueB: "xxl",
    depth: 2,
    measure: (page) => probe(page, ".lg-headline", ["fontSize"]),
    target: ".lg-headline font-size (scaleDisplayFontSizes -> headline.fontSizeDesktop, DISPLAY_FONTSIZE_PATHS)",
  },

  // === scales — 3 (ThemeScales, theme.ts:507-511) ============================
  {
    key: "scales.spacing",
    group: "scales",
    sub: "spacing",
    label: "Spacing — quotes-tabs/themes.ts:214",
    valueA: "compact",
    valueB: "roomy",
    depth: 1,
    measure: (page) => probe(page, ".lg-address-field-label", ["marginBottom"]),
    target: ".lg-address-field-label margin-bottom (design.spacing.xs, applySpacingScale -> scaleCssLength, styles.ts:1795 — a direct SPACING_KEYS consumer)",
  },
  {
    key: "scales.radius",
    group: "scales",
    sub: "radius",
    label: "Corners — quotes-tabs/themes.ts:215",
    valueA: "sharp",
    valueB: "round",
    depth: 0,
    measure: (page) => probe(page, ".lg-question-card", ["borderRadius"]),
    target: ".lg-question-card border-radius (applyRadiusScale -> design.questionCard.borderRadius, theme.ts:1704 — P6 fixes3/E2 component-radius bridge)",
  },
  {
    key: "scales.shadow",
    group: "scales",
    sub: "shadow",
    label: "Shadows — quotes-tabs/themes.ts:216",
    valueA: "none",
    valueB: "high",
    depth: 0,
    measure: (page) => probe(page, ".lg-question-card", ["boxShadow"]),
    target: ".lg-question-card box-shadow (applyShadowScale -> design.questionCard.boxShadow, theme.ts:1770-1791 — R2 P8 M2 component-shadow bridge; PRE-fix this reached only the emitted --lg-shadow-* vars, per that function's own doc comment)",
    secondary: {
      depth: 0,
      measure: (page) => probe(page, ".lg-disclosure-panel", ["boxShadow"]),
      target: ".lg-disclosure-panel box-shadow (shadow.xl, styles.ts ~2639 — the disclosure MODAL panel, hidden until toggled; bonus corroboration only)",
    },
  },

  // === button_defaults — 8 (ThemeButtonDefaults, theme.ts:513-524) ===========
  {
    key: "button_defaults.background_role",
    group: "button_defaults",
    sub: "background_role",
    label: "Button background — quotes-tabs/themes.ts:219 (frameControl + renderRoleStrip)",
    valueA: "error",
    valueB: "success",
    depth: 0,
    measure: (page) => probe(page, ".lg-continue", ["backgroundColor"]),
    target: ".lg-continue background-color (design.primaryButton.background = roles[bd.background_role], theme.ts:1312)",
  },
  {
    key: "button_defaults.text_role",
    group: "button_defaults",
    sub: "text_role",
    label: "Button text — quotes-tabs/themes.ts:220 (frameControl + renderRoleStrip)",
    valueA: "error",
    valueB: "success",
    depth: 0,
    measure: (page) => probe(page, ".lg-continue", ["color"]),
    target: ".lg-continue color (design.primaryButton.color = roles[bd.text_role], theme.ts:1313)",
  },
  {
    key: "button_defaults.radius",
    group: "button_defaults",
    sub: "radius",
    label: "Button corners — quotes-tabs/themes.ts:222",
    valueA: "sm",
    valueB: "full",
    depth: 0,
    measure: (page) => probe(page, ".lg-continue", ["borderRadius"]),
    target: ".lg-continue border-radius (design.primaryButton.borderRadius = design.radius[bd.radius], theme.ts:1314, shared .lg-btn base rule)",
    secondary: {
      depth: 2,
      measure: (page) => probe(page, ".lg-btn-answer", ["borderRadius"]),
      target: ".lg-btn-answer border-radius (same shared .lg-btn base rule — expected to move identically; bonus corroboration)",
    },
  },
  {
    key: "button_defaults.min_height",
    group: "button_defaults",
    sub: "min_height",
    label: "Button height — quotes-tabs/themes.ts:223",
    valueA: "s",
    valueB: "l",
    depth: 0,
    measure: (page) => probe(page, ".lg-continue", ["minHeight"]),
    target: ".lg-continue min-height (design.primaryButton.minHeight = BUTTON_MIN_HEIGHT_CSS[bd.min_height], theme.ts:1315)",
  },
  {
    key: "button_defaults.casing",
    group: "button_defaults",
    sub: "casing",
    label: "Button casing — quotes-tabs/themes.ts:224",
    valueA: "none",
    valueB: "upper",
    depth: 0,
    measure: (page) => probe(page, ".lg-continue", ["textTransform"]),
    target: ".lg-continue text-transform (R2 P8 M2 fix: readButtonCasing(design) -> `.lg-btn{text-transform:uppercase}`, styles.ts:2412-2413 — PRE-fix this read EffectiveButtonDefaults.text_transform, which had zero CSS consumers)",
  },
  {
    key: "button_defaults.fill",
    group: "button_defaults",
    sub: "fill",
    label: "Fill — quotes-tabs/themes.ts:233",
    valueA: "outline",
    valueB: "soft",
    depth: 2,
    measure: (page) => probe(page, ".lg-btn-answer", ["borderRadius"]),
    target: ".lg-btn-answer border-radius (readButtonStyle stash; fill=\"soft\" sets radius.full via .lg-answer-group[data-btn-fill=\"soft\"] .lg-btn-answer, styles.ts:170-173)",
  },
  {
    key: "button_defaults.layout",
    group: "button_defaults",
    sub: "layout",
    label: "Answer layout — quotes-tabs/themes.ts:234",
    valueA: "grid",
    valueB: "list",
    depth: 2,
    measure: (page) => probe(page, ".lg-answer-group", ["gridTemplateColumns"]),
    target: ".lg-answer-group grid-template-columns (layout=\"list\" forces 1fr via .lg-answer-group[data-btn-layout=\"list\"], styles.ts:187)",
  },
  {
    key: "button_defaults.selected",
    group: "button_defaults",
    sub: "selected",
    label: "Selected style — quotes-tabs/themes.ts:235",
    valueA: "wash",
    valueB: "mark",
    depth: 2,
    isCount: true,
    measure: (page) => countMatches(page, ".lg-answer-group .lg-check-hollow"),
    target: "count(.lg-answer-group .lg-check-hollow) (selected=\"mark\" unconditionally renders a hollow+badge span pair per choice, presets.ts selectedMarkerMarkup)",
  },

  // === card_defaults — 4 (ThemeCardDefaults, theme.ts:526-531) ===============
  // R2 P8 M2 fix (theme.ts:1353-1408, "THE CARD THE OPERATOR MEANS IS
  // .lg-question-card"): all four keys now ALSO write the questionCard slot
  // their own operator label names, additively (the pre-existing writes are
  // kept for back-compat). Measured live below, not assumed from the comment.
  {
    key: "card_defaults.background_role",
    group: "card_defaults",
    sub: "background_role",
    label: "Card background — quotes-tabs/themes.ts:238 (frameControl + renderRoleStrip)",
    valueA: "error",
    valueB: "success",
    depth: 0,
    measure: (page) => probe(page, ".lg-question-card", ["backgroundColor"]),
    target: ".lg-question-card background-color (R2 P8 M2: design.questionCard.background = roles[cd.background_role], theme.ts:1382)",
    secondary: {
      depth: 1,
      measure: (page) => probe(page, "#lg-addr-p8_addr_street", ["backgroundColor"]),
      target: "#lg-addr-p8_addr_street background-color (pre-existing write design.color.card, theme.ts:1381 — kept for back-compat; bonus corroboration)",
    },
  },
  {
    key: "card_defaults.border_role",
    group: "card_defaults",
    sub: "border_role",
    label: "Card border — quotes-tabs/themes.ts:239 (frameControl + renderRoleStrip)",
    valueA: "error",
    valueB: "success",
    depth: 0,
    measure: (page) => probe(page, ".lg-question-card", ["borderTopColor"]),
    target: ".lg-question-card border-top-color (R2 P8 M2: design.questionCard.border = `1px solid ${roles[cd.border_role]}`, theme.ts:1395)",
    secondary: {
      depth: 0,
      measure: (page) => probe(page, ".lg-card-panel", ["borderTopColor"]),
      target: ".lg-card-panel border-top-color (pre-existing write design.cardPanel.border, theme.ts:1392, styles.ts:2002 — CardPanel container this fixture's sections never render, styles.ts:639 comment; bonus corroboration, expected ABSENT)",
    },
  },
  {
    key: "card_defaults.radius",
    group: "card_defaults",
    sub: "radius",
    label: "Card corners — quotes-tabs/themes.ts:241",
    valueA: "sm",
    valueB: "full",
    depth: 0,
    measure: (page) => probe(page, ".lg-question-card", ["borderRadius"]),
    target: ".lg-question-card border-radius (R2 P8 M2: design.questionCard.borderRadius = design.radius[cd.radius], theme.ts:1389)",
    secondary: {
      depth: 0,
      measure: (page) => probe(page, ".lg-disclosure-panel", ["borderRadius"]),
      target: ".lg-disclosure-panel border-radius (pre-existing write design.content.cardRadius, theme.ts:1385 — disclosure MODAL panel, hidden until toggled; bonus corroboration)",
    },
  },
  {
    key: "card_defaults.shadow",
    group: "card_defaults",
    sub: "shadow",
    label: "Card shadow — quotes-tabs/themes.ts:242",
    valueA: "none",
    valueB: "xl",
    depth: 0,
    measure: (page) => probe(page, ".lg-question-card", ["boxShadow"]),
    target: ".lg-question-card box-shadow (R2 P8 M2: design.questionCard.boxShadow = shadowStepValue(baseDesign, cd.shadow), theme.ts:1407-1408 — explicit step wins over scales.shadow by design, theme.ts:1397-1406)",
    secondary: {
      depth: 0,
      measure: (page) => probe(page, ".lg-disclosure-panel", ["boxShadow"]),
      target: ".lg-disclosure-panel box-shadow (shadow.xl scale token, not this key's own consumer; bonus corroboration only)",
    },
  },

  // === field_defaults — 1 (ThemeFieldDefaults, theme.ts:536-538) =============
  {
    key: "field_defaults.min_height",
    group: "field_defaults",
    sub: "min_height",
    label: "Field height — quotes-tabs/themes.ts:228",
    valueA: "small",
    valueB: "large",
    depth: 1,
    measure: (page) => probe(page, "#lg-addr-p8_addr_street", ["minHeight"]),
    target: "#lg-addr-p8_addr_street min-height (applyFieldHeightStep -> design.input.minHeight, theme.ts:1422-1426, styles.ts:1827 — SAME applier ThemeRecord's controls.field_height uses)",
  },
];

// ---------------------------------------------------------------------------

async function measureAtFreshContext(browser, depth, fn) {
  const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
  try {
    const p = await ctx.newPage();
    await load(p, depth);
    return await fn(p);
  } finally {
    await ctx.close().catch(() => {});
  }
}

function decide(entry, a, b, ia, ib) {
  if (entry.isCount) return a === b ? "DEAD" : "ALIVE";
  const va = valueOf(a);
  const vb = valueOf(b);
  const visA = isVisible(a);
  const visB = isVisible(b);
  const anyVisible = visA || visB;
  const actualMoved = anyVisible && va !== null && vb !== null && va !== vb;
  if (!actualMoved) {
    if (!anyVisible) return entry.deadReason ? "DEAD" : "UNMEASURABLE";
    return "DEAD"; // visible, reachable, did not move
  }
  if (entry.impliedMeasure) {
    const via = valueOf(ia);
    const vib = valueOf(ib);
    const impliedVisible = isVisible(ia) || isVisible(ib);
    const impliedConstant = !impliedVisible || via === vib;
    return impliedConstant ? "MIS-TARGETED" : "ALIVE";
  }
  return "ALIVE";
}

async function runKey(browser, entry) {
  const notes = [];
  let a = "n/a";
  let b = "n/a";
  let ia;
  let ib;
  let sa;
  let sb;
  let verdict;

  // S3.8 — entries that need a REAL operator-route state authored before
  // measuring (a frame patch / section-content patch / a new attached
  // section) declare setup()/teardown(); every OTHER key leaves both
  // undefined and this block is a total no-op (I5 — the 29 already-measured
  // rows are byte-unaffected). teardown ALWAYS runs once setup ran, success
  // or failure (I3 — restore on failure too), via the finish() wrapper below.
  let setupOk = true;
  if (entry.setup) {
    try {
      await entry.setup(notes);
    } catch (e) {
      setupOk = false;
      notes.push(`${entry.key} setup failed: ${redact((e && e.message) || e)}`);
    }
  }
  const finish = async (result) => {
    if (entry.teardown) {
      try {
        await entry.teardown(notes);
      } catch (e) {
        notes.push(`${entry.key} teardown failed: ${redact((e && e.message) || e)}`);
      }
    }
    return result;
  };
  if (!setupOk) {
    verdict = entry.deadReason ? "DEAD" : "UNMEASURABLE";
    return finish({ entry, a, b, ia, ib, sa, sb, verdict, notes });
  }

  if (!entry.measure) {
    // No reachable measurement on this fixture. STILL write both arms to
    // prove the write path itself (a PUT round-trip alone cannot distinguish
    // "wrote fine, nothing paints it" from "never wrote") — the same
    // discipline verify-themerecord-keys.mjs documents for its own DEAD/
    // UNMEASURABLE rows.
    try {
      await withRetry(() => putTheme(armTheme(entry, entry.valueA)), `${entry.key} PUT A`, notes);
      await withRetry(() => putTheme(armTheme(entry, entry.valueB)), `${entry.key} PUT B`, notes);
      verdict = entry.deadReason ? "DEAD" : "UNMEASURABLE";
    } catch (e) {
      verdict = entry.deadReason ? "DEAD" : "UNMEASURABLE";
      notes.push(`harness error (write path): ${redact((e && e.message) || e)}`);
    }
    return finish({ entry, a, b, ia, ib, sa, sb, verdict, notes });
  }

  let context;
  try {
    context = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    await withRetry(() => putTheme(armTheme(entry, entry.valueA)), `${entry.key} PUT A`, notes);
    await withRetry(() => load(page, entry.depth), `${entry.key} load A`, notes);
    a = await withRetry(() => entry.measure(page), `${entry.key} measure A`, notes);
    if (entry.impliedMeasure) ia = await withRetry(() => entry.impliedMeasure(page), `${entry.key} implied A`, notes);
    if (entry.secondary) {
      try {
        sa = await withRetry(
          () => measureAtFreshContext(browser, entry.secondary.depth, entry.secondary.measure),
          `${entry.key} secondary A`,
          notes,
        );
      } catch (e2) {
        sa = "n/a (probe failed, non-fatal)";
        notes.push(`${entry.key} secondary A: giving up (non-fatal, bonus corroboration only): ${redact((e2 && e2.message) || e2)}`);
      }
    }

    await withRetry(() => putTheme(armTheme(entry, entry.valueB)), `${entry.key} PUT B`, notes);
    await withRetry(() => load(page, entry.depth), `${entry.key} load B`, notes);
    b = await withRetry(() => entry.measure(page), `${entry.key} measure B`, notes);
    if (entry.impliedMeasure) ib = await withRetry(() => entry.impliedMeasure(page), `${entry.key} implied B`, notes);
    if (entry.secondary) {
      try {
        sb = await withRetry(
          () => measureAtFreshContext(browser, entry.secondary.depth, entry.secondary.measure),
          `${entry.key} secondary B`,
          notes,
        );
      } catch (e2) {
        sb = "n/a (probe failed, non-fatal)";
        notes.push(`${entry.key} secondary B: giving up (non-fatal, bonus corroboration only): ${redact((e2 && e2.message) || e2)}`);
      }
    }

    verdict = decide(entry, a, b, ia, ib);
  } catch (e) {
    verdict = entry.deadReason ? "DEAD" : "UNMEASURABLE";
    notes.push(`harness error: ${redact((e && e.message) || e)}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }
  return finish({ entry, a, b, ia, ib, sa, sb, verdict, notes });
}

async function main() {
  // --- harness setup (failures here are the ONLY exit-1 case) --------------
  try {
    const res = await fetch(`${LG_BASE}${FUNNEL_PATH}`, { headers: { "user-agent": REAL_UA, host: SITE_HOST } });
    if (!res.ok && res.status !== 403) {
      // A 403 here (no Host-based routing on a plain :8901 GET) is expected
      // and does not mean the server is down; anything else worth a warning.
      console.error(`WARNING: preflight GET ${LG_BASE}${FUNNEL_PATH} -> HTTP ${res.status} (continuing)`);
    }
  } catch (e) {
    console.error(`FATAL: cannot reach ${LG_BASE} — is the conductor's wrangler dev up on :8901?`);
    console.error(redact((e && e.message) || e));
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
    console.error(redact((e && e.message) || e));
    process.exit(1);
  }

  console.log(`# P8-3 S3.4 — 34-key INLINE theme_json sweep, ${new Date().toISOString()}`);
  console.log(
    `funnel ${FUNNEL_ID}  ·  write path PUT /funnels/:id/theme (FULL theme_json)  ·  page /lg/r2fix (fresh ?_cb per load)`,
  );
  console.log(`enumeration: 14 palette + 4 typography + 3 scales + 8 button_defaults + 4 card_defaults + 1 field_defaults = ${KEYS.length} keys`);
  console.log("");

  const results = [];
  try {
    for (const entry of KEYS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runKey(browser, entry);
      results.push(r);
      console.log(`## ${r.entry.key}   [${r.verdict}]`);
      console.log(`   label: ${r.entry.label}`);
      if (!r.entry.measure) {
        const basis = r.entry.deadReason
          ? `DEAD basis: ${r.entry.deadReason}`
          : `UNMEASURABLE basis: ${r.entry.reason}`;
        console.log(`   ${basis}`);
      } else {
        console.log(`   target: ${r.entry.target}`);
        console.log(`   arm A (${JSON.stringify(r.entry.valueA)}): ${fmt(r.a)}`);
        console.log(`   arm B (${JSON.stringify(r.entry.valueB)}): ${fmt(r.b)}`);
        if (r.entry.impliedMeasure) {
          console.log(`   LABEL IMPLIES: ${r.entry.impliedTarget}`);
          console.log(`     implied A: ${fmt(r.ia)}`);
          console.log(`     implied B: ${fmt(r.ib)}`);
        }
        if (r.entry.secondary) {
          console.log(`   SECONDARY (bonus, non-decision): ${r.entry.secondary.target}`);
          console.log(`     secondary A: ${fmt(r.sa)}`);
          console.log(`     secondary B: ${fmt(r.sb)}`);
        }
      }
      if (r.notes.length > 0) {
        console.log("   harness notes:");
        for (const n of r.notes) console.log(`     - ${n}`);
      }
      console.log("");
    }
  } finally {
    try {
      await putTheme(RESTORE);
      console.log(`restored funnel theme to ${JSON.stringify(RESTORE)}`);
    } catch (e) {
      console.error(`WARNING: restore PUT failed: ${redact((e && e.message) || e)}`);
    }
    await browser.close().catch(() => {});
  }

  // --- summary table + tally -------------------------------------------------
  console.log("");
  console.log("| key | values flipped | verdict | basis |");
  console.log("|---|---|---|---|");
  const mdEscape = (v) => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const r of results) {
    const flipped = `${JSON.stringify(r.entry.valueA)} -> ${JSON.stringify(r.entry.valueB)}`;
    const basis = r.entry.measure ? r.entry.target : r.entry.deadReason ?? r.entry.reason;
    console.log(`| ${mdEscape(r.entry.key)} | ${mdEscape(flipped)} | ${mdEscape(r.verdict)} | ${mdEscape(basis)} |`);
  }

  const totals = { ALIVE: 0, DEAD: 0, "MIS-TARGETED": 0, UNMEASURABLE: 0 };
  for (const r of results) totals[r.verdict] = (totals[r.verdict] ?? 0) + 1;
  console.log("");
  console.log(
    `TOTALS: ${results.length} keys swept — ALIVE ${totals.ALIVE}, DEAD ${totals.DEAD}, MIS-TARGETED ${totals["MIS-TARGETED"]}, UNMEASURABLE ${totals.UNMEASURABLE}.`,
  );

  const allNotes = results.flatMap((r) => r.notes.map((n) => `${r.entry.key}: ${n}`));
  if (allNotes.length > 0) {
    console.log("");
    console.log("Harness notes (retries / flakes) — repeated above inline, collected here too:");
    for (const n of allNotes) console.log(`  - ${n}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("HARNESS FAILURE:", redact((e && e.message) || e));
  process.exit(1);
});
