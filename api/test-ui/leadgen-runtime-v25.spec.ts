// LeadGen v2.5.1 Phase E (slice E3) — 15 §15.3 "Runtime (live `/lg` fixtures)":
// ALL SIX rows as real-browser tests over LIVE activated /lg pages (fixtures
// seeded through the REAL admin APIs in leadgen-e-seed.ts — no direct DB
// writes, no admin-preview stand-ins; every navigation is a tenant-host /lg
// page served by wrangler dev).
//
//   ① frame identical across 3 Sections while units differ — a REAL DOM
//     subtree diff: at slides 1/2/3 every `[data-frame-region]` subtree's
//     outerHTML is captured (clone-normalized per the DOCUMENTED list below)
//     and asserted BYTE-EQUAL region-by-region, while the swapped unit
//     payloads are asserted pairwise DISTINCT.
//   ② logo from activated site — TWO branded sites, two logos, ONE Quote
//     activated on both with per-site slugs; each host's /lg serves ITS OWN
//     site's logo (src carries that site's uploaded storage key, alt its site
//     name) around the SAME quote (root data-quote-id equal on both hosts).
//   ③ progress advances by section order — answers + Continue through the
//     real engine; the ONE frame-owned [data-lg-progress] mount's
//     aria-valuenow strictly increases 1 → 2 → 3 (aria-valuemax pinned at 3).
//   ④ footer/disclosure persist across slides — both regions present with
//     their authored content at EVERY step of the traversal.
//   ⑤ a below_unit funnel renders exactly ONE [data-lg-continue] per slide,
//     below the unit card (C3 / 11 §11.5): every section subtree carries
//     exactly one control, at the END of the subtree inside .lg-continue-slot
//     (after the question unit); an authored ContinueButton node's visual is
//     suppressed and its props feed the slot control; the slot control drives
//     a real engine advance.
//   ⑥ frame=null funnel renders exactly as before — the committed pin fixture
//     (test/fixtures/leadgen-legacy-pin/legacy-shell.html) is the byte truth:
//     a LIVE legacy funnel mirroring the pin funnel (same quote name/content/
//     API sequence, seeded via leadgen-e-seed.seedLegacyPinLiveFunnel) serves
//     a body that byte-equals the fixture after EXACTLY the documented
//     normalizations below.
//
// ROW-① NORMALIZATION LIST (each entry is an ENGINE-stamped step artifact —
// runtime/render.ts + engine.ts — i.e. state the frame is CONTRACTED to change
// per step; everything else in every frame region must be byte-identical):
//   N1 `aria-valuenow` + `data-lg-progress-current` on [data-lg-progress]
//      mounts → "«step»" (render.ts updateProgress stamps the 1-based step).
//   N2 [data-lg-progress-label] textContent → "«step-label»" (updateProgress
//      writes "N / M" into the label sink each step).
//   N3 [data-lg-progress-bar] style width → "0%" (updateProgress sets
//      bar.style.width = pct% per step; assigning via CSSOM here keeps the
//      whole style attribute's serialization identical across captures).
//   N4 `.lg-step[data-active]` → attribute removed (updateProgress re-stamps
//      the active dot per step; defensive — the fixture uses style "bar").
//   N5 `hidden` on [data-lg-back] → removed (engine.ts enterSection →
//      render.ts setBackVisible: hidden on slide 1's empty back stack, shown
//      after — 11 §11.2 engine-owned visibility).
//   N6 the section_slot's `main[data-lg-mount]` INNER content → a fixed
//      placeholder comment. The mount's children ARE the swapped `<section
//      data-lg-section>` unit payloads + banners mount — the exact content
//      row ① requires to DIFFER (asserted separately); the mount ELEMENT, the
//      slot wrapper, and the in-card chrome around it stay in the comparison.
//   N7 `aria-valuetext` on [data-lg-progress] mounts that CARRY it →
//      "«step-text»" (render.ts updateProgress re-stamps the SSR "Step X of Y"
//      copy per step — the E3 a11y fix). Conditional on the attr being
//      present: a mount that never SSR'd one must never gain one, so the
//      normalizer leaves absent attrs absent and the diff still catches a
//      wrongly-added attribute.
//   (No other engine step-write exists on frame regions: footer show_on:"all"
//   is a visibility no-op, selection classes/validation errors live inside
//   the replaced unit payload, focus writes no attribute.)
//
// ROW-⑥ NORMALIZATION LIST (exactly the variance the admin-API seed path
// cannot eliminate — the pin eliminated it with direct-SQL fixed ids, which
// the e2e seed convention forbids):
//   P1 minted lgq_/lgf_/lgn_ ULIDs → the pin's own placeholder rule, copied
//      VERBATIM from test/leadgen-frame-legacy-pin.test.ts (prefix + 24×"L" +
//      2-digit first-appearance ordinal; "L" is outside Crockford so a
//      placeholder can never re-match).
//   P2 the three MINTED lgs_ section ids → the pin's fixed
//      lgs_…PNSEC01/02/03, POSITIONALLY (variant order), each asserted to
//      occur EXACTLY twice (section wrapper + #lg-config row) before the swap.
//   P3 the live `section_order_hash` (64-hex, hashed over the minted section
//      ids of P2, so it inherits exactly their variance) → the fixture's
//      pinned hash; asserted to occur exactly once, both values shape-checked.
//   Everything else — title/funnel_name, chrome CSS, every section's rendered
//   markup incl. the legacy duplicate-headline quirk, #lg-config fields,
//   content_version, assignment splice, sentinels — is compared RAW.
//
// ROW-② HOST MECHANICS: chromium launches with
// `--host-resolver-rules=MAP *.e2e.test 127.0.0.1`, so page.goto
// (`http://<site-host>:<PW_PORT>/lg/<slug>`) carries the real tenant Host
// header to the local wrangler dev worker (host→site public middleware).
// Node-side wire reads (row ⑥) send an explicit `Host: <site-host>:<PW_PORT>`
// header to 127.0.0.1:<PW_PORT> (default 8787; ./utils/base-url.ts) — the
// leadgen-runtime/leadgen-live-funnel idioms.
//
// DEV-GUARD: every context uses a realistic Chrome UA (the /lg runtime guard's
// bot arm must never trip — the leadgen-live-funnel DEV-GUARD note).
//
// A11Y NOTE (E3-found defect, FIXED at HEAD): the frame progress mount SSRs
// `aria-valuetext="Step 1 of 3"` (presets renderProgressBar) and render.ts
// updateProgress used to re-stamp only aria-valuenow/current/total + the
// label text, leaving valuetext stale on slides 2/3 — screen readers prefer
// valuetext, so they heard "Step 1 of 3" throughout. updateProgress now
// re-stamps the SSR copy per step on mounts that carry the attribute:
// asserted live in row ③, normalized as N7 in row ①.
//
// Local state must be reset once:
// `npm run db:reset:local`.

