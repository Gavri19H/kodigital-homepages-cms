// Section Builder product-core P2a — PER-ELEMENT FREEDOM effect gate (register
// PC-11 completion / decision R-A). The operator's case, authored via API and
// measured in the REAL render: a ButtonAnswerGroup whose "Allow" choice is
// larger + a theme-palette color + strong, next to an unstyled "Disallow" (the
// theme default), plus a deliberate OFF-THEME #hex "Delete" button.
//
// EXPECTED-VALUE assertions (never a bare "changed"), on the studio canvas (the
// surface the operator edits) AND the live /lg funnel (§12 parity — the SAME
// server renderer). Mirrors leadgen-p1-geometry.gesture.spec.ts's structure:
// studio-canvas describe runs on BOTH chromium+firefox; the live-/lg describe's
// dynamic {uniq}.e2e.test host needs chromium's --host-resolver-rules, so it
// test.skip()s on firefox (firefox's network.dns.localDomains cannot resolve a
// wildcard host — the repo-wide constraint the live-funnel specs document).
//
// WHAT THIS SLICE (P2a) PROVES GREEN, presets-only:
//   • per-choice min-height (size:l → the styled choice is taller than the
//     unstyled one — in a single-column group each button owns its own grid row);
//   • per-choice emphasis (strong → font-weight 700);
//   • per-choice text color (a DIRECT inline `color`, resting-safe);
//   • per-choice resting-bg EMISSION: the choice carries the state-safe custom
//     property --lg-answer-bg == the resolved role/#hex EXACTLY (role via the
//     §9.4 pipeline; off-theme #hex verbatim);
//   • diff-only: the unstyled sibling carries NONE of the above;
//   • the SELECTED pipeline is intact + the resting override does NOT leak into
//     it (click → the theme selected wash, not the per-choice resting color).
//
// CROSS-FILE (styles.ts, P2b — landed): the RESTING background-color PAINT
// (computed) now equals the emitted --lg-answer-bg, because
// designs/default-funnel/styles.ts's `.lg-btn.lg-btn-answer` / `.lg-card`
// RESTING rules read `background: var(--lg-answer-bg, <token>)` (the
// --lg-field-border idiom). The studio-canvas describe below asserts the
// PAINTED computed background for the styled role case, the off-theme #hex
// case, AND the unstyled diff-only sibling (theme default, proving no leak) —
// the additive/back-compat invariant now reads as "styled paints the override,
// unstyled paints the theme default" rather than "nothing paints yet". P2b also
// added `align-items:start` to `.lg-answer-group`/`.lg-card-grid` so a
// multi-column group's per-choice HEIGHT variation is honored (grid's default
// stretch would otherwise equalize every cell in a row to the tallest); this
// gate's single-column group already proved the height effect presets-only, so
// no additional geometry assertion is needed here.
//
// Run per-file with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2; \
//   npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p2a-element-freedom.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p2a-element-freedom.gesture.spec.ts \
//     --project=firefox --workers=1 --reporter=line
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { defaultFunnelDesign as D } from "../src/public/leadgen/designs/default-funnel/tokens";
import { baseTokenForRole } from "../src/public/leadgen/designs/theme";
import { seedActiveSite } from "./listicles-p6-seed";
import { seedSharedFirstPage, createPassThroughSection } from "./leadgen-shared-page-seed";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();
const PORT = process.env.PW_PORT ?? "8899";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