import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadPng } from "./listicles-p6-seed";
import {
  activateQuoteOnSite,
  seedBelowUnitSections,
  seedBrandedSite,
  seedLegacyPinLiveFunnel,
  seedPatternQuote,
  seedRuntimeUnitSections,
  type LegacyPinLiveFunnel,
  type PatternScaffold,
  type PatternSite,
  type RuntimeSectionSeed,
} from "./leadgen-e-seed";
import { PW_PORT } from "./utils/base-url";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  viewport: { width: 1280, height: 900 },
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// The b-seed vocabulary — plain strings the admin APIs accept without a feeder
// Offer (E3 never drives the studio dropdowns).
const ACT = "quote_funnel";
const VERT = "life";

// Per-site slugs (row ②: ONE quote, TWO sites, per-site slugs).
const SLUG_A = `e3-rt-a-${uniq}`;
const SLUG_B = `e3-rt-b-${uniq}`;
const SLUG_BELOW = `e3-bu-${uniq}`;

// Shared fixtures (seeded once through the REAL admin APIs).
let siteA: PatternSite;
let siteB: PatternSite;
let runtimeSections: RuntimeSectionSeed[];
let framed: PatternScaffold;
let belowUnit: PatternScaffold;
let legacy: LegacyPinLiveFunnel;