// Resolved through the SAME pipeline the renderer uses (no drift from tokens).
const ACCENT_HEX = baseTokenForRole(D, "accent"); // #E85D26 (the operator's orange)
const OFF_THEME_HEX = "#D92D20"; // deliberate off-theme red (not in the palette)
const RESTING_WHITE = "rgb(255, 255, 255)"; // color.card — the answer-button resting bg
const CARD_TEXT = "rgb(255, 255, 255)"; // text_color_role card_background (#FFFFFF)
// P2b: the computed-style rgb() the browser reports for each authored hex —
// getComputedStyle().backgroundColor is always "rgb(r, g, b)", never a hex
// string, so the paint assertions below compare against these, not the hex.
const ACCENT_RGB = "rgb(232, 93, 38)"; // #E85D26
const OFF_THEME_RGB = "rgb(217, 45, 32)"; // #D92D20
// P2b FIX-ROUND (adversarial review R1/R2) — the theme's OWN hover/selected
// wash tokens (iconCard.hoverBorderColor/selectedBorderColor = the SAME
// #1B3A5C navy; iconCard.selectedBackground = #E8EEF4), as their computed
// rgb() — the UNSTYLED-choice live-paint regression test's expected values.
const SELECTED_BORDER_RGB = "rgb(27, 58, 92)"; // #1B3A5C (hover- and selected-border, identical token)
const SELECTED_WASH_RGB = "rgb(232, 238, 244)"; // #E8EEF4 (iconCard.selectedBackground)