test.beforeAll(async () => {
  const ctx = await playwrightRequest.newContext({
    baseURL: ORIGIN,
    extraHTTPHeaders: { "User-Agent": REAL_CHROME_UA },
  });

  // Rows ①–④: two branded sites (distinct logos) + the 3-distinct-unit framed
  // funnel, ONE quote activated on BOTH sites.
  siteA = await seedBrandedSite(ctx, `${uniq}a`);
  siteB = await seedBrandedSite(ctx, `${uniq}b`);
  const trust1 = await uploadPng(ctx, `e3-trust-1-${uniq}.png`);
  const trust2 = await uploadPng(ctx, `e3-trust-2-${uniq}.png`);
  runtimeSections = await seedRuntimeUnitSections(ctx, { uniq, activity: ACT, vertical: VERT });
  framed = await seedPatternQuote(ctx, {
    name: `E3 Runtime Quote ${uniq}`,
    activity: ACT,
    vertical: VERT,
    sectionIds: runtimeSections.map((s) => s.id),
    // The COMPLETE target frame via the REAL PUT (E3 is runtime-only — frame
    // AUTHORING through the UI is E1/B4 ground). Explicit positions keep the
    // region layout deliberate: progress under_header (bar + label), back
    // in_card, disclosure top_bar, manual footer (row ④ content), manual
    // trust strip below_unit, tagline + secure badge in the logo band.
    frame: {
      version: 1,
      template: "centered",
      header: {
        tagline: "Compare and save in minutes",
        secure_badge: { enabled: true, text: "Secure & confidential" },
      },
      progress: { style: "bar", position: "under_header", show_label: true },
      back: { style: "text", position: "in_card", label: "Back" },
      disclosure: {
        enabled: true,
        location: "top_bar",
        link_label: "Advertising Disclosure",
        text: "We may receive compensation from our partners.",
      },
      footer: {
        enabled: true,
        show_on: "all",
        links_source: "manual",
        links: [
          { label: "Privacy", href: "/privacy" },
          { label: "Terms", href: "/terms" },
        ],
        trust_text: "Licensed advisor network",
        description: "© 2026 E3 Runtime Co. Coverage subject to underwriting.",
      },
      trust_strip: {
        enabled: true,
        source: "manual",
        logos: [
          { media_id: trust1.storage_key, alt: "Trust brand one" },
          { media_id: trust2.storage_key, alt: "Trust brand two" },
        ],
        placement: "below_unit",
      },
    },
  });
  await activateQuoteOnSite(ctx, framed.quotePublicId, siteA.id, SLUG_A);
  await activateQuoteOnSite(ctx, framed.quotePublicId, siteB.id, SLUG_B);

  // Row ⑤: the below_unit funnel (frame PUT sets ONLY the placement knob —
  // sparse config, template defaults elsewhere; slot card stays "card").
  const belowSections = await seedBelowUnitSections(ctx, { uniq, activity: ACT, vertical: VERT });
  belowUnit = await seedPatternQuote(ctx, {
    name: `E3 Below-Unit Quote ${uniq}`,
    activity: ACT,
    vertical: VERT,
    sectionIds: belowSections.map((s) => s.id),
    frame: { version: 1, template: "centered", section_slot: { continue_placement: "below_unit" } },
  });
  await activateQuoteOnSite(ctx, belowUnit.quotePublicId, siteA.id, SLUG_BELOW);

  // Row ⑥: the live legacy (frame = NULL) pin-mirror funnel on its own site.
  legacy = await seedLegacyPinLiveFunnel(ctx, uniq);

  await ctx.dispose();
});

// ---------------------------------------------------------------------------
// Driving helpers (the leadgen-live-funnel /lg idioms)
// ---------------------------------------------------------------------------

async function gotoReady(page: Page, host: string, slug: string): Promise<void> {
  await page.goto(`http://${host}:${PW_PORT}/lg/${slug}`, { waitUntil: "load" });
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, {
    timeout: 15_000,
  });
}

function sectionAt(page: Page, index: number) {
  return page.locator(`[data-lg-section][data-lg-index="${index}"]`);
}

// Answer the CURRENT section's question and advance via its Continue control —
// a real engine traversal step (choice click → validation → advance).
async function answerAndContinue(page: Page, index: number, choiceValue: string): Promise<void> {
  const current = sectionAt(page, index);
  await current.locator(`[data-lg-choice="${choiceValue}"]`).first().click();
  await current.locator("[data-lg-continue]").click();
  await expect(sectionAt(page, index + 1)).toBeVisible();
  await expect(current).toBeHidden();
}

// R2 P6 terminal clearance (ruling R-C) — the ONE permitted shift.
// §4.3-1/§4.3-15 make a shared FIRST page mandatory, and seedPatternQuote
// satisfies it with a ContinueButton-only page (leadgen-e-seed.ts
// seedTrivialSharedPage). Every funnel these rows drive therefore serves that
// shared page as slide 0, and the authored sections keep their own relative
// order one index later. This helper advances past it — a real engine step on
// the real control, never a skipped assertion.
async function passSharedFirstPage(page: Page): Promise<void> {
  const shared = sectionAt(page, 0);
  await expect(shared, "the mandatory §4.3-1 shared first page is slide 0").toBeVisible();
  await shared.locator("[data-lg-continue]").click();
  await expect(sectionAt(page, 1)).toBeVisible();
  await expect(shared).toBeHidden();
}