// WCAG 2.1 relative luminance + contrast ratio (the standard formula, never
// approximated) — proves the MAJOR finding's fix with a REAL measured number,
// not a bare "the color changed". Accepts getComputedStyle's own "rgb(r, g,
// b)" format.
function relLuminance(rgb: string): number {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${rgb}`);
  const [rr, gg, bb] = [m[1]!, m[2]!, m[3]!].map((c) => {
    const n = parseInt(c, 10) / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
}
function contrastRatio(rgbA: string, rgbB: string): number {
  const [l1, l2] = [relLuminance(rgbA), relLuminance(rgbB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

// A single-column ButtonAnswerGroup so each button owns its own grid ROW → a
// per-choice min-height is honored independently (no same-row stretch-equalize;
// that multi-column case needs align-items:start in styles.ts, see header).
const COMPONENTS = [
  { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
  { type: "Subheadline", question_id: "q_sub", bind: "section_subheadline" },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_perm",
    internal_field: "perm",
    answer_type: "enum",
    props: { columns: 1 },
    choices: [
      {
        label: "Allow",
        value: "allow",
        analytics_id: "al",
        style: { color_role: "accent", size: "l", emphasis: "strong", text_color_role: "card_background" },
      },
      { label: "Disallow", value: "disallow", analytics_id: "di" },
    ],
  },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_warn",
    internal_field: "warn",
    answer_type: "enum",
    props: { columns: 1 },
    choices: [
      { label: "Delete", value: "del", analytics_id: "de", style: { color_hex: OFF_THEME_HEX } },
      { label: "Keep", value: "keep", analytics_id: "ke" },
    ],
  },
  // P2b studio-controls coverage (conductor-required gap close): TwoButtonYesNo
  // is a FIXED 2-column .lg-answer-group.lg-yesno pair (side-by-side, no
  // `choices` array) — plain/unstyled at creation; the studio-controls test
  // below authors Yes's props.yesStyle THROUGH the real yes/no popover.
  // Inserted AFTER q_warn (not before q_perm) so findDefaultSelectionId()'s
  // "first real answer field" default selection stays q_perm, unchanged for
  // every OTHER test in this file.
  { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "yn", props: { yesLabel: "Yes", noLabel: "No" } },
  { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
];

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
interface Created { id: number; public_id: string; }
async function createSection(request: APIRequestContext, name: string): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Delete this record?",
        subheadline_text: "This cannot be undone",
        continue_mode: "button",
        status: "active",
        content_json: { components: COMPONENTS },
      },
    }),
    `section create (${name})`,
  );
}

// Read the per-element computed facts for a choice button [data-value=v] inside
// a render root. answerBg is the CUSTOM PROPERTY value (raw, e.g. "#E85D26");
// color/backgroundColor/fontWeight are computed; height is boundingRect.
interface Facts { answerBg: string; color: string; backgroundColor: string; fontWeight: string; height: number; }
function readFacts(root: import("@playwright/test").Locator, v: string): Promise<Facts> {
  return root.locator(`[data-value="${v}"]`).evaluate((el: Element): Facts => {
    const cs = getComputedStyle(el as HTMLElement);
    return {
      answerBg: cs.getPropertyValue("--lg-answer-bg").trim(),
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontWeight: cs.fontWeight,
      height: (el as HTMLElement).getBoundingClientRect().height,
    };
  });
}

async function bootStudioCanvas(page: Page, s: Created): Promise<import("@playwright/test").Locator> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator("#lg-studio-canvas-frame");
  await expect(frame.locator('[data-value="allow"]')).toBeVisible({ timeout: 20_000 });
  // Return a Locator scoped to the canvas render root so readFacts can query it.
  return frame.locator("#lg-studio-canvas-render");
}

// ---------------------------------------------------------------------------
// STUDIO CANVAS — both engines
// ---------------------------------------------------------------------------
test.describe("P2a per-element freedom — studio canvas (both engines)", () => {
  let root: import("@playwright/test").Locator;
  test.beforeEach(async ({ page, request }) => {
    const s = await createSection(request, `p2a-canvas-${uniq}-${Math.random().toString(36).slice(2, 7)}`);
    root = await bootStudioCanvas(page, s);
  });

  test("Allow carries the resolved role as the state-safe --lg-answer-bg; Disallow carries none (diff-only)", async () => {
    const allow = await readFacts(root, "allow");
    const disallow = await readFacts(root, "disallow");
    expect(allow.answerBg).toBe(ACCENT_HEX); // role → resolved hex EXACTLY (emission)
    expect(disallow.answerBg).toBe(""); // unstyled sibling: no per-choice bg at all
  });

  test("the deliberate OFF-THEME #hex renders verbatim as --lg-answer-bg", async () => {
    expect((await readFacts(root, "del")).answerBg).toBe(OFF_THEME_HEX);
  });

  test("per-choice emphasis: Allow font-weight 700; Disallow is not bold (diff-only)", async () => {
    expect((await readFacts(root, "allow")).fontWeight).toBe("700");
    expect((await readFacts(root, "disallow")).fontWeight).not.toBe("700");
  });

  test("per-choice text color: Allow renders the resolved label color exactly", async () => {
    expect((await readFacts(root, "allow")).color).toBe(CARD_TEXT);
  });

  test("per-choice size: the styled Allow is taller than the unstyled Disallow (size:l floors 60px)", async () => {
    const allow = await readFacts(root, "allow");
    const disallow = await readFacts(root, "disallow");
    expect(allow.height).toBeGreaterThanOrEqual(60);
    expect(allow.height).toBeGreaterThan(disallow.height);
  });

  test("P2b PAINT: the resolved role hex actually paints Allow's resting background (styles.ts reads --lg-answer-bg)", async () => {
    const allow = await readFacts(root, "allow");
    expect(allow.backgroundColor).toBe(ACCENT_RGB);
  });

  test("P2b PAINT: the deliberate OFF-THEME #hex actually paints the resting background", async () => {
    const del = await readFacts(root, "del");
    expect(del.backgroundColor).toBe(OFF_THEME_RGB);
  });

  test("P2b PAINT diff-only: Disallow (no style authored) still paints the theme default — no leak from Allow/del's override", async () => {
    const disallow = await readFacts(root, "disallow");
    const keep = await readFacts(root, "keep");
    expect(disallow.backgroundColor).toBe(RESTING_WHITE);
    expect(keep.backgroundColor).toBe(RESTING_WHITE);
  });
});

// ---------------------------------------------------------------------------
// P2b STUDIO CONTROLS — authoring choice.style THROUGH the real inspector
// (both engines; the popover is plain DOM, no engine-specific gesture).
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// The canvas re-render is a DEBOUNCED preview POST (studio-patterns.spec.ts's
// own documented mechanism) AND `.lg-btn.lg-btn-answer`/`.lg-card` carry a
// `border-color …, background …` CSS transition (BOTH properties, P2b
// FIX-ROUND R1) — so a computed-style read (background OR border-color)
// taken the INSTANT after an authoring action, a click, a hover, or a save/
// reload can observe a TRANSIENT value (mid-debounce or mid-transition), not
// the settled one. Every color/border assertion in this file uses this SAME
// retry (found live TWICE: an unwrapped post-reload background read caught a
// transient value on firefox; an unwrapped post-click border-color read
// caught a transient value on chromium — border-color rides the identical
// transition as background, so it needs the identical treatment).
async function expectComputedStyle(read: () => Promise<string>, expected: string): Promise<void> {
  await expect(async () => {
    expect(await read()).toBe(expected);
  }).toPass({ timeout: 10_000 });
}

test.describe("P2b studio controls — the choices-editor Style popover (real input, real save)", () => {
  test("role swatch paints the canvas + no off-theme badge; custom hex paints + SHOWS the badge; both persist through save/reload", async ({ page, request }) => {
    test.setTimeout(120_000);
    const s = await createSection(request, `p2b-studio-${uniq}-${Math.random().toString(36).slice(2, 7)}`);
    await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("#lg-studio-canvas-frame");
    await expect(frame.locator('[data-value="disallow"]')).toBeVisible({ timeout: 20_000 });

    // Select q_perm (clicking any of its choices selects the parent node) —
    // its choices editor rows render [Allow, Disallow] in that order.
    await frame.locator('[data-value="disallow"]').click();
    const permRows = page.locator("[data-inspector-choices] [data-choice-row]");
    await expect(permRows).toHaveCount(2);
    const disallowRow = permRows.nth(1);

    // Author Disallow's color through the REAL role swatch (a role Allow does
    // NOT already use, so this is a genuinely independent authored choice).
    const successHex = "#0E7C3A"; // defaultFunnelDesign.color.success (theme role)
    await disallowRow.locator("[data-choice-style-toggle]").click();
    const disallowPanel = disallowRow.locator("[data-choice-style-panel]");
    await expect(disallowPanel).toBeVisible();
    await disallowPanel.locator('[data-choice-style-axis="color"] [data-choice-role-swatch="success"]').click();

    // The canvas paints it (the same emission -> paint pipeline the effect
    // gate proves for Allow/del, now proven authored through the REAL UI).
    await expect(async () => {
      const bg = await frame.locator('[data-value="disallow"]').evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
      expect(bg).toBe(hexToRgb(successHex));
    }).toPass({ timeout: 10_000 });
    // A theme ROLE is never "off theme" — the badge stays hidden.
    await expect(disallowRow.locator("[data-choice-offtheme-badge]")).toBeHidden();

    // Author Keep's color through the CUSTOM-HEX escape hatch (q_warn: [Delete, Keep]).
    await frame.locator('[data-value="keep"]').click();
    const warnRows = page.locator("[data-inspector-choices] [data-choice-row]");
    await expect(warnRows).toHaveCount(2);
    const keepRow = warnRows.nth(1);
    const CUSTOM_HEX = "#00A86B"; // a deliberate off-theme green (not a role)
    await keepRow.locator("[data-choice-style-toggle]").click();
    const keepPanel = keepRow.locator("[data-choice-style-panel]");
    await expect(keepPanel).toBeVisible();
    await keepPanel.locator('[data-choice-style-axis="color"] [data-choice-hex-input]').fill(CUSTOM_HEX);
    await keepPanel.locator('[data-choice-style-axis="color"] [data-choice-hex-input]').blur();

    await expect(async () => {
      const bg = await frame.locator('[data-value="keep"]').evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
      expect(bg).toBe(hexToRgb(CUSTOM_HEX));
    }).toPass({ timeout: 10_000 });
    // A CUSTOM HEX is off theme — the badge SHOWS (diff-only vs. the role case above).
    await expect(keepRow.locator("[data-choice-offtheme-badge]")).toBeVisible();
    await expect(keepRow.locator("[data-choice-offtheme-badge]")).toHaveText("Off theme");

    // SAVE -> full reload -> RE-OPEN -> both authored styles + the badge state persisted.
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    await expect(frame.locator('[data-value="disallow"]')).toBeVisible({ timeout: 20_000 });

    await frame.locator('[data-value="disallow"]').click();
    const permRowsAfter = page.locator("[data-inspector-choices] [data-choice-row]");
    await expect(permRowsAfter).toHaveCount(2);
    const disallowRowAfter = permRowsAfter.nth(1);
    await disallowRowAfter.locator("[data-choice-style-toggle]").click();
    await expect(disallowRowAfter.locator('[data-choice-style-axis="color"] [data-choice-role-swatch="success"]')).toHaveClass(/active/);
    await expect(disallowRowAfter.locator("[data-choice-offtheme-badge]")).toBeHidden();

    await frame.locator('[data-value="keep"]').click();
    const warnRowsAfter = page.locator("[data-inspector-choices] [data-choice-row]");
    await expect(warnRowsAfter).toHaveCount(2);
    const keepRowAfter = warnRowsAfter.nth(1);
    await keepRowAfter.locator("[data-choice-style-toggle]").click();
    await expect(keepRowAfter.locator('[data-choice-style-axis="color"] [data-choice-hex-input]')).toHaveValue(CUSTOM_HEX);
    await expect(keepRowAfter.locator("[data-choice-offtheme-badge]")).toBeVisible();

    // Server truth: choices[1].style landed exactly as authored (never a
    // copied/rewritten value — role stays a role string, hex stays the hex).
    const detail = await json<{ content_json: { components: Array<{ question_id: string; choices?: Array<{ value: string; style?: Record<string, unknown> }> }> } }>(
      await request.get(`${LG_API}/sections/${s.public_id}`),
      "section detail",
    );
    const perm = detail.content_json.components.find((c) => c.question_id === "q_perm")!;
    const warn = detail.content_json.components.find((c) => c.question_id === "q_warn")!;
    expect(perm.choices?.find((c) => c.value === "disallow")?.style).toEqual({ color_role: "success" });
    expect(warn.choices?.find((c) => c.value === "keep")?.style).toEqual({ color_hex: CUSTOM_HEX });
  });

  // Conductor-required gap close: TwoButtonYesNo has no `choices` array, so it
  // gets the SAME popover mounted at data-yesno-style="yes"/"no" instead
  // (populateYesNoStyleBlock/setYesNoStyle, ui-section-studio.ts) — this is
  // the ONLY test exercising that mount-point wiring end-to-end (the popover
  // itself is already proven via the choice-row test above).
  test("TwoButtonYesNo: Yes authored role+size L through the REAL yes/no popover paints + grows the cell; No stays theme-default; switching Yes to a custom hex flips the badge; both persist through save/reload", async ({ page, request }) => {
    test.setTimeout(120_000);
    const s = await createSection(request, `p2b-yesno-${uniq}-${Math.random().toString(36).slice(2, 7)}`);
    await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("#lg-studio-canvas-frame");
    await expect(frame.locator('[data-value="true"]')).toBeVisible({ timeout: 20_000 });

    // Select q_yn (clicking either button selects the PARENT node — both
    // yes/no mounts populate together, not per-button).
    await frame.locator('[data-value="true"]').click();
    const yesBlock = page.locator('[data-yesno-style="yes"]');
    const noBlock = page.locator('[data-yesno-style="no"]');
    await expect(yesBlock).toBeVisible();
    await expect(noBlock).toBeVisible();

    // Author Yes: role color (accent) + size L — through the REAL controls.
    await yesBlock.locator("[data-choice-style-toggle]").click();
    const yesPanel = yesBlock.locator("[data-choice-style-panel]");
    await expect(yesPanel).toBeVisible();
    await yesPanel.locator('[data-choice-style-axis="color"] [data-choice-role-swatch="accent"]').click();
    await yesPanel.locator('[data-choice-size-preset="l"]').click();

    // Canvas paints Yes with the resolved role hex + a taller cell (size:l
    // floors 60px); No (never touched) stays the theme default — the SAME
    // side-by-side .lg-answer-group.lg-yesno row align-items:start (P2b)
    // lets Yes grow without stretching No to match.
    const yesBg = () => frame.locator('[data-value="true"]').evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    const noBgRead = () => frame.locator('[data-value="false"]').evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    await expectComputedStyle(yesBg, ACCENT_RGB);
    const yesHeight = await frame.locator('[data-value="true"]').evaluate((el) => el.getBoundingClientRect().height);
    const noHeight = await frame.locator('[data-value="false"]').evaluate((el) => el.getBoundingClientRect().height);
    expect(yesHeight).toBeGreaterThanOrEqual(60);
    expect(yesHeight).toBeGreaterThan(noHeight);
    await expectComputedStyle(noBgRead, RESTING_WHITE);

    // A theme ROLE is never off-theme — the badge stays hidden on Yes; No was
    // never authored at all (no controls opened), so its badge is hidden too.
    await expect(yesBlock.locator("[data-choice-offtheme-badge]")).toBeHidden();
    await expect(noBlock.locator("[data-choice-offtheme-badge]")).toBeHidden();

    // Switch Yes's color from the role to a CUSTOM HEX (mutual exclusivity —
    // the SAME control, not a second element) — proves the badge is REACTIVE
    // through this mount, and exercises setYesNoStyle's hex-write path.
    await yesPanel.locator('[data-choice-style-axis="color"] [data-choice-hex-input]').fill(OFF_THEME_HEX);
    await yesPanel.locator('[data-choice-style-axis="color"] [data-choice-hex-input]').blur();
    await expectComputedStyle(yesBg, OFF_THEME_RGB);
    await expect(yesBlock.locator("[data-choice-offtheme-badge]")).toBeVisible();
    await expect(yesBlock.locator("[data-choice-offtheme-badge]")).toHaveText("Off theme");
    // No is STILL untouched (diff-only — Yes's authoring never leaked to No).
    await expectComputedStyle(noBgRead, RESTING_WHITE);
    await expect(noBlock.locator("[data-choice-offtheme-badge]")).toBeHidden();

    // No's OWN panel is genuinely empty (never authored): no active role
    // swatch, no hex, size segmented shows no active preset.
    await noBlock.locator("[data-choice-style-toggle]").click();
    const noPanel = noBlock.locator("[data-choice-style-panel]");
    await expect(noPanel).toBeVisible();
    await expect(noPanel.locator('[data-choice-style-axis="color"] .active')).toHaveCount(0);
    await expect(noPanel.locator('[data-choice-style-axis="color"] [data-choice-hex-input]')).toHaveValue("");
    await expect(noPanel.locator("[data-choice-size-preset].active")).toHaveCount(0);

    // SAVE -> full reload -> RE-OPEN -> both the hex + size + the no-op No
    // state persisted.
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    await expect(frame.locator('[data-value="true"]')).toBeVisible({ timeout: 20_000 });

    await frame.locator('[data-value="true"]').click();
    const yesBlockAfter = page.locator('[data-yesno-style="yes"]');
    const noBlockAfter = page.locator('[data-yesno-style="no"]');
    await yesBlockAfter.locator("[data-choice-style-toggle]").click();
    await expect(yesBlockAfter.locator('[data-choice-style-axis="color"] [data-choice-hex-input]')).toHaveValue(OFF_THEME_HEX);
    await expect(yesBlockAfter.locator('[data-choice-size-preset="l"]')).toHaveClass(/active/);
    await expect(yesBlockAfter.locator("[data-choice-offtheme-badge]")).toBeVisible();
    await expect(noBlockAfter.locator("[data-choice-offtheme-badge]")).toBeHidden();

    const yesHeightAfter = await frame.locator('[data-value="true"]').evaluate((el) => el.getBoundingClientRect().height);
    const noHeightAfter = await frame.locator('[data-value="false"]').evaluate((el) => el.getBoundingClientRect().height);
    expect(yesHeightAfter).toBeGreaterThanOrEqual(60);
    expect(yesHeightAfter).toBeGreaterThan(noHeightAfter);
    await expectComputedStyle(yesBg, OFF_THEME_RGB);
    await expectComputedStyle(noBgRead, RESTING_WHITE);

    // Server truth: props.yesStyle landed exactly as authored (role replaced
    // by hex, diff-only — never a copied value); props.noStyle absent (No
    // was never authored at all).
    const detail = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(
      await request.get(`${LG_API}/sections/${s.public_id}`),
      "section detail",
    );
    const yn = detail.content_json.components.find((c) => c.question_id === "q_yn")!;
    expect(yn.props?.["yesStyle"]).toEqual({ color_hex: OFF_THEME_HEX, size: "l" });
    expect(yn.props?.["noStyle"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LIVE /lg FUNNEL — §12 parity + selected-state (chromium; firefox-skip)
// ---------------------------------------------------------------------------
test.describe("P2a per-element freedom — live /lg funnel (§12 parity + selected)", () => {
  test("live render carries the SAME per-element emission; selected wins while selected (resting override never leaks)", async ({ page, request, browserName }) => {
    test.skip(browserName === "firefox", "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the studio-canvas describe above runs on BOTH engines");
    const host = `p2a-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P2a Element Freedom ${uniq}`);
    const s = await createSection(request, `p2a-live-${uniq}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P2a Live ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    // Rework §4.3-1: the quote's shared first page is mandatory for activation and
    // resolver.ts composes [...sharedPages, ...variantPages] — the section under test IS
    // page 1, so it moves onto the shared page. Composed order (and therefore every
    // geometry/index assertion below) is unchanged.
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: await createPassThroughSection(request, "P2a live") }] } }), "variant sections");
    await seedSharedFirstPage(request, quote.public_id, [s.id]);
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p2a" } }), "activation");

    await page.goto(`http://${host}:${PORT}/lg/p2a`, { waitUntil: "load" });
    const live = page.locator("body");
    await expect(live.locator('[data-value="allow"]')).toBeVisible({ timeout: 20_000 });

    // §12 parity: the live render carries the SAME per-element emission AND
    // the SAME painted resting background as the studio canvas (the SAME
    // server renderer + the SAME styles.ts chrome sheet — P2b closes the loop
    // from emission to paint on both surfaces identically).
    const allowResting = await readFacts(live, "allow");
    expect(allowResting.answerBg).toBe(ACCENT_HEX);
    expect(allowResting.backgroundColor).toBe(ACCENT_RGB);
    expect(allowResting.fontWeight).toBe("700");
    expect(allowResting.height).toBeGreaterThan((await readFacts(live, "disallow")).height);

    // MINOR-2 (adversarial review) — the PRIOR version of this test asserted
    // only DOM structure (a class present, an inline style excluding some
    // substrings), never the real PAINT — which stayed green even though R2's
    // OWN pre-existing discovery is that the live runtime marks a selection
    // with ONLY the .lg-selected class + aria-pressed (render.ts
    // SELECTED_CLASS), never aria-checked/data-selected — so NO selected CSS
    // rule ever matched live, and a click painted NOTHING at all. These are
    // the real COMPUTED-paint assertions (the pass-after evidence for R1+R2;
    // R2's fail-before is the reviewer's own citation — every selected rule
    // keyed [aria-checked]/[data-selected] only, confirmed absent from every
    // rule in styles.ts pre-fix by grep, and independently reproduced by this
    // implementer: render.ts:76-80 sets ONLY classList.add(SELECTED_CLASS) +
    // aria-pressed, read-only-confirmed, zero runtime changes made here).
    const allowBtn = live.locator('[data-value="allow"]');
    const disallowBtn = live.locator('[data-value="disallow"]');

    // (c) HOVER leg FIRST (before any click marks anything selected) — the
    // MAJOR finding: pre-R1, :hover replaced Allow's authored accent
    // background with the theme's generic hover wash (#F2F6FA) while the
    // author's white text stayed fixed → white-on-near-white, the reviewer's
    // OWN cited measurement of 1.09:1 (independently reverified by this
    // implementer against the SAME tokens offline: contrast(#FFFFFF,
    // #F2F6FA) = 1.086:1 — matches). R1 makes :hover read var(--lg-answer-bg,
    // …) too, so Allow's OWN accent now persists through hover.
    await allowBtn.hover();
    await expectComputedStyle(() => allowBtn.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor), ACCENT_RGB);
    const hoveredTextColor = await allowBtn.evaluate((el) => getComputedStyle(el as HTMLElement).color);
    const hoverRatio = contrastRatio(hoveredTextColor, ACCENT_RGB);
    // Measured reality, cited plainly (never asserted past what is true):
    // white-on-#E85D26 is 3.49:1 — a ~3.2x improvement over the 1.09:1 fail-
    // before, and clears the WCAG AA "large text / UI component" floor
    // (3:1 — this button is font-weight 700, which is the bold half of that
    // test), but it does NOT clear the stricter 4.5:1 normal-text bar at this
    // component's 15px base size (primaryButton.fontSize 0.9375rem — a few px
    // under the 18.66px bold "large text" cutoff). That gap is a CONTENT
    // color-pairing choice (this specific accent+white combination), not
    // something the R1 persistence mechanism itself can or should force —
    // flagged here, not silently asserted at a threshold the real number
    // does not clear.
    expect(hoverRatio).toBeGreaterThan(3);
    expect(hoverRatio).toBeGreaterThan(1.09 * 3); // dramatically, not marginally, better than the fail-before
    await page.mouse.move(0, 0);

    // (a) CLICK a STYLED choice (Allow) — selected treatment now actually
    // appears live (R2), AND the authored background PERSISTS (R1): state
    // feedback rides border-color/font-weight instead of repainting the bg.
    await allowBtn.click();
    await expect(allowBtn).toHaveClass(/lg-selected/, { timeout: 10_000 });
    await expectComputedStyle(() => allowBtn.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor), ACCENT_RGB);
    // border-color rides the SAME `transition: border-color …, background …`
    // as background (found live: an unwrapped read here caught a transient
    // mid-transition value) — the identical retry, not a bare read.
    await expectComputedStyle(() => allowBtn.evaluate((el) => getComputedStyle(el as HTMLElement).borderColor), SELECTED_BORDER_RGB);
    expect(await allowBtn.evaluate((el) => getComputedStyle(el as HTMLElement).fontWeight)).toBe("700");
    // The per-choice channel stays --lg-answer-bg only (no --lg-sel-bg / bare
    // background: ever lands inline) — same structural proof as before, kept
    // alongside the new paint assertions rather than replacing them outright.
    const styleAttr = (await allowBtn.getAttribute("style")) ?? "";
    expect(styleAttr).toContain("--lg-answer-bg");
    expect(styleAttr).not.toContain("--lg-sel-bg");
    expect(styleAttr).not.toContain("background:");
    expect((await readFacts(live, "allow")).answerBg).toBe(ACCENT_HEX);

    // (b) CLICK the UNSTYLED sibling (Disallow) — the pre-existing-bug
    // regression test: pre-R2 this painted NOTHING live (no selected rule
    // ever matched .lg-selected); the theme's OWN wash now appears, matching
    // the studio-canvas behavior — §12 parity restored for the selected
    // state too, not just the resting one.
    await disallowBtn.click();
    await expect(disallowBtn).toHaveClass(/lg-selected/, { timeout: 10_000 });
    await expectComputedStyle(() => disallowBtn.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor), SELECTED_WASH_RGB);
    await expectComputedStyle(() => disallowBtn.evaluate((el) => getComputedStyle(el as HTMLElement).borderColor), SELECTED_BORDER_RGB);
  });
});