// The row-①/③/④ traversal answers (authored section order: YesNo → icon cards;
// the LAST slide is never advanced past — that would trigger the auction,
// §3.5.6). Indices are 1-based-into-the-DOM because of the shared page above.
const TRAVERSAL: ReadonlyArray<{ index: number; choice: string }> = [
  { index: 1, choice: "true" },
  { index: 2, choice: "self" },
];

// ---------------------------------------------------------------------------
// Row ① capture: every [data-frame-region] subtree, clone-normalized per the
// header's N1–N6 list, keyed by region name (multiple elements of one name
// concatenate in document order). A REAL subtree comparison — full outerHTML
// bytes, never spot checks.
// ---------------------------------------------------------------------------

const UNIT_PLACEHOLDER_COMMENT = "E3-UNIT-PAYLOAD";

interface FrameCapture {
  regions: Record<string, string>;
  counts: Record<string, number>;
}

async function captureFrameRegions(page: Page): Promise<FrameCapture> {
  return page.evaluate((placeholderComment) => {
    const regions: Record<string, string> = {};
    const counts: Record<string, number> = {};
    const matchAll = (root: HTMLElement, selector: string): HTMLElement[] => {
      const list = Array.from(root.querySelectorAll<HTMLElement>(selector));
      if (root.matches(selector)) list.unshift(root);
      return list;
    };
    for (const el of Array.from(document.querySelectorAll("#lg-funnel-root [data-frame-region]"))) {
      const name = el.getAttribute("data-frame-region") ?? "";
      const clone = el.cloneNode(true) as HTMLElement;
      // N1 — engine step attrs (render.ts updateProgress).
      for (const p of matchAll(clone, "[data-lg-progress]")) {
        p.setAttribute("aria-valuenow", "«step»");
        p.setAttribute("data-lg-progress-current", "«step»");
      }
      // N2 — engine step label text.
      for (const label of matchAll(clone, "[data-lg-progress-label]")) {
        label.textContent = "«step-label»";
      }
      // N3 — engine bar width (CSSOM write keeps style serialization uniform).
      for (const bar of matchAll(clone, "[data-lg-progress-bar]")) bar.style.width = "0%";
      // N4 — engine active-dot re-stamp (defensive; bar style has no dots).
      for (const dot of matchAll(clone, ".lg-step")) dot.removeAttribute("data-active");
      // N5 — engine back visibility (render.ts setBackVisible).
      for (const back of matchAll(clone, "[data-lg-back]")) back.removeAttribute("hidden");
      // N6 — the swapped unit payload (the ONE thing the row requires to
      // differ) → a fixed comment node; the mount element itself stays.
      for (const mount of matchAll(clone, "main[data-lg-mount]")) {
        mount.replaceChildren(document.createComment(placeholderComment));
      }
      // N7 — engine valuetext re-stamp (render.ts updateProgress: a mount
      // that SSRs aria-valuetext gets the "Step X of Y" copy re-stamped per
      // step — the E3 a11y fix). Conditional so a mount without the attr
      // that wrongly gained one would still diff.
      for (const p of matchAll(clone, "[data-lg-progress]")) {
        if (p.hasAttribute("aria-valuetext")) p.setAttribute("aria-valuetext", "«step-text»");
      }
      regions[name] = (regions[name] ?? "") + clone.outerHTML;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return { regions, counts };
  }, UNIT_PLACEHOLDER_COMMENT);
}

// The visible slide's identity + unit payload (the "units differ" side).
async function captureVisibleUnit(page: Page): Promise<{ sectionId: string; html: string }> {
  return page.evaluate(() => {
    const visible = Array.from(
      document.querySelectorAll("section[data-lg-section]:not([hidden])"),
    );
    if (visible.length !== 1) {
      throw new Error(`expected exactly one visible section, saw ${visible.length}`);
    }
    const el = visible[0] as HTMLElement;
    return { sectionId: el.getAttribute("data-lg-section-id") ?? "", html: el.innerHTML };
  });
}

// ---------------------------------------------------------------------------
// Row ⑥ normalizer — P1 is the pin's rule VERBATIM
// (test/leadgen-frame-legacy-pin.test.ts normalizeLegacyPin).
// ---------------------------------------------------------------------------

const LIVE_ID_RE = /\b(lgq|lgf|lgn)_[0-9A-HJKMNP-TV-Z]{26}\b/g;

function normalizeMintedIds(text: string): string {
  const seen = new Map<string, string>();
  return text.replace(LIVE_ID_RE, (match, prefix: string) => {
    let placeholder = seen.get(match);
    if (placeholder === undefined) {
      placeholder = `${prefix}_${"L".repeat(24)}${String(seen.size + 1).padStart(2, "0")}`;
      seen.set(match, placeholder);
    }
    return placeholder;
  });
}

function pinnedSectionId(n: number): string {
  return `lgs_${"0".repeat(19)}PNSEC${String(n).padStart(2, "0")}`;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const ORDER_HASH_RE = /"section_order_hash":"([0-9a-f]{64})"/;

// Readable first-divergence report (the pin test's reporting idea, compact).
function firstDiffReport(expected: string, actual: string): string {
  let i = 0;
  const n = Math.min(expected.length, actual.length);
  while (i < n && expected.charCodeAt(i) === actual.charCodeAt(i)) i += 1;
  const around = (s: string): string => JSON.stringify(s.slice(Math.max(0, i - 80), i + 140));
  return [
    `row ⑥: live legacy shell DIVERGED from the committed pin fixture`,
    `(fixture ${expected.length} chars, live-normalized ${actual.length} chars; first diff at char ${i}):`,
    `  fixture …${around(expected)}…`,
    `  live    …${around(actual)}…`,
  ].join("\n");
}

// ===========================================================================

test.describe("LeadGen v2.5.1 §15.3 Runtime rows — live /lg fixtures (E3)", () => {
  test("① frame identical across 3 Sections while units differ — DOM diff of frame regions is empty", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoReady(page, siteA.host, SLUG_A);

    // R2 P6 (ruling R-C): step off the mandatory shared first page, then
    // capture the THREE authored Sections exactly as this row always did.
    await passSharedFirstPage(page);

    // Slide 1 capture, then drive the REAL engine to slides 2 and 3.
    const captures: FrameCapture[] = [];
    const units: Array<{ sectionId: string; html: string }> = [];
    const progress = page.locator("[data-lg-progress]");
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
    captures.push(await captureFrameRegions(page));
    units.push(await captureVisibleUnit(page));
    for (const step of TRAVERSAL) {
      await answerAndContinue(page, step.index, step.choice);
      await expect(progress).toHaveAttribute("aria-valuenow", String(step.index + 2));
      captures.push(await captureFrameRegions(page));
      units.push(await captureVisibleUnit(page));
    }

    // The frame surface: the same REGION SET on every slide (this fixture's
    // configured regions, by name), same element count per region.
    const expectedRegions = [
      "back",
      "background",
      "disclosure",
      "footer",
      "logo",
      "progress",
      "section_slot",
      "trust_strip",
    ];
    for (const capture of captures) {
      expect(Object.keys(capture.regions).sort()).toEqual(expectedRegions);
    }
    expect(captures[1]!.counts).toEqual(captures[0]!.counts);
    expect(captures[2]!.counts).toEqual(captures[0]!.counts);

    // THE row assertion — region-by-region BYTE equality of the normalized
    // subtree HTML across all three slides (empty DOM diff).
    for (const name of expectedRegions) {
      const slide1 = captures[0]!.regions[name]!;
      expect(slide1.length, `region '${name}' capture is non-trivial`).toBeGreaterThan(0);
      expect(captures[1]!.regions[name], `frame region '${name}': slide 2 vs slide 1`).toBe(slide1);
      expect(captures[2]!.regions[name], `frame region '${name}': slide 3 vs slide 1`).toBe(slide1);
    }

    // …while the UNIT content genuinely differs: the three visible payloads
    // are the three seeded sections in order, pairwise distinct, each carrying
    // its own component type.
    expect(units.map((u) => u.sectionId)).toEqual(runtimeSections.map((s) => s.publicId));
    expect(units[0]!.html).toContain('data-component-type="TwoButtonYesNo"');
    expect(units[1]!.html).toContain('data-component-type="IconCardAnswerGrid"');
    expect(units[2]!.html).toContain('data-component-type="ButtonAnswerGroup"');
    expect(units[0]!.html).not.toBe(units[1]!.html);
    expect(units[1]!.html).not.toBe(units[2]!.html);
    expect(units[0]!.html).not.toBe(units[2]!.html);
  });

  test("② logo from activated site — two sites, two logos, one Quote", async ({ page }) => {
    test.setTimeout(90_000);

    // Host A serves site A's uploaded logo around the shared quote.
    await gotoReady(page, siteA.host, SLUG_A);
    const logoImg = page.locator('[data-frame-region="logo"] img.lg-logo-img');
    await expect(logoImg).toBeVisible();
    const srcA = await logoImg.getAttribute("src");
    expect(srcA, "host A logo src carries site A's uploaded storage key").toContain(siteA.logoKey);
    await expect(logoImg).toHaveAttribute("alt", siteA.name);
    expect(await page.locator("#lg-funnel-root").getAttribute("data-quote-id")).toBe(
      framed.quotePublicId,
    );

    // Host B — the SAME quote — serves site B's logo.
    await gotoReady(page, siteB.host, SLUG_B);
    await expect(logoImg).toBeVisible();
    const srcB = await logoImg.getAttribute("src");
    expect(srcB, "host B logo src carries site B's uploaded storage key").toContain(siteB.logoKey);
    await expect(logoImg).toHaveAttribute("alt", siteB.name);
    expect(await page.locator("#lg-funnel-root").getAttribute("data-quote-id")).toBe(
      framed.quotePublicId,
    );

    // Two DISTINCT logos for one quote (the per-site branding proof).
    expect(srcA).not.toBe(srcB);
  });

  test("③ progress advances by section order — aria-valuenow strictly increases 1 → 2 → 3", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoReady(page, siteA.host, SLUG_A);

    // Exactly ONE frame-owned progress mount on the page (11 §11.1).
    const progress = page.locator("[data-lg-progress]");
    await expect(progress).toHaveCount(1);
    await expect(progress).toHaveAttribute("role", "progressbar");

    const observed: number[] = [];
    const readNow = async (): Promise<number> => {
      const value = await progress.getAttribute("aria-valuenow");
      const current = await progress.getAttribute("data-lg-progress-current");
      expect(current, "data-lg-progress-current mirrors aria-valuenow").toBe(value);
      return Number(value);
    };

    // R2 P6 (ruling R-C): the mandatory §4.3-1 shared first page is a real
    // step, so the funnel is 4 slides deep and the progress mount reports
    // valuemax 4. The claim is unchanged and now covers one MORE step:
    // aria-valuenow strictly increases 1 → 2 → 3 → 4 in section order.
    await expect(progress).toHaveAttribute("aria-valuemax", "4");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    observed.push(await readNow());
    await passSharedFirstPage(page);
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
    await expect(progress).toHaveAttribute("aria-valuemax", "4");
    observed.push(await readNow());
    for (const step of TRAVERSAL) {
      await answerAndContinue(page, step.index, step.choice);
      await expect(progress).toHaveAttribute("aria-valuenow", String(step.index + 2));
      await expect(progress).toHaveAttribute("aria-valuemax", "4");
      observed.push(await readNow());
    }

    // Strictly increasing, in section order, over the full variant length.
    expect(observed).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < observed.length; i += 1) {
      expect(observed[i]!, `step ${i + 1} strictly greater than step ${i}`).toBeGreaterThan(
        observed[i - 1]!,
      );
    }

    // The E3-found valuetext staleness is FIXED at HEAD (header A11Y note):
    // updateProgress re-stamps mounts that SSR aria-valuetext, so slide 3
    // reads the CURRENT step — asserted, no longer a logged observation.
    await expect(progress).toHaveAttribute("aria-valuetext", "Step 4 of 4");
  });

  test("④ footer and disclosure persist across slides — present at every step", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoReady(page, siteA.host, SLUG_A);

    const footer = page.locator('[data-frame-region="footer"]');
    const disclosure = page.locator('[data-frame-region="disclosure"]');

    const assertChromePresent = async (slide: number): Promise<void> => {
      await expect(footer, `footer visible on slide ${slide}`).toBeVisible();
      await expect(footer.locator(".lg-footerbar-link")).toHaveCount(2);
      await expect(footer.locator(".lg-footerbar-link").nth(0)).toHaveText("Privacy");
      await expect(footer.locator(".lg-footerbar-link").nth(1)).toHaveText("Terms");
      await expect(footer.locator(".lg-footerbar-trust-item")).toHaveText(
        "Licensed advisor network",
      );
      await expect(footer.locator(".lg-footerbar-legal")).toContainText("© 2026 E3 Runtime Co.");
      await expect(disclosure, `disclosure visible on slide ${slide}`).toBeVisible();
      await expect(disclosure.locator("button.lg-disclosure")).toHaveText(
        "Advertising Disclosure",
      );
    };

    // R2 P6 (ruling R-C): the chrome must persist on the mandatory shared
    // first page too — one MORE slide asserted than before, not one fewer.
    await assertChromePresent(1);
    await passSharedFirstPage(page);
    await assertChromePresent(2);
    for (const step of TRAVERSAL) {
      await answerAndContinue(page, step.index, step.choice);
      await assertChromePresent(step.index + 2);
    }
  });

  test("⑤ below_unit funnel — exactly one Continue per slide, below the unit card (C3)", async ({ page }) => {
    test.setTimeout(90_000);
    await gotoReady(page, siteA.host, SLUG_BELOW);

    // The unit rides a CARD slot (the "below the unit card" composition).
    await expect(page.locator('[data-frame-region="section_slot"]')).toHaveClass(
      /lg-frame-slot--card/,
    );

    // DOM shape over EVERY slide's subtree (hidden ones included): exactly one
    // [data-lg-continue], inside .lg-continue-slot, at the END of the section
    // subtree, AFTER the question unit (11 §11.5 / C3).
    // R2 P6 (ruling R-C): 3 slides now — the mandatory §4.3-1 shared first
    // page plus the two authored ones. The C3 "exactly one control, in the
    // slot, at the END, below the unit" shape is asserted on ALL THREE (one
    // more slide than before), so the shift strengthens the row.
    const sections = page.locator("section[data-lg-section]");
    await expect(sections).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      const section = sections.nth(i);
      await expect(section.locator("[data-lg-continue]"), `slide ${i + 1} control count`).toHaveCount(1);
      await expect(section.locator(".lg-continue-slot [data-lg-continue]")).toHaveCount(1);
      const shape = await section.evaluate((el) => {
        const slot = el.querySelector(".lg-continue-slot");
        const question = el.querySelector("[data-lg-question]");
        return {
          slotIsLastChild: el.lastElementChild === slot,
          slotAfterQuestion:
            slot !== null &&
            question !== null &&
            (question.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        };
      });
      expect(shape.slotIsLastChild, `slide ${i + 1}: slot is the END of the section subtree`).toBe(true);
      if (i === 0) {
        // R2 P6 (ruling R-C): slide 0 is the mandatory §4.3-1 shared first
        // page, a ContinueButton-only section with NO question unit, so
        // "the slot sits BELOW the unit" has no unit to be below. Assert the
        // part that IS meaningful there — no question unit at all, and the one
        // control still lives in the slot at the END of the subtree (checked
        // above for every slide, this one included). The two AUTHORED slides
        // keep the full C3 assertion, exactly as before this shift.
        await expect(section.locator("[data-lg-question]"), "the shared first page carries no question unit").toHaveCount(0);
      } else {
        expect(shape.slotAfterQuestion, `slide ${i + 1}: slot sits BELOW the question unit`).toBe(true);
      }
    }

    // Slide 1's authored ContinueButton node: in-node visual suppressed (count
    // above is already 1) and its props feed the ONE slot control.
    const visibleContinue = page.locator(
      "section[data-lg-section]:not([hidden]) [data-lg-continue]",
    );
    // R2 P6 (ruling R-C): slide 0 is now the shared first page, so the
    // authored "Keep going" slide is reached one step later. Step off the
    // shared page on its own real slot control first — which also proves the
    // shared page obeys the same one-control invariant live.
    await expect(visibleContinue).toHaveCount(1);
    await passSharedFirstPage(page);
    await expect(visibleContinue).toHaveCount(1);
    await expect(visibleContinue).toHaveText("Keep going");

    // The slot control is the REAL advance affordance: answer + click → the
    // next slide, whose node-less unit renders the theme-default copy — still
    // exactly one.
    await sectionAt(page, 1).locator('[data-lg-choice="home"]').click();
    await visibleContinue.click();
    await expect(sectionAt(page, 2)).toBeVisible();
    await expect(sectionAt(page, 1)).toBeHidden();
    await expect(visibleContinue).toHaveCount(1);
    await expect(visibleContinue).toHaveText("Continue");
  });

  test("⑥ frame=null funnel renders exactly as before — served body byte-equals the committed pin fixture", async ({ page }) => {
    test.setTimeout(90_000);
    const fixturePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "test",
      "fixtures",
      "leadgen-legacy-pin",
      "legacy-shell.html",
    );
    const fixture = readFileSync(fixturePath, "utf8");
    expect(fixture.length, "committed pin fixture is non-trivial").toBeGreaterThan(5000);

    // The EXACT served bytes (Node-side wire GET with the tenant Host header).
    const wire = await playwrightRequest.newContext({
      extraHTTPHeaders: { "User-Agent": REAL_CHROME_UA },
    });
    const res = await wire.get(`${ORIGIN}/lg/${legacy.slug}`, {
      headers: { Host: `${legacy.host}:${PW_PORT}` },
    });
    expect(res.status(), "live legacy shell HTTP status").toBe(200);
    const live = await res.text();
    await wire.dispose();

    // P1 — the pin's minted-id placeholder rule, verbatim.
    let normalized = normalizeMintedIds(live);
    expect(normalized.match(LIVE_ID_RE), "no unnormalized lgq/lgf/lgn id remains").toBeNull();

    // P2 — the three minted section ids → the pin's fixed ids, positionally;
    // each occurs exactly twice (the <section> wrapper + its #lg-config row).
    // P2a (R2 P6, ruling R-C) — the mandatory §4.3-1 shared first page. The
    // pin harness seeds its own shared section with the FIXED direct-SQL id
    // `lgs_` + 19×"0" + "LEGACY1" (test/leadgen-frame-legacy-pin.test.ts:399);
    // the e2e mirror can only mint a ULID for it, so it is normalized onto the
    // pin's id by the SAME positional rule P2 uses for the three variant
    // sections, with the same "exactly twice" occurrence assertion (section
    // wrapper + #lg-config row). NOT a relaxation: it ADDS a pinned id to the
    // byte-compare rather than excusing one.
    const PINNED_SHARED_ID = `lgs_${"0".repeat(19)}LEGACY1`;
    expect(legacy.sharedSectionPublicId).toMatch(/^lgs_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(
      countOccurrences(normalized, legacy.sharedSectionPublicId),
      "live shared-page section id occurrence count",
    ).toBe(2);
    normalized = normalized.split(legacy.sharedSectionPublicId).join(PINNED_SHARED_ID);

    expect(legacy.sectionPublicIds).toHaveLength(3);
    legacy.sectionPublicIds.forEach((liveId, i) => {
      expect(liveId).toMatch(/^lgs_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(
        countOccurrences(normalized, liveId),
        `live section id #${i + 1} occurrence count`,
      ).toBe(2);
      normalized = normalized.split(liveId).join(pinnedSectionId(i + 1));
    });

    // P3 — the order hash inherits exactly the section-id variance.
    const liveHash = normalized.match(ORDER_HASH_RE)?.[1];
    const pinnedHash = fixture.match(ORDER_HASH_RE)?.[1];
    expect(liveHash, "live body carries a 64-hex section_order_hash").toMatch(/^[0-9a-f]{64}$/);
    expect(pinnedHash, "fixture carries a 64-hex section_order_hash").toMatch(/^[0-9a-f]{64}$/);
    expect(countOccurrences(normalized, liveHash as string)).toBe(1);
    normalized = normalized.replace(liveHash as string, pinnedHash as string);

    // THE row assertion: byte equality with the committed pin.
    if (normalized !== fixture) {
      throw new Error(firstDiffReport(fixture, normalized));
    }
    expect(normalized).toBe(fixture);

    // Browser sanity on the SAME live page: the legacy funnel actually runs —
    // engine ready, first pinned question visible, and ZERO [data-frame-region]
    // elements in the document (the legacy shell renders none).
    await gotoReady(page, legacy.host, legacy.slug);
    // R2 P6 (ruling R-C): the pin funnel's own shared first page ("Shared",
    // question qs1) is slide 0 — in the COMMITTED FIXTURE too, verified by
    // reading it — so the pin's first authored question (q_ins) is slide 1.
    // The pin's shared section is a bare TwoButtonYesNo with NO ContinueButton
    // component, so the legacy shell renders that slide with no
    // [data-lg-continue] control (frozen legacy behaviour, which is exactly
    // what this row pins). The engine is therefore proven live by a REAL
    // answer click that the runtime records, rather than by an advance:
    await expect(page.locator('[data-lg-question="qs1"]')).toBeVisible();
    const sharedYes = page.locator('[data-lg-question="qs1"] [data-lg-choice="true"]');
    await sharedYes.click();
    await expect(sharedYes, "the engine records a real answer on the legacy shell").toHaveAttribute("aria-checked", "true");
    // …and the pin's own first authored question is present on the next slide.
    await expect(page.locator('[data-lg-question="q_ins"]')).toHaveCount(1);
    await expect(page.locator("[data-frame-region]")).toHaveCount(0);
    const mountChildren = await page
      .locator("[data-lg-mount]")
      .evaluate((el) => el.children.length);
    expect(mountChildren).toBeGreaterThan(0);
  });
});
